-- Migration 005: Durable notification_outbox with RLS & FORCE RLS
CREATE TABLE IF NOT EXISTS public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    template_key VARCHAR(64) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'disabled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    provider_message_id VARCHAR(128),
    last_error_code VARCHAR(64),
    last_error_message VARCHAR(500),
    safe_metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_retry
  ON public.notification_outbox(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_tenant_id
  ON public.notification_outbox(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_idempotency
  ON public.notification_outbox(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notification_outbox ON public.notification_outbox;
CREATE POLICY tenant_isolation_notification_outbox ON public.notification_outbox
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR (tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR (tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_outbox TO gsign_app;
    END IF;
END
$$;
