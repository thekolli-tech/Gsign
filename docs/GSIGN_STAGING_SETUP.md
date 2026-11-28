# GSIGN Isolated Staging Setup & Verification Guide (Windows PowerShell 5.1)

This guide sets up and verifies an **isolated staging environment** without touching production PostgreSQL, production Redis, production Cloudflare R2, or Vercel production settings.

---

## 1. Manual Staging Resources Required First

Before running any command below, manually provision **separate staging-only** resources:
1. **Neon Staging Branch** (branched from `gsign` schema or empty `neondb`; note its distinct hostname, e.g. `ep-staging-...neon.tech`, and `neondb_owner` connection string).
2. **Staging Redis Instance** (e.g. separate Upstash/Redis database).
3. **Staging Cloudflare R2 Bucket** (e.g. `gsign-staging-private-documents` with its own R2 API keypair).
4. **Unique Staging Identity Marker** (e.g. generate a random string locally for `db_environment_identity`).

> **Security Rule:** Never store `neondb_owner` (`DIRECT_DATABASE_URL` / `ADMIN_DATABASE_URL`) in Vercel or any application runtime config.

---

## 2. PowerShell 5.1 Secure Helper (Run Once Per Session)

```powershell
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
```

---

## 3. Step-by-Step Staging Provisioning

### Step 1 & 2 — Run Staging Migrations & Production-Mode Seed (`neondb_owner`)
```powershell
$adminSec   = Read-Host "Enter STAGING neondb_owner DIRECT_DATABASE_URL" -AsSecureString
$ownerPwSec = Read-Host "Enter STAGING Platform Owner initial password" -AsSecureString
$env:DIRECT_DATABASE_URL          = ConvertFrom-SecureStringSafe $adminSec
$env:GSIGN_OWNER_INITIAL_PASSWORD = ConvertFrom-SecureStringSafe $ownerPwSec
$env:GSIGN_OWNER_EMAIL            = "genemaxitsolution@gmail.com"
$env:NODE_ENV                     = "production"

try {
    npm --prefix backend run migrate
    if ($LASTEXITCODE -ne 0) { throw "Migration failed" }
    npm --prefix backend run seed
    if ($LASTEXITCODE -ne 0) { throw "Seed failed" }
}
finally {
    Remove-Item Env:DIRECT_DATABASE_URL, Env:GSIGN_OWNER_EMAIL, Env:GSIGN_OWNER_INITIAL_PASSWORD, Env:NODE_ENV -ErrorAction SilentlyContinue
    Remove-Variable adminSec, ownerPwSec -ErrorAction SilentlyContinue
    [GC]::Collect()
}
```

### Step 3 — Provision `gsign_app` (`NOSUPERUSER`, `NOBYPASSRLS`)
```powershell
$adminSec = Read-Host "Enter STAGING neondb_owner DIRECT_DATABASE_URL" -AsSecureString
$appPwSec = Read-Host "Enter NEW strong password for STAGING gsign_app" -AsSecureString
$env:ADMIN_DATABASE_URL = ConvertFrom-SecureStringSafe $adminSec
$env:APP_ROLE_PASSWORD  = ConvertFrom-SecureStringSafe $appPwSec

$provisionScript = @'
const fs = require('fs');
const { Client } = require('./backend/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await c.connect();
  try {
    await c.query("SELECT set_config('app.runtime_role_password', $1, false)", [process.env.APP_ROLE_PASSWORD]);
    await c.query(fs.readFileSync('backend/scripts/prepare-runtime-role.sql', 'utf8'));
    console.log('gsign_app provisioned on staging.');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.query('RESET app.runtime_role_password').catch(() => {});
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@

try {
    $provisionScript | node -
    if ($LASTEXITCODE -ne 0) { throw "Role provisioning failed" }
}
finally {
    Remove-Item Env:ADMIN_DATABASE_URL, Env:APP_ROLE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable adminSec, appPwSec, provisionScript -ErrorAction SilentlyContinue
    [GC]::Collect()
}
```

### Step 4 — Initialize Staging Identity Marker (`prepare-staging-identity.sql`)
```powershell
$adminSec  = Read-Host "Enter STAGING neondb_owner DIRECT_DATABASE_URL" -AsSecureString
$markerSec = Read-Host "Enter unique STAGING identity marker" -AsSecureString
$env:ADMIN_DATABASE_URL      = ConvertFrom-SecureStringSafe $adminSec
$env:STAGING_IDENTITY_MARKER = ConvertFrom-SecureStringSafe $markerSec

$markerScript = @'
const fs = require('fs');
const { Client } = require('./backend/node_modules/pg');
(async () => {
  const c = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await c.connect();
  try {
    await c.query("SELECT set_config('app.staging_identity_marker', $1, false)", [process.env.STAGING_IDENTITY_MARKER]);
    await c.query(fs.readFileSync('backend/scripts/prepare-staging-identity.sql', 'utf8'));
    console.log('Staging database identity marker initialized.');
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.query('RESET app.staging_identity_marker').catch(() => {});
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@

try {
    $markerScript | node -
    if ($LASTEXITCODE -ne 0) { throw "Staging identity marker setup failed" }
}
finally {
    Remove-Item Env:ADMIN_DATABASE_URL, Env:STAGING_IDENTITY_MARKER -ErrorAction SilentlyContinue
    Remove-Variable adminSec, markerSec, markerScript -ErrorAction SilentlyContinue
    [GC]::Collect()
}
```

### Step 5 — Verify `gsign_app` Privileges & Ownership (`verify-runtime-rls.ts`)
```powershell
$appSec = Read-Host "Enter STAGING gsign_app DATABASE_URL" -AsSecureString
$env:DATABASE_URL = ConvertFrom-SecureStringSafe $appSec

try {
    npx --prefix backend ts-node backend/scripts/verify-runtime-rls.ts
    if ($LASTEXITCODE -ne 0) { throw "Runtime RLS verification failed" }
}
finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Variable appSec -ErrorAction SilentlyContinue
    [GC]::Collect()
}
```

---

## 4. Integration Tests & Build Validation

### Step 6 & 7 — Run RLS & HTTP Integration Tests (with Positive Staging Marker Guard)
```powershell
$adminSec  = Read-Host "Enter STAGING neondb_owner ADMIN_DATABASE_URL (fixture setup/cleanup)" -AsSecureString
$appSec    = Read-Host "Enter STAGING gsign_app DATABASE_URL (runtime under test)" -AsSecureString
$redisSec  = Read-Host "Enter STAGING REDIS_URL" -AsSecureString
$markerSec = Read-Host "Enter STAGING identity marker" -AsSecureString
$mfaSec    = Read-Host "Enter STAGING MFA_ENCRYPTION_KEY (64 hex chars)" -AsSecureString
$stgHost   = Read-Host "Enter exact STAGING DB hostname (e.g. ep-staging-....aws.neon.tech)"
$stgDb     = Read-Host "Enter exact STAGING DB name (e.g. neondb)"

$env:ADMIN_DATABASE_URL                    = ConvertFrom-SecureStringSafe $adminSec
$env:DATABASE_URL                          = ConvertFrom-SecureStringSafe $appSec
$env:REDIS_URL                             = ConvertFrom-SecureStringSafe $redisSec
$env:GSIGN_EXPECTED_STAGING_IDENTITY_MARKER = ConvertFrom-SecureStringSafe $markerSec
$env:MFA_ENCRYPTION_KEY                    = ConvertFrom-SecureStringSafe $mfaSec
$env:GSIGN_EXPECTED_STAGING_DATABASE_HOST  = $stgHost
$env:GSIGN_EXPECTED_STAGING_DATABASE_NAME  = $stgDb
$env:GSIGN_ALLOW_STAGING_INTEGRATION_TESTS = "true"
$env:NODE_ENV                              = "test"

try {
    npm --prefix backend test -- rls-tenant-isolation.spec.ts
    if ($LASTEXITCODE -ne 0) { throw "RLS integration tests failed" }

    npm --prefix backend test -- http-integration.spec.ts
    if ($LASTEXITCODE -ne 0) { throw "HTTP integration tests failed" }
}
finally {
    Remove-Item Env:ADMIN_DATABASE_URL, Env:DATABASE_URL, Env:REDIS_URL, `
        Env:GSIGN_EXPECTED_STAGING_IDENTITY_MARKER, Env:MFA_ENCRYPTION_KEY, `
        Env:GSIGN_EXPECTED_STAGING_DATABASE_HOST, Env:GSIGN_EXPECTED_STAGING_DATABASE_NAME, `
        Env:GSIGN_ALLOW_STAGING_INTEGRATION_TESTS, Env:NODE_ENV -ErrorAction SilentlyContinue
    Remove-Variable adminSec, appSec, redisSec, markerSec, mfaSec, stgHost, stgDb -ErrorAction SilentlyContinue
    [GC]::Collect()
}
```

### Step 8 — Local Staging Build & Smoke Start (Optional)
```powershell
npm run build
npm --prefix backend run build
```
*(To run the backend locally against staging, prompt for `DATABASE_URL` (`gsign_app`), `REDIS_URL`, `S3_*` staging bucket vars, and `MFA_ENCRYPTION_KEY` in a `try { npm --prefix backend run start:prod } finally { ... }` block, clearing all env vars on exit.)*
