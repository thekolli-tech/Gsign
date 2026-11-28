import * as fs from 'fs';
import * as path from 'path';
import { runMigrations } from './migrate';
import { assertSafeTestDatabase, verifyStagingDatabaseMarker } from './test-db-guard';

describe('Pre-Staging Migration, RLS Policy & Runtime Role Readiness (Mocked/Static Tests)', () => {
  it('runMigrations applies schema_migrations tracking and skips already-applied versioned migrations', async () => {
    const executedSql: string[] = [];
    const mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql: string, params?: any[]) => {
        executedSql.push(sql);
        if (sql.includes('SELECT 1 FROM schema_migrations')) {
          // Simulate migration already applied on an existing production DB
          expect(params?.[0]).toMatch(/^\d{3}_.+\.sql$/);
          return { rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'tenants' }] };
        if (sql.includes('pg_policies')) return { rows: [] };
        if (sql.includes('pg_class')) return { rows: [] };
        return { rows: [] };
      }),
    };

    const pg = require('pg');
    const clientSpy = jest.spyOn(pg, 'Client').mockImplementation(() => mockClient);

    try {
      await runMigrations('postgres://mock:mock@127.0.0.1:5432/mock');
      expect(executedSql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(true);
      expect(executedSql.some((s) => s.includes('INSERT INTO schema_migrations'))).toBe(false);
    } finally {
      clientSpy.mockRestore();
    }
  });

  it('runMigrations applies unapplied versioned migration 001 inside a transaction', async () => {
    const executedSql: string[] = [];
    const mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql: string) => {
        executedSql.push(sql);
        if (sql.includes('SELECT 1 FROM schema_migrations')) return { rows: [] };
        if (sql.includes('information_schema.tables')) return { rows: [] };
        if (sql.includes('pg_policies')) return { rows: [] };
        if (sql.includes('pg_class')) return { rows: [] };
        return { rows: [] };
      }),
    };

    const pg = require('pg');
    const clientSpy = jest.spyOn(pg, 'Client').mockImplementation(() => mockClient);

    try {
      await runMigrations('postgres://mock:mock@127.0.0.1:5432/mock');
      expect(executedSql.some((s) => s.includes('tenant_isolation_audit_logs'))).toBe(true);
      expect(executedSql.some((s) => s.includes('tenant_isolation_support_access_sessions'))).toBe(true);
      expect(executedSql.some((s) => s.includes('INSERT INTO schema_migrations'))).toBe(true);
    } finally {
      clientSpy.mockRestore();
    }
  });

  it('migration 001 and schema.sql enforce FORCE ROW LEVEL SECURITY on audit_logs and support_access_sessions', () => {
    const migrationSql = fs.readFileSync(
      path.join(__dirname, 'migrations', '001_nobypassrls_rls_and_schema_readiness.sql'),
      'utf8',
    );
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    for (const sql of [migrationSql, schemaSql]) {
      expect(sql).toMatch(/ALTER TABLE (?:public\.)?audit_logs ENABLE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(/ALTER TABLE (?:public\.)?audit_logs FORCE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(/CREATE POLICY tenant_isolation_audit_logs ON (?:public\.)?audit_logs/i);
      expect(sql).toMatch(/ALTER TABLE (?:public\.)?support_access_sessions ENABLE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(/ALTER TABLE (?:public\.)?support_access_sessions FORCE ROW LEVEL SECURITY/i);
      expect(sql).toMatch(
        /CREATE POLICY tenant_isolation_support_access_sessions ON (?:public\.)?support_access_sessions/i,
      );
    }
  });

  it('prepare-runtime-role.sql enforces least-privilege NOBYPASSRLS without hardcoded secrets', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'prepare-runtime-role.sql'),
      'utf8',
    );

    expect(sql).toContain('NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION');
    expect(sql).toContain('REVOKE neondb_owner FROM gsign_app');
    expect(sql).toContain('REVOKE CREATE ON SCHEMA public FROM gsign_app');
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM gsign_app');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gsign_app');
    expect(sql).toContain('REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON TABLE public.schema_migrations FROM gsign_app');
    expect(sql).toContain('GRANT SELECT ON TABLE public.db_environment_identity TO gsign_app');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.roles FROM gsign_app');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.permissions FROM gsign_app');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.role_permissions FROM gsign_app');
    expect(sql).toContain('REVOKE DELETE ON TABLE public.users FROM gsign_app');
    expect(sql).toContain('REVOKE DELETE ON TABLE public.tenants FROM gsign_app');
    expect(sql).toContain('REVOKE DELETE ON TABLE public.subscription_plans FROM gsign_app');
    expect(sql).toContain('REVOKE DELETE ON TABLE public.company_registrations FROM gsign_app');
    expect(sql).toContain('REVOKE DELETE ON TABLE public.user_mfa_configs FROM gsign_app');
    expect(sql).toContain('RESET app.runtime_role_password');
    expect(sql).not.toMatch(/PASSWORD\s+'[^']+'/i);
  });

  describe('Integration test database safety guard (assertSafeTestDatabase)', () => {
    const origEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...origEnv };
    });

    it('blocks non-local Neon URL even without "prod" in host when staging opt-in or expected host/db are missing', () => {
      delete process.env.VERCEL;
      process.env.NODE_ENV = 'test';
      delete process.env.GSIGN_ALLOW_STAGING_INTEGRATION_TESTS;
      delete process.env.GSIGN_EXPECTED_STAGING_DATABASE_HOST;
      delete process.env.GSIGN_EXPECTED_STAGING_DATABASE_NAME;

      expect(() =>
        assertSafeTestDatabase('postgres://u:p@ep-cool-darkness-123456.ap-southeast-1.aws.neon.tech/neondb', 'DATABASE_URL'),
      ).toThrow(/GSIGN_ALLOW_STAGING_INTEGRATION_TESTS=true/);

      process.env.GSIGN_ALLOW_STAGING_INTEGRATION_TESTS = 'true';
      expect(() =>
        assertSafeTestDatabase('postgres://u:p@ep-cool-darkness-123456.ap-southeast-1.aws.neon.tech/neondb', 'DATABASE_URL'),
      ).toThrow(/GSIGN_EXPECTED_STAGING_DATABASE_HOST/);
    });

    it('rejects host/database mismatches, production-like identifiers, malformed URLs, and VERCEL env', () => {
      delete process.env.VERCEL;
      process.env.NODE_ENV = 'test';
      process.env.GSIGN_ALLOW_STAGING_INTEGRATION_TESTS = 'true';
      process.env.GSIGN_EXPECTED_STAGING_DATABASE_HOST = 'ep-staging-branch-111.aws.neon.tech';
      process.env.GSIGN_EXPECTED_STAGING_DATABASE_NAME = 'gsign_staging';

      // Mismatched host (e.g. production Neon branch without "prod" in name)
      expect(() =>
        assertSafeTestDatabase('postgres://u:secretpass@ep-other-branch-999.aws.neon.tech/gsign_staging', 'DATABASE_URL'),
      ).toThrow(/Staging identity mismatch/);

      // Ensure credentials are never leaked in error message
      try {
        assertSafeTestDatabase('postgres://u:supersecret123@ep-other-branch-999.aws.neon.tech/gsign_staging', 'DATABASE_URL');
      } catch (e: any) {
        expect(e.message).not.toContain('supersecret123');
      }

      // Production-like identifier rejected even if expected vars match
      process.env.GSIGN_EXPECTED_STAGING_DATABASE_HOST = 'ep-prod-111.aws.neon.tech';
      expect(() =>
        assertSafeTestDatabase('postgres://u:p@ep-prod-111.aws.neon.tech/gsign_staging', 'DATABASE_URL'),
      ).toThrow(/production-like target/);

      // Malformed URL rejected
      expect(() => assertSafeTestDatabase('not-a-url', 'DATABASE_URL')).toThrow(/malformed/);

      // VERCEL rejected
      process.env.VERCEL = '1';
      expect(() => assertSafeTestDatabase('postgres://u:p@127.0.0.1:5432/gsign_db', 'DATABASE_URL')).toThrow(/Vercel/);
    });

    it('allows exact staging host + db match when opted in, and allows local loopback in test mode', () => {
      delete process.env.VERCEL;
      process.env.NODE_ENV = 'test';
      process.env.GSIGN_ALLOW_STAGING_INTEGRATION_TESTS = 'true';
      process.env.GSIGN_EXPECTED_STAGING_DATABASE_HOST = 'ep-staging-branch-111.aws.neon.tech';
      process.env.GSIGN_EXPECTED_STAGING_DATABASE_NAME = 'gsign_staging';

      expect(
        assertSafeTestDatabase('postgres://u:p@ep-staging-branch-111.aws.neon.tech/gsign_staging', 'DATABASE_URL'),
      ).toEqual({
        host: 'ep-staging-branch-111.aws.neon.tech',
        dbName: 'gsign_staging',
      });

      expect(assertSafeTestDatabase('postgres://u:p@127.0.0.1:5432/gsign_db', 'DATABASE_URL')).toEqual({
        host: '127.0.0.1',
        dbName: 'gsign_db',
      });
    });

    it('verifyStagingDatabaseMarker accepts valid staging marker and rejects missing, production, mismatched, or failing queries without leaking marker secrets', async () => {
      process.env.GSIGN_EXPECTED_STAGING_IDENTITY_MARKER = 'stg-marker-secret-2026';

      // 1. Correct staging marker
      const validClient = {
        query: jest.fn(async () => ({
          rows: [{ environment_type: 'staging', environment_marker: 'stg-marker-secret-2026' }],
        })),
      };
      await expect(verifyStagingDatabaseMarker(validClient, 'DATABASE_URL')).resolves.toBeUndefined();

      // 2. Missing marker row
      const emptyClient = { query: jest.fn(async () => ({ rows: [] })) };
      await expect(verifyStagingDatabaseMarker(emptyClient, 'DATABASE_URL')).rejects.toThrow(/missing/);

      // 3. Production environment marker
      const prodClient = {
        query: jest.fn(async () => ({
          rows: [{ environment_type: 'production', environment_marker: 'stg-marker-secret-2026' }],
        })),
      };
      await expect(verifyStagingDatabaseMarker(prodClient, 'DATABASE_URL')).rejects.toThrow(/production/);

      // 4. Wrong staging identifier (and never leaks marker secret)
      const wrongMarkerClient = {
        query: jest.fn(async () => ({
          rows: [{ environment_type: 'staging', environment_marker: 'different-secret-999' }],
        })),
      };
      try {
        await verifyStagingDatabaseMarker(wrongMarkerClient, 'DATABASE_URL');
        fail('Expected mismatch error');
      } catch (err: any) {
        expect(err.message).toMatch(/mismatch/);
        expect(err.message).not.toContain('stg-marker-secret-2026');
        expect(err.message).not.toContain('different-secret-999');
      }

      // 5. Database query failure (fail closed)
      const failingClient = {
        query: jest.fn(async () => {
          throw new Error('relation "public.db_environment_identity" does not exist');
        }),
      };
      await expect(verifyStagingDatabaseMarker(failingClient, 'DATABASE_URL')).rejects.toThrow(
        /verification query failed/,
      );

      // 6. Missing GSIGN_EXPECTED_STAGING_IDENTITY_MARKER env var
      delete process.env.GSIGN_EXPECTED_STAGING_IDENTITY_MARKER;
      await expect(verifyStagingDatabaseMarker(validClient, 'DATABASE_URL')).rejects.toThrow(
        /GSIGN_EXPECTED_STAGING_IDENTITY_MARKER/,
      );

      // 7. No fixture INSERT or DELETE runs when verifyStagingDatabaseMarker fails before setup
      const setupQueries: string[] = [];
      const guardedClient = {
        query: jest.fn(async (sql: string) => {
          setupQueries.push(sql);
          return { rows: [{ environment_type: 'production', environment_marker: 'x' }] };
        }),
      };
      process.env.GSIGN_EXPECTED_STAGING_IDENTITY_MARKER = 'stg-marker-secret-2026';
      await expect(verifyStagingDatabaseMarker(guardedClient, 'ADMIN_DATABASE_URL')).rejects.toThrow();
      expect(setupQueries.some((q) => /^\s*(INSERT|DELETE|UPDATE)/i.test(q))).toBe(false);
    });
  });
});
