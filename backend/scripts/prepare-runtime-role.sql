-- GSIGN Production Security Task: Dedicated NOBYPASSRLS Runtime Role Setup
-- Execute ONLY as the database owner / migration role (e.g. neondb_owner).
-- DO NOT commit or embed passwords in this file.
--
-- Usage (psql / PowerShell):
--   1. Set session parameter before running, e.g.:
--      SET app.runtime_role_password = '<secure-random-password>';
--   2. Execute this script inside a transaction.
--   3. Reset or close the session immediately after execution.

BEGIN;

-- 1. Create or harden the dedicated runtime role (NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB)
DO $$
DECLARE
  v_password TEXT := NULLIF(current_setting('app.runtime_role_password', true), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
    IF v_password IS NULL THEN
      RAISE EXCEPTION 'Session setting app.runtime_role_password is required to create role gsign_app.';
    END IF;
    EXECUTE format(
      'CREATE ROLE gsign_app WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION',
      v_password
    );
  ELSE
    ALTER ROLE gsign_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
    IF v_password IS NOT NULL THEN
      EXECUTE format('ALTER ROLE gsign_app WITH PASSWORD %L', v_password);
    END IF;
  END IF;
END
$$;

-- 2. Ensure schema objects previously created lazily by TenantsController exist under neondb_owner
--    so the non-owner runtime role never needs DDL privileges at runtime.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS branding_json JSONB;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS feature_flags_json JSONB;

CREATE TABLE IF NOT EXISTS public.support_access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES public.users(id),
  granted_by_email VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'Active',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_access_sessions_tenant_id ON public.support_access_sessions(tenant_id);

-- Enforce tenant isolation RLS on audit_logs and support_access_sessions
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_audit_logs ON public.audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON public.audit_logs
FOR ALL
USING (
  NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

DROP POLICY IF EXISTS tenant_isolation_support_access_sessions ON public.support_access_sessions;
CREATE POLICY tenant_isolation_support_access_sessions ON public.support_access_sessions
FOR ALL
USING (
  NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
  OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- 3. Restrict schema public creation, prevent role inheritance, and grant least-privilege access
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neondb_owner')
     AND pg_has_role('gsign_app', 'neondb_owner', 'MEMBER') THEN
    REVOKE neondb_owner FROM gsign_app;
  END IF;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM gsign_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO gsign_app', current_database());
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM gsign_app;
GRANT USAGE ON SCHEMA public TO gsign_app;

-- 4. Grant strictly DML privileges on existing public tables, sequences, and functions
--    Explicitly revoke TRUNCATE, TRIGGER, REFERENCES; ownership remains with neondb_owner.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM gsign_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gsign_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gsign_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gsign_app;

-- 4a. Migration metadata table: no runtime privileges for PUBLIC or gsign_app
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.schema_migrations FROM PUBLIC;
    REVOKE ALL ON TABLE public.schema_migrations FROM gsign_app;
  END IF;
END
$$;

-- 4b. Staging identity marker (when present): strictly SELECT-only for gsign_app
DO $$
BEGIN
  IF to_regclass('public.db_environment_identity') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.db_environment_identity FROM PUBLIC;
    REVOKE ALL ON TABLE public.db_environment_identity FROM gsign_app;
    GRANT SELECT ON TABLE public.db_environment_identity TO gsign_app;
  END IF;
END
$$;

-- 4c. Global RBAC catalogs: SELECT-only for gsign_app
REVOKE INSERT, UPDATE, DELETE ON TABLE public.roles FROM gsign_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.permissions FROM gsign_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.role_permissions FROM gsign_app;

-- 4d. Core non-deleted tables: revoke unnecessary DELETE privilege
REVOKE DELETE ON TABLE public.users FROM gsign_app;
REVOKE DELETE ON TABLE public.tenants FROM gsign_app;
REVOKE DELETE ON TABLE public.subscription_plans FROM gsign_app;
REVOKE DELETE ON TABLE public.company_registrations FROM gsign_app;
REVOKE DELETE ON TABLE public.user_mfa_configs FROM gsign_app;

-- 5. Ensure future migrations run by neondb_owner automatically grant DML to gsign_app
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gsign_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gsign_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO gsign_app;

COMMIT;

-- Clear session password setting immediately after provisioning
RESET app.runtime_role_password;
