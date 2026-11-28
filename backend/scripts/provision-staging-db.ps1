# GSIGN — Hardened Staging PostgreSQL Provisioning Script (Windows PowerShell 5.1)
# Executes ONLY against the verified Neon staging branch:
#   ep-green-field-bim0f4kb.c-5.ap-southeast-1.aws.neon.tech / neondb

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

$adminSec  = Read-Host "Enter STAGING neondb_owner DIRECT_DATABASE_URL" -AsSecureString
$appPwSec  = Read-Host "Enter NEW strong password for STAGING gsign_app" -AsSecureString
$markerSec = Read-Host "Enter unique STAGING identity marker" -AsSecureString

$adminUrl  = ConvertFrom-SecureStringSafe $adminSec
$appPw     = ConvertFrom-SecureStringSafe $appPwSec
$markerVal = ConvertFrom-SecureStringSafe $markerSec

try {
    # STEP 0: Mandatory Pre-Flight Target Identity Check (read-only)
    $env:DIRECT_DATABASE_URL = $adminUrl
    $preflightScript = @'
const { Client } = require('./backend/node_modules/pg');
(async () => {
  const parsed = new URL(process.env.DIRECT_DATABASE_URL);
  const expectedHost = 'ep-green-field-bim0f4kb.c-5.ap-southeast-1.aws.neon.tech';
  if (parsed.hostname.toLowerCase() !== expectedHost) {
    throw new Error(`Hostname mismatch: got ${parsed.hostname}, expected ${expectedHost}`);
  }
  const c = new Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await c.connect();
  try {
    const r = await c.query(`
      SELECT current_database() AS database_name,
             current_user AS current_user,
             session_user AS session_user
    `);
    const row = r.rows[0];
    console.log('=== Pre-Flight Target ===');
    console.log(JSON.stringify({
      hostname: parsed.hostname,
      database_name: row.database_name,
      current_user: row.current_user,
      session_user: row.session_user
    }, null, 2));
    if (row.database_name !== 'neondb' || row.current_user !== 'neondb_owner' || row.session_user !== 'neondb_owner') {
      throw new Error('Pre-flight check failed: expected database=neondb, current_user=neondb_owner, session_user=neondb_owner.');
    }
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@
    try {
        $preflightScript | node -
        if ($LASTEXITCODE -ne 0) { throw "Pre-flight check failed; aborting before migrations." }
    }
    finally {
        Remove-Item Env:DIRECT_DATABASE_URL -ErrorAction SilentlyContinue
    }

    # STEP 1: Run Staging Migrations (as neondb_owner)
    $env:DIRECT_DATABASE_URL = $adminUrl
    try {
        npm --prefix backend run migrate
        if ($LASTEXITCODE -ne 0) { throw "Staging migration failed; aborting before role provisioning." }
    }
    finally {
        Remove-Item Env:DIRECT_DATABASE_URL -ErrorAction SilentlyContinue
    }

    # STEP 2: Provision Restricted Runtime Role gsign_app (prepare-runtime-role.sql)
    $env:ADMIN_DATABASE_URL = $adminUrl
    $env:APP_ROLE_PASSWORD  = $appPw
    $roleScript = @'
const fs = require('fs');
const { Client } = require('./backend/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await c.connect();
  try {
    await c.query("SELECT set_config('app.runtime_role_password', $1, false)", [process.env.APP_ROLE_PASSWORD]);
    await c.query(fs.readFileSync('backend/scripts/prepare-runtime-role.sql', 'utf8'));
    console.log('STEP 2 OK: gsign_app role provisioned.');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.query('RESET app.runtime_role_password').catch(() => {});
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@
    try {
        $roleScript | node -
        if ($LASTEXITCODE -ne 0) { throw "Role provisioning failed; aborting before marker initialization." }
    }
    finally {
        Remove-Item Env:ADMIN_DATABASE_URL, Env:APP_ROLE_PASSWORD -ErrorAction SilentlyContinue
    }

    # STEP 3: Initialize Staging-Only Identity Marker (prepare-staging-identity.sql)
    $env:ADMIN_DATABASE_URL      = $adminUrl
    $env:STAGING_IDENTITY_MARKER = $markerVal
    $markerScript = @'
const fs = require('fs');
const { Client } = require('./backend/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await c.connect();
  try {
    await c.query("SELECT set_config('app.staging_identity_marker', $1, false)", [process.env.STAGING_IDENTITY_MARKER]);
    await c.query(fs.readFileSync('backend/scripts/prepare-staging-identity.sql', 'utf8'));
    console.log('STEP 3 OK: staging identity marker initialized.');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.query('RESET app.staging_identity_marker').catch(() => {});
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@
    try {
        $markerScript | node -
        if ($LASTEXITCODE -ne 0) { throw "Staging marker initialization failed; aborting before runtime verification." }
    }
    finally {
        Remove-Item Env:ADMIN_DATABASE_URL, Env:STAGING_IDENTITY_MARKER -ErrorAction SilentlyContinue
    }

    # STEP 4: Construct gsign_app DATABASE_URL (single-pass EscapeDataString) & Run verify-runtime-rls.ts
    $u = [Uri]$adminUrl
    $encodedPw = [Uri]::EscapeDataString($appPw)
    $portPart = if ($u.IsDefaultPort -or $u.Port -lt 0) { "" } else { ":$($u.Port)" }
    $env:DATABASE_URL = "$($u.Scheme)://gsign_app:$encodedPw@$($u.Host)$portPart$($u.AbsolutePath)$($u.Query)"

    try {
        npx --prefix backend ts-node backend/scripts/verify-runtime-rls.ts
        if ($LASTEXITCODE -ne 0) { throw "verify-runtime-rls.ts failed." }
    }
    finally {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
}
finally {
    Remove-Item Env:DIRECT_DATABASE_URL, Env:ADMIN_DATABASE_URL, Env:APP_ROLE_PASSWORD, Env:STAGING_IDENTITY_MARKER, Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Variable adminSec, appPwSec, markerSec, adminUrl, appPw, markerVal, preflightScript, roleScript, markerScript, u, encodedPw, portPart -ErrorAction SilentlyContinue
    [GC]::Collect()
}
