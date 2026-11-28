# GSIGN — Narrow Phase 1D Staging Privilege Hardening Script (Windows PowerShell 5.1)
# Applies ONLY Phase 1D table privilege revocations/grants on the already-provisioned staging DB.
# Preserves existing gsign_app password and existing db_environment_identity marker.
# Does NOT run migrations, seeds, role creation, or ALTER ROLE ... PASSWORD.

$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureStringSafe {
    param([Parameter(Mandatory=$true)][Security.SecureString]$SecureValue)
    $bstr = [IntPtr]::Zero
    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

$adminSec = Read-Host "Enter STAGING neondb_owner DIRECT_DATABASE_URL" -AsSecureString
$appSec   = Read-Host "Enter EXISTING STAGING gsign_app DATABASE_URL (for post-check verification)" -AsSecureString

$adminUrl = ConvertFrom-SecureStringSafe $adminSec
$appUrl   = ConvertFrom-SecureStringSafe $appSec

try {
    # STEP 1: Mandatory Preflight + Narrow Transactional Privilege Hardening (as neondb_owner)
    $env:ADMIN_DATABASE_URL = $adminUrl
    $hardenScript = @'
const { Client } = require('./backend/node_modules/pg');

(async () => {
  const expectedHost = 'ep-green-field-bim0f4kb.c-5.ap-southeast-1.aws.neon.tech';
  const parsed = new URL(process.env.ADMIN_DATABASE_URL);
  if (parsed.hostname.toLowerCase() !== expectedHost) {
    throw new Error(`Hostname mismatch: got ${parsed.hostname}, expected ${expectedHost}`);
  }

  const c = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await c.connect();

  try {
    // 1. Mandatory Preflight Checks (read-only)
    const preRes = await c.query(`
      SELECT
        current_database() AS database_name,
        current_user AS current_user,
        session_user AS session_user,
        inet_server_port() AS server_port,
        current_setting('transaction_read_only') AS tx_read_only,
        r.rolsuper AS owner_rolsuper
      FROM pg_roles r
      WHERE r.rolname = current_user
    `);
    const pre = preRes.rows[0];
    console.log('=== Preflight Audit ===');
    console.log(JSON.stringify({
      hostname: parsed.hostname,
      database_name: pre.database_name,
      current_user: pre.current_user,
      session_user: pre.session_user,
      server_port: pre.server_port,
      transaction_read_only: pre.tx_read_only,
      owner_rolsuper: pre.owner_rolsuper
    }, null, 2));

    if (
      pre.database_name !== 'neondb' ||
      pre.current_user !== 'neondb_owner' ||
      pre.session_user !== 'neondb_owner' ||
      pre.tx_read_only !== 'off' ||
      pre.owner_rolsuper !== false
    ) {
      throw new Error('Preflight check failed: target database, role, read-write state, or superuser check did not match expected staging neondb_owner.');
    }

    const appRoleRes = await c.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
      FROM pg_roles
      WHERE rolname = 'gsign_app'
    `);
    if (appRoleRes.rows.length !== 1) {
      throw new Error('Preflight check failed: gsign_app role does not exist on target database.');
    }
    const appRole = appRoleRes.rows[0];
    if (appRole.rolsuper || appRole.rolbypassrls || appRole.rolcreaterole || appRole.rolcreatedb) {
      throw new Error('Preflight check failed: existing gsign_app role has unexpected elevated attributes.');
    }

    const markerRes = await c.query(`
      SELECT id, environment_type
      FROM public.db_environment_identity
      WHERE id = 1
      LIMIT 1
    `);
    if (markerRes.rows.length !== 1 || String(markerRes.rows[0].environment_type || '').toLowerCase() !== 'staging') {
      throw new Error('Preflight check failed: db_environment_identity row id=1 is missing or not marked staging.');
    }

    // 2. Deliberate Transaction for Narrow Privilege Statements Only
    const statements = [
      'REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC',
      'REVOKE ALL ON TABLE public.schema_migrations FROM gsign_app',
      'REVOKE ALL ON TABLE public.db_environment_identity FROM PUBLIC',
      'REVOKE ALL ON TABLE public.db_environment_identity FROM gsign_app',
      'GRANT SELECT ON TABLE public.db_environment_identity TO gsign_app',
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.roles FROM gsign_app',
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.permissions FROM gsign_app',
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.role_permissions FROM gsign_app',
      'REVOKE DELETE ON TABLE public.users FROM gsign_app',
      'REVOKE DELETE ON TABLE public.tenants FROM gsign_app',
      'REVOKE DELETE ON TABLE public.subscription_plans FROM gsign_app',
      'REVOKE DELETE ON TABLE public.company_registrations FROM gsign_app',
      'REVOKE DELETE ON TABLE public.user_mfa_configs FROM gsign_app',
    ];

    await c.query('BEGIN');
    try {
      for (const stmt of statements) {
        await c.query(stmt);
      }
      await c.query('COMMIT');
      console.log(`Phase 1D OK: ${statements.length} narrow privilege statements committed.`);
    } catch (txErr) {
      await c.query('ROLLBACK').catch(() => {});
      throw txErr;
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
'@
    try {
        $hardenScript | node -
        if ($LASTEXITCODE -ne 0) { throw "Privilege hardening failed; aborting before verification." }
    }
    finally {
        Remove-Item Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
    }

    # STEP 2: Post-Application Verification Authenticated as Existing gsign_app
    $uApp = [Uri]$appUrl
    $expectedHost = 'ep-green-field-bim0f4kb.c-5.ap-southeast-1.aws.neon.tech'
    if ($uApp.Host.ToLower() -ne $expectedHost) {
        throw "gsign_app DATABASE_URL host mismatch: $($uApp.Host)"
    }
    $appDb = $uApp.AbsolutePath.TrimStart('/')
    if ($appDb -ne 'neondb') {
        throw "gsign_app DATABASE_URL database mismatch: got '$appDb', expected 'neondb'."
    }
    $appUser = [Uri]::UnescapeDataString(($uApp.UserInfo -split ':', 2)[0])
    if ($appUser -ne 'gsign_app') {
        throw "gsign_app DATABASE_URL username mismatch: expected 'gsign_app'."
    }
    $env:DATABASE_URL = $appUrl
    try {
        npx --prefix backend ts-node backend/scripts/verify-runtime-rls.ts
        if ($LASTEXITCODE -ne 0) { throw "verify-runtime-rls.ts failed." }
    }
    finally {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
}
finally {
    Remove-Item Env:ADMIN_DATABASE_URL, Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Variable adminSec, appSec, adminUrl, appUrl, hardenScript, uApp, expectedHost, appDb, appUser -ErrorAction SilentlyContinue
    [GC]::Collect()
}
