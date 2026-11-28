/**
 * Strict safety guard for destructive PostgreSQL integration tests.
 * Prevents accidental execution against production or unverified remote databases.
 * Never logs or includes connection strings or credentials in error messages.
 */
import { Client } from 'pg';

export function parseSafeDatabaseIdentity(url: string, label: string): { host: string; dbName: string } {
  if (!url || typeof url !== 'string') {
    throw new Error(`${label} is missing or empty.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} is malformed and could not be parsed as a URL.`);
  }

  const host = parsed.hostname.trim().toLowerCase();
  const dbName = parsed.pathname.replace(/^\/+/, '').trim().toLowerCase();
  if (!host || !dbName) {
    throw new Error(`${label} must include both a valid hostname and database name.`);
  }

  return { host, dbName };
}

export function assertSafeTestDatabase(url: string, label: string): { host: string; dbName: string } {
  if (process.env.VERCEL) {
    throw new Error(`Refusing to run destructive integration tests in Vercel environment (${label}).`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to run destructive integration tests when NODE_ENV=production (${label}).`);
  }

  const { host, dbName } = parseSafeDatabaseIdentity(url, label);

  // Reject any production-like host or database identifier regardless of opt-in flags
  if (/(^|[._-])prod(uction)?([._-]|$)/i.test(host) || /(^|[._-])prod(uction)?([._-]|$)/i.test(dbName)) {
    throw new Error(
      `Refusing to run destructive integration fixtures against production-like target ${label} (${host}/${dbName}).`,
    );
  }

  const isLocalLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLocalLoopback) {
    if (process.env.GSIGN_ALLOW_STAGING_INTEGRATION_TESTS !== 'true') {
      throw new Error(
        `Refusing to run destructive integration fixtures against non-local ${label} (${host}/${dbName}) without GSIGN_ALLOW_STAGING_INTEGRATION_TESTS=true.`,
      );
    }

    const expectedHost = (process.env.GSIGN_EXPECTED_STAGING_DATABASE_HOST || '').trim().toLowerCase();
    const expectedDbName = (process.env.GSIGN_EXPECTED_STAGING_DATABASE_NAME || '').trim().toLowerCase();

    if (!expectedHost || !expectedDbName) {
      throw new Error(
        `Both GSIGN_EXPECTED_STAGING_DATABASE_HOST and GSIGN_EXPECTED_STAGING_DATABASE_NAME are required for non-local ${label}.`,
      );
    }

    if (host !== expectedHost || dbName !== expectedDbName) {
      throw new Error(
        `Staging identity mismatch for ${label}: expected ${expectedHost}/${expectedDbName}, got ${host}/${dbName}.`,
      );
    }
  }

  return { host, dbName };
}

export function isLocalLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

/**
 * Performs a read-only positive identity check against public.db_environment_identity.
 * Fails closed on missing table, missing row, non-'staging' environment_type,
 * mismatched marker, or query error. Never prints the marker secret or credentials.
 */
export async function verifyStagingDatabaseMarker(
  client: { query: (sql: string) => Promise<{ rows: any[] }> },
  label: string,
): Promise<void> {
  const expectedMarker = (process.env.GSIGN_EXPECTED_STAGING_IDENTITY_MARKER || '').trim();
  if (!expectedMarker) {
    throw new Error(
      `GSIGN_EXPECTED_STAGING_IDENTITY_MARKER is required to verify staging database identity for ${label}.`,
    );
  }

  let res: { rows: any[] };
  try {
    res = await client.query(
      `SELECT environment_type, environment_marker
       FROM public.db_environment_identity
       WHERE id = 1
       LIMIT 1`,
    );
  } catch (err: any) {
    throw new Error(
      `Staging identity verification query failed for ${label}: ${err?.message || 'unknown error'}. Refusing to run destructive fixtures.`,
    );
  }

  if (!res || !Array.isArray(res.rows) || res.rows.length === 0) {
    throw new Error(
      `Staging identity marker row is missing in public.db_environment_identity for ${label}. Refusing to run destructive fixtures.`,
    );
  }

  const row = res.rows[0];
  const envType = String(row.environment_type || '').trim().toLowerCase();
  const actualMarker = String(row.environment_marker || '').trim();

  if (envType !== 'staging') {
    throw new Error(
      `Target database ${label} reported environment_type='${envType || 'unknown'}' instead of 'staging'. Refusing to run destructive fixtures.`,
    );
  }

  if (!actualMarker || actualMarker !== expectedMarker) {
    throw new Error(
      `Staging identity marker mismatch for ${label}. Refusing to run destructive fixtures.`,
    );
  }
}

/**
 * Verifies DATABASE_URL and ADMIN_DATABASE_URL (when present/non-local) BEFORE
 * initializing NestJS or executing any fixture mutations.
 */
export async function verifySafeIntegrationTarget(): Promise<{
  dbUrl: string;
  adminDbUrl: string;
  isNonLocal: boolean;
}> {
  const dbUrl =
    process.env.DATABASE_URL ||
    'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';
  const dbIdentity = assertSafeTestDatabase(dbUrl, 'DATABASE_URL');

  const adminDbUrl = process.env.ADMIN_DATABASE_URL || dbUrl;
  const adminIdentity = assertSafeTestDatabase(adminDbUrl, 'ADMIN_DATABASE_URL');

  if (adminIdentity.host !== dbIdentity.host || adminIdentity.dbName !== dbIdentity.dbName) {
    throw new Error(
      `ADMIN_DATABASE_URL (${adminIdentity.host}/${adminIdentity.dbName}) must target the exact same host and database as DATABASE_URL (${dbIdentity.host}/${dbIdentity.dbName}).`,
    );
  }

  const isNonLocal = !isLocalLoopbackHost(dbIdentity.host);
  if (isNonLocal || process.env.GSIGN_EXPECTED_STAGING_IDENTITY_MARKER) {
    const appClient = new Client({ connectionString: dbUrl });
    await appClient.connect();
    try {
      await verifyStagingDatabaseMarker(appClient, 'DATABASE_URL');
    } finally {
      await appClient.end().catch(() => {});
    }

    if (adminDbUrl !== dbUrl) {
      const admClient = new Client({ connectionString: adminDbUrl });
      await admClient.connect();
      try {
        await verifyStagingDatabaseMarker(admClient, 'ADMIN_DATABASE_URL');
      } finally {
        await admClient.end().catch(() => {});
      }
    }
  }

  return { dbUrl, adminDbUrl, isNonLocal };
}

export async function createSyntheticTenantWithAdmin(
  adminClient: Client,
  runId: string,
  suffix: string,
  planSlug = 'business',
): Promise<{
  tenantId: string;
  userId: string;
  user: { id: string; email: string; full_name: string; fullName: string; role: string; tenantId: string };
}> {
  const tRes = await adminClient.query(
    `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
     VALUES ($1, $2, $3, '+91 90000 00001', 'Active')
     RETURNING id`,
    [`Test Tenant ${suffix} ${runId}`, `test-${suffix}-${runId}`, `admin-${suffix}-${runId}@example.com`],
  );
  const tenantId = tRes.rows[0].id;

  const planRes = await adminClient.query(
    `SELECT id FROM subscription_plans WHERE slug = $1 LIMIT 1`,
    [planSlug],
  );
  if (planRes.rows.length > 0) {
    await adminClient.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end)
       VALUES ($1::uuid, $2::uuid, 'monthly', 'ACTIVE', NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days')`,
      [tenantId, planRes.rows[0].id],
    );
  }

  const email = `admin-${suffix}-${runId}@example.com`;
  const fullName = `Test Admin ${suffix}`;
  const uRes = await adminClient.query(
    `INSERT INTO users (email, password_hash, full_name, is_super_admin, is_active)
     VALUES ($1, 'test-hash', $2, false, true)
     RETURNING id`,
    [email, fullName],
  );
  const userId = uRes.rows[0].id;

  const roleRes = await adminClient.query(`SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`);
  await adminClient.query(
    `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Executive', 'Active')`,
    [tenantId, userId, roleRes.rows[0].id],
  );

  return {
    tenantId,
    userId,
    user: { id: userId, email, full_name: fullName, fullName, role: 'Company Admin', tenantId },
  };
}

export async function cleanupSyntheticFixtures(
  adminClient: Client | null,
  ids: {
    agreementIds?: string[];
    documentIds?: string[];
    templateIds?: string[];
    registrationIds?: string[];
    inviteEmails?: string[];
    tenantIds?: Array<string | null | undefined>;
    userIds?: Array<string | null | undefined>;
  },
): Promise<void> {
  if (!adminClient) return;
  for (const id of ids.agreementIds || []) {
    await adminClient.query(`DELETE FROM agreements WHERE id = $1::uuid`, [id]).catch(() => {});
  }
  for (const id of ids.documentIds || []) {
    await adminClient.query(`DELETE FROM documents WHERE id = $1::uuid`, [id]).catch(() => {});
  }
  for (const id of ids.templateIds || []) {
    await adminClient.query(`DELETE FROM templates WHERE id = $1::uuid`, [id]).catch(() => {});
  }
  for (const id of ids.registrationIds || []) {
    await adminClient.query(`DELETE FROM company_registrations WHERE id = $1::uuid`, [id]).catch(() => {});
  }
  for (const email of ids.inviteEmails || []) {
    await adminClient.query(`DELETE FROM invitations WHERE email = $1`, [email]).catch(() => {});
    await adminClient.query(`DELETE FROM users WHERE email = $1`, [email]).catch(() => {});
  }
  for (const id of ids.tenantIds || []) {
    if (id) await adminClient.query(`DELETE FROM tenants WHERE id = $1::uuid`, [id]).catch(() => {});
  }
  for (const id of ids.userIds || []) {
    if (id) await adminClient.query(`DELETE FROM users WHERE id = $1::uuid`, [id]).catch(() => {});
  }
}
