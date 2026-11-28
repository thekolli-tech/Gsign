-- Migration 002: Tenant-scoped payment_receipts table with RLS & FORCE RLS
CREATE TABLE IF NOT EXISTS public.payment_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    receipt_number VARCHAR(64) NOT NULL UNIQUE,
    agreement_id UUID REFERENCES public.agreements(id) ON DELETE SET NULL,
    agreement_number VARCHAR(64),
    payer_name VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    amount_in_words VARCHAR(500) NOT NULL,
    payment_mode VARCHAR(64) NOT NULL DEFAULT 'Pending',
    tx_reference VARCHAR(128),
    purpose VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Payment not confirmed',
    acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    acknowledged_by_name VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    verification_token VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_tenant_id ON public.payment_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status ON public.payment_receipts(status);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_agreement_id ON public.payment_receipts(agreement_id);

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_payment_receipts ON public.payment_receipts;
CREATE POLICY tenant_isolation_payment_receipts ON public.payment_receipts
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_receipts TO gsign_app;
    END IF;
END
$$;
