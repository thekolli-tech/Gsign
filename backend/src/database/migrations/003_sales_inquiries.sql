-- Migration 003: Enterprise Contact Sales Inquiries with Platform Owner-only RLS
CREATE TABLE IF NOT EXISTS public.sales_inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_name VARCHAR(128) NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    business_email VARCHAR(255) NOT NULL,
    phone_number VARCHAR(32),
    company_size VARCHAR(64) NOT NULL,
    requested_plan VARCHAR(128) NOT NULL DEFAULT 'Enterprise',
    monthly_agreements VARCHAR(64),
    message TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'closed')),
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    assigned_to_email VARCHAR(255),
    internal_notes TEXT NOT NULL DEFAULT '',
    dedup_hash VARCHAR(64),
    source_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_inquiries_status ON public.sales_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_sales_inquiries_created_at ON public.sales_inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_inquiries_dedup_created ON public.sales_inquiries(dedup_hash, created_at DESC);

ALTER TABLE public.sales_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_inquiries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_owner_sales_inquiries ON public.sales_inquiries;
CREATE POLICY platform_owner_sales_inquiries ON public.sales_inquiries
FOR ALL
USING (NULLIF(current_setting('app.is_super_admin', true), '') = 'true')
WITH CHECK (NULLIF(current_setting('app.is_super_admin', true), '') = 'true');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE public.sales_inquiries TO gsign_app;
    END IF;
END
$$;
