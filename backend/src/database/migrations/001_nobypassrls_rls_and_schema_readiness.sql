-- Migration 001: Pre-staging hardening for NOBYPASSRLS runtime role
-- Safe and idempotent for already-existing production/staging databases.

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

CREATE INDEX IF NOT EXISTS idx_support_access_sessions_tenant_id
    ON public.support_access_sessions(tenant_id);

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
