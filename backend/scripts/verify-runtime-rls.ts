import { Client } from 'pg';

export const EXPECTED_STAGING_HOST = 'ep-green-field-bim0f4kb.c-5.ap-southeast-1.aws.neon.tech';
export const EXPECTED_DATABASE_NAME = 'neondb';
export const EXPECTED_RUNTIME_ROLE = 'gsign_app';

export const NO_ACCESS_TABLES = ['schema_migrations'] as const;
export const SELECT_ONLY_TABLES = [
  'db_environment_identity',
  'roles',
  'permissions',
  'role_permissions',
] as const;
export const NO_DELETE_TABLES = [
  'users',
  'tenants',
  'subscription_plans',
  'company_registrations',
  'user_mfa_configs',
] as const;

export const RECEIPT_APPEND_ONLY_TABLES = ['payment_receipts'] as const;

export const ALL_AUDITED_TABLES = [
  ...NO_ACCESS_TABLES,
  ...SELECT_ONLY_TABLES,
  ...NO_DELETE_TABLES,
  ...RECEIPT_APPEND_ONLY_TABLES,
] as const;

export interface EffectiveTablePrivilegeRow {
  table_name: string;
  table_exists: boolean;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_references: boolean;
  can_trigger: boolean;
}

export interface RoleMembershipRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  has_usage: boolean;
  is_member: boolean;
}

export interface QueryableClient {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
}

export function validateConnectionTarget(databaseUrl: string): {
  host: string;
  database: string;
  username: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is malformed.');
  }

  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\/+/, '');
  const username = decodeURIComponent(parsed.username || '');

  if (host !== EXPECTED_STAGING_HOST) {
    throw new Error(`Staging hostname mismatch: got '${host}', expected '${EXPECTED_STAGING_HOST}'.`);
  }
  if (database !== EXPECTED_DATABASE_NAME) {
    throw new Error(`Staging database mismatch: got '${database}', expected '${EXPECTED_DATABASE_NAME}'.`);
  }
  if (username !== EXPECTED_RUNTIME_ROLE) {
    throw new Error(`Runtime username mismatch: expected '${EXPECTED_RUNTIME_ROLE}'.`);
  }

  return { host, database, username };
}

export function evaluateEffectivePrivileges(rows: EffectiveTablePrivilegeRow[]): string[] {
  const failures: string[] = [];
  const byTable = new Map<string, EffectiveTablePrivilegeRow>();
  for (const row of rows) {
    byTable.set(row.table_name, row);
  }

  // A. schema_migrations: zero effective privileges
  for (const table of NO_ACCESS_TABLES) {
    const row = byTable.get(table);
    if (!row || !row.table_exists) {
      failures.push(`${table} is missing from public schema.`);
      continue;
    }
    const granted = (
      [
        ['SELECT', row.can_select],
        ['INSERT', row.can_insert],
        ['UPDATE', row.can_update],
        ['DELETE', row.can_delete],
        ['TRUNCATE', row.can_truncate],
        ['REFERENCES', row.can_references],
        ['TRIGGER', row.can_trigger],
      ] as const
    )
      .filter(([, allowed]) => allowed)
      .map(([priv]) => priv);

    if (granted.length > 0) {
      failures.push(`${table} must have zero effective privileges, but runtime user has: ${granted.join(', ')}.`);
    }
  }

  // B & C. db_environment_identity, roles, permissions, role_permissions: SELECT only
  for (const table of SELECT_ONLY_TABLES) {
    const row = byTable.get(table);
    if (!row || !row.table_exists) {
      failures.push(`${table} is missing from public schema.`);
      continue;
    }
    if (!row.can_select) {
      failures.push(`${table} must grant effective SELECT privilege to ${EXPECTED_RUNTIME_ROLE}.`);
    }
    const forbidden = (
      [
        ['INSERT', row.can_insert],
        ['UPDATE', row.can_update],
        ['DELETE', row.can_delete],
        ['TRUNCATE', row.can_truncate],
        ['REFERENCES', row.can_references],
        ['TRIGGER', row.can_trigger],
      ] as const
    )
      .filter(([, allowed]) => allowed)
      .map(([priv]) => priv);

    if (forbidden.length > 0) {
      failures.push(`${table} must be SELECT-only, but runtime user has forbidden effective privileges: ${forbidden.join(', ')}.`);
    }
  }

  // D. Core non-deleted tables: must not have DELETE or TRUNCATE
  for (const table of NO_DELETE_TABLES) {
    const row = byTable.get(table);
    if (!row || !row.table_exists) {
      failures.push(`${table} is missing from public schema.`);
      continue;
    }
    const forbidden = (
      [
        ['DELETE', row.can_delete],
        ['TRUNCATE', row.can_truncate],
      ] as const
    )
      .filter(([, allowed]) => allowed)
      .map(([priv]) => priv);

    if (forbidden.length > 0) {
      failures.push(`${table} must not grant effective ${forbidden.join(' or ')} privilege to runtime user.`);
    }
  }

  // E. payment_receipts: must have SELECT, INSERT, UPDATE and must not have DELETE or TRUNCATE
  for (const table of RECEIPT_APPEND_ONLY_TABLES) {
    const row = byTable.get(table);
    if (!row || !row.table_exists) {
      failures.push(`${table} is missing from public schema.`);
      continue;
    }
    const missing = (
      [
        ['SELECT', row.can_select],
        ['INSERT', row.can_insert],
        ['UPDATE', row.can_update],
      ] as const
    )
      .filter(([, allowed]) => !allowed)
      .map(([priv]) => priv);
    if (missing.length > 0) {
      failures.push(`${table} must grant effective ${missing.join(', ')} privilege to ${EXPECTED_RUNTIME_ROLE}.`);
    }
    const forbidden = (
      [
        ['DELETE', row.can_delete],
        ['TRUNCATE', row.can_truncate],
      ] as const
    )
      .filter(([, allowed]) => allowed)
      .map(([priv]) => priv);
    if (forbidden.length > 0) {
      failures.push(`${table} must not grant effective ${forbidden.join(' or ')} privilege to runtime user.`);
    }
  }

  return failures;
}

export function evaluateRoleMemberships(currentUser: string, memberships: RoleMembershipRow[]): string[] {
  const failures: string[] = [];
  for (const m of memberships) {
    if (m.rolname === currentUser) continue;
    if (!m.is_member && !m.has_usage) continue;

    const flags: string[] = [];
    if (m.rolsuper) flags.push('SUPERUSER');
    if (m.rolbypassrls) flags.push('BYPASSRLS');
    if (m.rolcreaterole) flags.push('CREATEROLE');
    if (m.rolcreatedb) flags.push('CREATEDB');
    if (m.rolreplication) flags.push('REPLICATION');
    if (m.rolname === 'neondb_owner') flags.push('OWNER_ROLE');
    if (m.rolname === 'pg_read_all_data' || m.rolname === 'pg_write_all_data') flags.push('PREDEFINED_ALL_DATA_ROLE');
    if (flags.length === 0) flags.push('INHERITED_ROLE');

    failures.push(
      `Runtime role '${currentUser}' inherits unexpected role '${m.rolname}' (is_member=${m.is_member}, has_usage=${m.has_usage}, flags=${flags.join('|')}).`,
    );
  }
  return failures;
}

export async function verifyRuntimeRlsWithClient(
  client: QueryableClient,
  databaseUrl: string,
): Promise<void> {
  validateConnectionTarget(databaseUrl);

  const roleRes = await client.query(`
    SELECT
      current_database() AS database_name,
      current_user AS runtime_role,
      session_user AS session_role,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolreplication,
      has_schema_privilege(current_user, 'public', 'CREATE') AS has_public_create,
      has_schema_privilege(current_user, 'public', 'USAGE') AS has_public_usage,
      CASE
        WHEN current_user <> 'neondb_owner' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neondb_owner')
        THEN pg_has_role(current_user, 'neondb_owner', 'MEMBER')
        ELSE false
      END AS is_neondb_owner_member
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);

  if (roleRes.rows.length === 0) {
    throw new Error('Could not resolve current_user in pg_roles.');
  }

  const role = roleRes.rows[0];
  console.log('=== Runtime Database Role ===');
  console.log(JSON.stringify(role, null, 2));

  if (role.database_name !== EXPECTED_DATABASE_NAME) {
    throw new Error(
      `SECURITY CHECK FAILED: current_database() is '${role.database_name}', expected '${EXPECTED_DATABASE_NAME}'.`,
    );
  }

  if (role.runtime_role !== EXPECTED_RUNTIME_ROLE || role.session_role !== EXPECTED_RUNTIME_ROLE) {
    throw new Error(
      `SECURITY CHECK FAILED: expected current_user and session_user to be '${EXPECTED_RUNTIME_ROLE}', got current_user='${role.runtime_role}', session_user='${role.session_role}'.`,
    );
  }

  if (role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication) {
    throw new Error(
      `SECURITY CHECK FAILED: Runtime role '${role.runtime_role}' has elevated role attributes (rolsuper=${role.rolsuper}, rolbypassrls=${role.rolbypassrls}, rolcreaterole=${role.rolcreaterole}, rolcreatedb=${role.rolcreatedb}, rolreplication=${role.rolreplication}).`,
    );
  }

  if (role.has_public_create) {
    throw new Error(`SECURITY CHECK FAILED: Runtime role '${role.runtime_role}' has CREATE privilege on schema public.`);
  }

  const rlsRes = await client.query(`
    SELECT
      c.relname AS table_name,
      pg_get_userbyid(c.relowner) AS table_owner,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS force_rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  `);

  console.log('\n=== Public Table Ownership & RLS Status ===');
  console.table(rlsRes.rows);

  const ownedAnyTables = rlsRes.rows.filter((r) => r.table_owner === role.runtime_role);
  if (ownedAnyTables.length > 0) {
    throw new Error(
      `SECURITY CHECK FAILED: Runtime role '${role.runtime_role}' owns tables: ${ownedAnyTables.map((t) => t.table_name).join(', ')}.`,
    );
  }

  // Audit ALL direct and indirect role memberships (fail-closed on any unexpected role)
  const membershipRes = await client.query(`
    SELECT
      r.rolname,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolreplication,
      pg_has_role(current_user, r.oid, 'USAGE') AS has_usage,
      pg_has_role(current_user, r.oid, 'MEMBER') AS is_member
    FROM pg_roles r
    WHERE r.rolname <> current_user
      AND (
        pg_has_role(current_user, r.oid, 'MEMBER')
        OR pg_has_role(current_user, r.oid, 'USAGE')
      )
    ORDER BY r.rolname
  `);

  const membershipFailures = evaluateRoleMemberships(role.runtime_role, membershipRes.rows);
  if (role.is_neondb_owner_member && membershipFailures.length === 0) {
    membershipFailures.push(`Runtime role '${role.runtime_role}' is a member of 'neondb_owner'.`);
  }
  if (membershipFailures.length > 0) {
    throw new Error(`SECURITY CHECK FAILED: ${membershipFailures.join(' ')}`);
  }

  // Authoritative effective privilege check via PostgreSQL has_table_privilege()
  const effectivePrivRes = await client.query(
    `
    SELECT
      t.table_name,
      (to_regclass('public.' || t.table_name) IS NOT NULL) AS table_exists,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'SELECT') ELSE false END AS can_select,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'INSERT') ELSE false END AS can_insert,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'UPDATE') ELSE false END AS can_update,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'DELETE') ELSE false END AS can_delete,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'TRUNCATE') ELSE false END AS can_truncate,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'REFERENCES') ELSE false END AS can_references,
      CASE WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN has_table_privilege(current_user, 'public.' || t.table_name, 'TRIGGER') ELSE false END AS can_trigger
    FROM unnest($1::text[]) AS t(table_name)
    ORDER BY t.table_name
  `,
    [ALL_AUDITED_TABLES],
  );

  console.log('\n=== Authoritative Effective Table Privileges (has_table_privilege) ===');
  console.table(effectivePrivRes.rows);

  const effectiveFailures = evaluateEffectivePrivileges(effectivePrivRes.rows);
  if (effectiveFailures.length > 0) {
    throw new Error(`SECURITY CHECK FAILED: ${effectiveFailures.join(' ')}`);
  }

  // Diagnostic check for any remaining public tables having TRUNCATE/TRIGGER/REFERENCES via direct/PUBLIC grants
  const grantsRes = await client.query(`
    SELECT
      grantee,
      table_schema,
      table_name,
      string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
    FROM information_schema.role_table_grants
    WHERE grantee IN (current_user, 'PUBLIC')
      AND table_schema = 'public'
    GROUP BY grantee, table_schema, table_name
    ORDER BY table_name, grantee
  `);

  const forbiddenPrivs = ['TRUNCATE', 'TRIGGER', 'REFERENCES'];
  const overprivilegedTables = grantsRes.rows.filter((g) =>
    forbiddenPrivs.some((p) => String(g.privileges || '').includes(p)),
  );
  if (overprivilegedTables.length > 0) {
    throw new Error(
      `SECURITY CHECK FAILED: Effective privileges include forbidden grants on: ${overprivilegedTables.map((t) => `${t.grantee}:${t.table_name}(${t.privileges})`).join(', ')}`,
    );
  }

  const publicReceiptDelete = grantsRes.rows.find(
    (g) => g.table_name === 'payment_receipts' && g.grantee === 'PUBLIC' && String(g.privileges || '').includes('DELETE'),
  );
  if (publicReceiptDelete) {
    throw new Error('SECURITY CHECK FAILED: PUBLIC must not have DELETE privilege on payment_receipts.');
  }

  const envRes = await client.query(
    `SELECT environment_type FROM public.db_environment_identity WHERE id = 1 LIMIT 1`,
  );
  if (envRes.rows.length !== 1 || String(envRes.rows[0].environment_type || '').toLowerCase() !== 'staging') {
    throw new Error(
      `SECURITY CHECK FAILED: db_environment_identity row id=1 missing or environment_type !== 'staging'.`,
    );
  }

  console.log(
    `\nSECURITY CHECK PASSED: Runtime role '${role.runtime_role}' on '${role.database_name}' is non-superuser, has rolbypassrls=false, has no schema CREATE, owns no tables, inherits no external roles, and passes all authoritative has_table_privilege() assertions.`,
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await verifyRuntimeRlsWithClient(client, databaseUrl);
  } catch (err: any) {
    // Print only safe error message; never print connection string or credentials
    console.error('ERROR during RLS runtime-role verification:', err?.message || 'Unknown database error');
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main();
}
