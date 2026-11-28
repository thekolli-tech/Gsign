import {
  ALL_AUDITED_TABLES,
  EffectiveTablePrivilegeRow,
  EXPECTED_STAGING_HOST,
  NO_DELETE_TABLES,
  RoleMembershipRow,
  SELECT_ONLY_TABLES,
  evaluateEffectivePrivileges,
  evaluateRoleMemberships,
  validateConnectionTarget,
  verifyRuntimeRlsWithClient,
} from '../../scripts/verify-runtime-rls';

function buildValidEffectiveRows(): EffectiveTablePrivilegeRow[] {
  return ALL_AUDITED_TABLES.map((table_name) => {
    if (table_name === 'schema_migrations') {
      return {
        table_name,
        table_exists: true,
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      };
    }
    if ((SELECT_ONLY_TABLES as readonly string[]).includes(table_name)) {
      return {
        table_name,
        table_exists: true,
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      };
    }
    return {
      table_name,
      table_exists: true,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: false,
      can_truncate: false,
      can_references: false,
      can_trigger: false,
    };
  });
}

function createMockClient(overrides?: {
  roleRow?: Record<string, any>;
  memberships?: RoleMembershipRow[];
  effectiveRows?: EffectiveTablePrivilegeRow[];
  grantsRows?: Array<{ grantee: string; table_schema: string; table_name: string; privileges: string }>;
  envRows?: Array<{ environment_type: string }>;
}) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('current_database() AS database_name')) {
        return {
          rows: [
            overrides?.roleRow ?? {
              database_name: 'neondb',
              runtime_role: 'gsign_app',
              session_role: 'gsign_app',
              rolsuper: false,
              rolbypassrls: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolreplication: false,
              has_public_create: false,
              has_public_usage: true,
              is_neondb_owner_member: false,
            },
          ],
        };
      }
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: ALL_AUDITED_TABLES.map((table_name) => ({
            table_name,
            table_owner: 'neondb_owner',
            rls_enabled: true,
            force_rls_enabled: true,
          })),
        };
      }
      if (sql.includes("pg_has_role(current_user, r.oid, 'USAGE')")) {
        return { rows: overrides?.memberships ?? [] };
      }
      if (sql.includes('has_table_privilege(current_user')) {
        return { rows: overrides?.effectiveRows ?? buildValidEffectiveRows() };
      }
      if (sql.includes('FROM information_schema.role_table_grants')) {
        return { rows: overrides?.grantsRows ?? [] };
      }
      if (sql.includes('FROM public.db_environment_identity')) {
        return { rows: overrides?.envRows ?? [{ environment_type: 'staging' }] };
      }
      return { rows: [] };
    }),
  };
}

describe('verify-runtime-rls effective privilege and role membership verification', () => {
  const validStagingUrl = `postgresql://gsign_app:dummy-pass@${EXPECTED_STAGING_HOST}/neondb?sslmode=require`;

  it('passes when SELECT-only, no-access, and no-DELETE effective privileges match least-privilege policy', async () => {
    const rows = buildValidEffectiveRows();
    expect(evaluateEffectivePrivileges(rows)).toEqual([]);
    expect(evaluateRoleMemberships('gsign_app', [])).toEqual([]);

    const client = createMockClient();
    await expect(verifyRuntimeRlsWithClient(client, validStagingUrl)).resolves.toBeUndefined();
  });

  it('rejects direct forbidden privileges on schema_migrations, SELECT-only catalogs, and core non-deleted tables', () => {
    // 1. Direct SELECT on schema_migrations
    const migRows = buildValidEffectiveRows();
    migRows.find((r) => r.table_name === 'schema_migrations')!.can_select = true;
    expect(evaluateEffectivePrivileges(migRows)).toEqual([
      'schema_migrations must have zero effective privileges, but runtime user has: SELECT.',
    ]);

    // 2. Direct INSERT on roles
    const rolesRows = buildValidEffectiveRows();
    rolesRows.find((r) => r.table_name === 'roles')!.can_insert = true;
    expect(evaluateEffectivePrivileges(rolesRows)).toEqual([
      'roles must be SELECT-only, but runtime user has forbidden effective privileges: INSERT.',
    ]);

    // 3. Direct DELETE on users & TRUNCATE on tenants
    const coreRows = buildValidEffectiveRows();
    coreRows.find((r) => r.table_name === 'users')!.can_delete = true;
    coreRows.find((r) => r.table_name === 'tenants')!.can_truncate = true;
    expect(evaluateEffectivePrivileges(coreRows)).toEqual([
      'users must not grant effective DELETE privilege to runtime user.',
      'tenants must not grant effective TRUNCATE privilege to runtime user.',
    ]);

    // 4. payment_receipts: reject DELETE and missing SELECT/INSERT/UPDATE
    const receiptDeleteRows = buildValidEffectiveRows();
    receiptDeleteRows.find((r) => r.table_name === 'payment_receipts')!.can_delete = true;
    expect(evaluateEffectivePrivileges(receiptDeleteRows)).toEqual([
      'payment_receipts must not grant effective DELETE privilege to runtime user.',
    ]);

    const receiptMissingRows = buildValidEffectiveRows();
    receiptMissingRows.find((r) => r.table_name === 'payment_receipts')!.can_update = false;
    expect(evaluateEffectivePrivileges(receiptMissingRows)).toEqual([
      'payment_receipts must grant effective UPDATE privilege to gsign_app.',
    ]);
  });

  it('fails when PUBLIC grants DELETE on payment_receipts', async () => {
    const client = createMockClient({
      grantsRows: [
        {
          grantee: 'PUBLIC',
          table_schema: 'public',
          table_name: 'payment_receipts',
          privileges: 'DELETE',
        },
      ],
    });
    await expect(verifyRuntimeRlsWithClient(client, validStagingUrl)).rejects.toThrow(
      /PUBLIC must not have DELETE privilege on payment_receipts/,
    );
  });

  it('fails when PUBLIC-inherited privilege grants forbidden access via has_table_privilege()', async () => {
    const effectiveRows = buildValidEffectiveRows();
    effectiveRows.find((r) => r.table_name === 'db_environment_identity')!.can_update = true;

    const client = createMockClient({
      effectiveRows,
      grantsRows: [
        {
          grantee: 'PUBLIC',
          table_schema: 'public',
          table_name: 'db_environment_identity',
          privileges: 'SELECT, UPDATE',
        },
      ],
    });

    await expect(verifyRuntimeRlsWithClient(client, validStagingUrl)).rejects.toThrow(
      /db_environment_identity must be SELECT-only.*UPDATE/,
    );
  });

  it('fails when an ordinary custom role (no SUPERUSER/BYPASSRLS) grants inherited privileges', async () => {
    const effectiveRows = buildValidEffectiveRows();
    effectiveRows.find((r) => r.table_name === 'users')!.can_delete = true;

    const customRole: RoleMembershipRow = {
      rolname: 'custom_writer_role',
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      has_usage: true,
      is_member: true,
    };

    expect(evaluateRoleMemberships('gsign_app', [customRole])).toEqual([
      "Runtime role 'gsign_app' inherits unexpected role 'custom_writer_role' (is_member=true, has_usage=true, flags=INHERITED_ROLE).",
    ]);

    const client = createMockClient({
      memberships: [customRole],
      effectiveRows,
    });

    await expect(verifyRuntimeRlsWithClient(client, validStagingUrl)).rejects.toThrow(
      /inherits unexpected role 'custom_writer_role'/,
    );
  });

  it('fails on nested (indirect) role membership at any depth', async () => {
    const nestedMemberships: RoleMembershipRow[] = [
      {
        rolname: 'intermediate_team_role',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        has_usage: true,
        is_member: true,
      },
      {
        rolname: 'deep_inherited_admin_role',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        has_usage: true,
        is_member: true,
      },
    ];

    const failures = evaluateRoleMemberships('gsign_app', nestedMemberships);
    expect(failures).toHaveLength(2);
    expect(failures[1]).toContain('deep_inherited_admin_role');

    const client = createMockClient({ memberships: nestedMemberships });
    await expect(verifyRuntimeRlsWithClient(client, validStagingUrl)).rejects.toThrow(
      /deep_inherited_admin_role/,
    );
  });

  it('fails on pg_read_all_data and pg_write_all_data memberships', async () => {
    const allDataRoles: RoleMembershipRow[] = [
      {
        rolname: 'pg_read_all_data',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        has_usage: true,
        is_member: true,
      },
      {
        rolname: 'pg_write_all_data',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        has_usage: true,
        is_member: true,
      },
    ];

    const failures = evaluateRoleMemberships('gsign_app', allDataRoles);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('PREDEFINED_ALL_DATA_ROLE');
    expect(failures[1]).toContain('PREDEFINED_ALL_DATA_ROLE');

    const client = createMockClient({ memberships: allDataRoles });
    await expect(verifyRuntimeRlsWithClient(client, validStagingUrl)).rejects.toThrow(
      /pg_read_all_data/,
    );
  });

  it('validates no-DELETE access across all 5 core tables and fails if any single table has DELETE', () => {
    for (const table of NO_DELETE_TABLES) {
      const rows = buildValidEffectiveRows();
      rows.find((r) => r.table_name === table)!.can_delete = true;
      expect(evaluateEffectivePrivileges(rows)).toEqual([
        `${table} must not grant effective DELETE privilege to runtime user.`,
      ]);
    }
  });

  it('enforces exact staging hostname, database neondb, and username gsign_app in URL and DB session', async () => {
    expect(() =>
      validateConnectionTarget('postgresql://gsign_app:pw@wrong-host.neon.tech/neondb'),
    ).toThrow(/Staging hostname mismatch/);
    expect(() =>
      validateConnectionTarget(`postgresql://gsign_app:pw@${EXPECTED_STAGING_HOST}/otherdb`),
    ).toThrow(/Staging database mismatch/);
    expect(() =>
      validateConnectionTarget(`postgresql://neondb_owner:pw@${EXPECTED_STAGING_HOST}/neondb`),
    ).toThrow(/Runtime username mismatch/);

    const wrongDbClient = createMockClient({
      roleRow: {
        database_name: 'otherdb',
        runtime_role: 'gsign_app',
        session_role: 'gsign_app',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        has_public_create: false,
        has_public_usage: true,
        is_neondb_owner_member: false,
      },
    });
    await expect(verifyRuntimeRlsWithClient(wrongDbClient, validStagingUrl)).rejects.toThrow(
      /current_database\(\) is 'otherdb', expected 'neondb'/,
    );

    const wrongUserClient = createMockClient({
      roleRow: {
        database_name: 'neondb',
        runtime_role: 'neondb_owner',
        session_role: 'neondb_owner',
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        has_public_create: false,
        has_public_usage: true,
        is_neondb_owner_member: false,
      },
    });
    await expect(verifyRuntimeRlsWithClient(wrongUserClient, validStagingUrl)).rejects.toThrow(
      /expected current_user and session_user to be 'gsign_app'/,
    );
  });
});
