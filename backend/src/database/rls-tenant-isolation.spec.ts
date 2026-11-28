import { Client } from 'pg';
import {
  assertSafeTestDatabase,
  isLocalLoopbackHost,
  verifyStagingDatabaseMarker,
} from './test-db-guard';

describe('PostgreSQL Row-Level Security (RLS) & Multi-Tenant Isolation Tests', () => {
  let adminClient: Client;
  let appClient: Client;
  let tenantAId: string | null = null;
  let tenantBId: string | null = null;
  let userAId: string | null = null;
  let userBId: string | null = null;

  beforeAll(async () => {
    // adminClient connects as administrative role ONLY for fixture setup & cleanup
    const adminDbUrl = process.env.ADMIN_DATABASE_URL || 'postgres://postgres:gsign_dev_password@127.0.0.1:5432/gsign_db';
    // appClient connects as non-superuser gsign_app (NOBYPASSRLS) for all RLS assertions
    const appDbUrl = process.env.DATABASE_URL || 'postgres://gsign_app:gsign_dev_password@127.0.0.1:5432/gsign_db';

    const adminIdentity = assertSafeTestDatabase(adminDbUrl, 'ADMIN_DATABASE_URL');
    const appIdentity = assertSafeTestDatabase(appDbUrl, 'DATABASE_URL');
    if (adminIdentity.host !== appIdentity.host || adminIdentity.dbName !== appIdentity.dbName) {
      throw new Error(
        `ADMIN_DATABASE_URL (${adminIdentity.host}/${adminIdentity.dbName}) must target the exact same host and database as DATABASE_URL (${appIdentity.host}/${appIdentity.dbName}).`,
      );
    }

    adminClient = new Client({ connectionString: adminDbUrl });
    appClient = new Client({ connectionString: appDbUrl });

    await adminClient.connect();
    await appClient.connect();

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Positive read-only staging identity marker check BEFORE any fixture creation/deletion
      if (!isLocalLoopbackHost(appIdentity.host) || process.env.GSIGN_EXPECTED_STAGING_IDENTITY_MARKER) {
        await verifyStagingDatabaseMarker(adminClient, 'ADMIN_DATABASE_URL');
        await verifyStagingDatabaseMarker(appClient, 'DATABASE_URL');
      }
      // Create 2 synthetic test tenants scoped uniquely to this run
      const tARes = await adminClient.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone)
         VALUES ('Tenant Alpha Corp', $1, 'alpha@corp.in', '+91 91111 00000')
         RETURNING id;`,
        [`tenant-alpha-rls-${runId}`]
      );
      tenantAId = tARes.rows[0].id;

      const tBRes = await adminClient.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone)
         VALUES ('Tenant Beta Ltd', $1, 'beta@corp.in', '+91 92222 00000')
         RETURNING id;`,
        [`tenant-beta-rls-${runId}`]
      );
      tenantBId = tBRes.rows[0].id;

      // Create 2 synthetic users scoped uniquely to this run
      const uARes = await adminClient.query(
        `INSERT INTO users (email, password_hash, full_name, is_super_admin)
         VALUES ($1, 'hashA', 'User Alpha', false)
         RETURNING id;`,
        [`userA-${runId}@alpha.in`]
      );
      userAId = uARes.rows[0].id;

      const uBRes = await adminClient.query(
        `INSERT INTO users (email, password_hash, full_name, is_super_admin)
         VALUES ($1, 'hashB', 'User Beta', false)
         RETURNING id;`,
        [`userB-${runId}@beta.in`]
      );
      userBId = uBRes.rows[0].id;

      const roleRes = await adminClient.query(`SELECT id FROM roles LIMIT 1;`);
      const roleId = roleRes.rows[0].id;

      await adminClient.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, 'AlphaDept', 'Active');`,
        [tenantAId, userAId, roleId]
      );

      await adminClient.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, 'BetaDept', 'Active');`,
        [tenantBId, userBId, roleId]
      );

      await adminClient.query(
        `INSERT INTO invitations (tenant_id, email, role_id, department, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, 'BetaDept', $4, NOW() + INTERVAL '7 days', $5);`,
        [tenantBId, `invitee-${runId}@beta.in`, roleId, `token_hash_beta_${runId}`, userBId]
      );
    } catch (err) {
      if (tenantAId) await adminClient.query(`DELETE FROM tenants WHERE id = $1;`, [tenantAId]).catch(() => {});
      if (tenantBId) await adminClient.query(`DELETE FROM tenants WHERE id = $1;`, [tenantBId]).catch(() => {});
      if (userAId) await adminClient.query(`DELETE FROM users WHERE id = $1;`, [userAId]).catch(() => {});
      if (userBId) await adminClient.query(`DELETE FROM users WHERE id = $1;`, [userBId]).catch(() => {});
      await adminClient.end().catch(() => {});
      await appClient.end().catch(() => {});
      throw err;
    }
  });

  afterAll(async () => {
    try {
      if (adminClient) {
        if (tenantAId) await adminClient.query(`DELETE FROM tenants WHERE id = $1;`, [tenantAId]);
        if (tenantBId) await adminClient.query(`DELETE FROM tenants WHERE id = $1;`, [tenantBId]);
        if (userAId) await adminClient.query(`DELETE FROM users WHERE id = $1;`, [userAId]);
        if (userBId) await adminClient.query(`DELETE FROM users WHERE id = $1;`, [userBId]);
      }
    } finally {
      if (adminClient) await adminClient.end().catch(() => {});
      if (appClient) await appClient.end().catch(() => {});
    }
  });

  // TEST 13: RLS Enforcement at Database Level
  it('Requirement 13: RLS must be active and enabled on tenant_memberships, invitations, and sessions', async () => {
    const res = await appClient.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename IN ('tenant_memberships', 'invitations', 'sessions');
    `);

    expect(res.rows).toHaveLength(3);
    for (const row of res.rows) {
      expect(row.rowsecurity).toBe(true);
    }
  });

  // TEST 11: Tenant A attempting to access Tenant B data
  it('Requirement 11: Tenant A context must ONLY see Tenant A data and 0 rows of Tenant B data', async () => {
    // Start an isolated transaction for Tenant A on the non-superuser client
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('app.is_super_admin', 'false', true);");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true);", [tenantAId]);

    // Query tenant_memberships
    const memberships = await appClient.query(`SELECT * FROM tenant_memberships;`);
    expect(memberships.rows).toHaveLength(1);
    expect(memberships.rows[0].tenant_id).toBe(tenantAId);
    expect(memberships.rows[0].user_id).toBe(userAId);

    // Explicit cross-tenant query: Tenant A tries to explicitly SELECT Tenant B records
    const crossQuery = await appClient.query(
      `SELECT * FROM tenant_memberships WHERE tenant_id = $1;`,
      [tenantBId]
    );
    expect(crossQuery.rows).toHaveLength(0); // RLS silently filters out unauthorized rows

    // Query invitations
    const invitations = await appClient.query(`SELECT * FROM invitations;`);
    expect(invitations.rows).toHaveLength(0); // Only Tenant B has an invitation

    await appClient.query('COMMIT');
  });

  // TEST 12: Missing Tenant Context
  it('Requirement 12: Missing or blank tenant context must return 0 rows for non-superadmin queries', async () => {
    await appClient.query('BEGIN');
    // Ensure is_super_admin is false and tenant_id is not set
    await appClient.query("SELECT set_config('app.is_super_admin', 'false', true);");
    await appClient.query("SELECT set_config('app.current_tenant_id', '', true);");

    const memberships = await appClient.query(`SELECT * FROM tenant_memberships;`);
    expect(memberships.rows).toHaveLength(0);

    const invitations = await appClient.query(`SELECT * FROM invitations;`);
    expect(invitations.rows).toHaveLength(0);

    await appClient.query('COMMIT');
  });

  // TEST 14: Super Admin Authorization Boundaries
  it('Requirement 14: Super Admin context must bypass tenant boundaries, but normal admin cannot', async () => {
    // Case 1: Super Admin transaction
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('app.is_super_admin', 'true', true);");
    await appClient.query("SELECT set_config('app.current_tenant_id', '', true);");

    const superAdminView = await appClient.query(
      `SELECT tenant_id FROM tenant_memberships WHERE tenant_id IN ($1, $2);`,
      [tenantAId, tenantBId]
    );
    // Super admin sees records from both Tenant A and Tenant B
    expect(superAdminView.rows).toHaveLength(2);
    const tenantIdsSeen = superAdminView.rows.map(r => r.tenant_id);
    expect(tenantIdsSeen).toContain(tenantAId);
    expect(tenantIdsSeen).toContain(tenantBId);
    await appClient.query('COMMIT');

    // Case 2: Tenant B standard user transaction
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('app.is_super_admin', 'false', true);");
    await appClient.query("SELECT set_config('app.current_tenant_id', $1, true);", [tenantBId]);

    const tenantBView = await appClient.query(
      `SELECT tenant_id FROM tenant_memberships WHERE tenant_id IN ($1, $2);`,
      [tenantAId, tenantBId]
    );
    // Tenant B user sees only Tenant B
    expect(tenantBView.rows).toHaveLength(1);
    expect(tenantBView.rows[0].tenant_id).toBe(tenantBId);
    await appClient.query('COMMIT');
  });
});
