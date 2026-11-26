-- GSIGN Foundation Schema & Row-Level Security (RLS) Migrations
-- Target: PostgreSQL 16+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tenants
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(64) NOT NULL UNIQUE,
    cin VARCHAR(21),
    gstin VARCHAR(15),
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(20) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Active',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branding_json JSONB;

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_deleted_at ON tenants(deleted_at);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    phone_number VARCHAR(20),
    is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_platform_owner BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure columns exist if table was already created
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- 3. Roles
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for system global roles
    name VARCHAR(64) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON roles(tenant_id);

-- 4. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    category VARCHAR(64) NOT NULL,
    description TEXT
);

CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(code);

-- 5. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 6. Tenant Memberships
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id),
    department VARCHAR(64) NOT NULL DEFAULT 'Executive',
    status VARCHAR(32) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON tenant_memberships(user_id);

-- 7. Invitations
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id),
    department VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant_id ON invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON invitations(token_hash);

-- 8. Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 9. User MFA Configs (RFC 6238 TOTP)
CREATE TABLE IF NOT EXISTS user_mfa_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    recovery_codes_hash TEXT[] NOT NULL DEFAULT '{}',
    confirmed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. MFA Recovery Codes
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_id ON mfa_recovery_codes(user_id);

-- 11. Company Registrations (Pending Email Verification and Subscription Selection)
CREATE TABLE IF NOT EXISTS company_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    business_email VARCHAR(255) NOT NULL UNIQUE,
    business_phone VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'India',
    state VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    website VARCHAR(255),
    admin_full_name VARCHAR(128) NOT NULL,
    admin_email VARCHAR(255) NOT NULL UNIQUE,
    admin_password_hash TEXT NOT NULL,
    selected_plan_id UUID,
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION', -- PENDING_VERIFICATION, EMAIL_VERIFIED, PAYMENT_PENDING, COMPLETED, REJECTED
    tenant_id UUID REFERENCES tenants(id),
    admin_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_registrations_email ON company_registrations(business_email);
CREATE INDEX IF NOT EXISTS idx_company_registrations_status ON company_registrations(status);

-- 12. Email Verification Tokens (Hashed, Single-Use, Expiring)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES company_registrations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification_tokens(token_hash);

-- 13. Subscription Plans (Strictly Paid Plans - NO FREE TRIAL)
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL UNIQUE,
    slug VARCHAR(64) NOT NULL UNIQUE,
    description TEXT,
    monthly_price NUMERIC(10, 2) NOT NULL,
    annual_price NUMERIC(10, 2) NOT NULL,
    max_agreements_per_month INTEGER NOT NULL,
    max_users INTEGER NOT NULL,
    features JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Tenant Subscriptions
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, ACTIVE, PAYMENT_PENDING, PAST_DUE, SUSPENDED, EXPIRED, CANCELLED
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    grace_period_end TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_id ON tenant_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status ON tenant_subscriptions(status);

-- 15. Payments (Provider Adapter & Audit Records)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    provider VARCHAR(32) NOT NULL DEFAULT 'SIMULATED', -- RAZORPAY, STRIPE, MANUAL, SIMULATED
    provider_transaction_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED, REFUNDED
    payment_method VARCHAR(64),
    verified_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 16. Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    invoice_number VARCHAR(64) NOT NULL UNIQUE,
    amount NUMERIC(10, 2) NOT NULL,
    tax_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PAID',
    pdf_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);

-- 17. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255) NOT NULL,
    actor_role VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(64),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- 18. Usage Records
CREATE TABLE IF NOT EXISTS usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    agreements_created INTEGER NOT NULL DEFAULT 0,
    agreements_completed INTEGER NOT NULL DEFAULT 0,
    storage_bytes_used BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_usage_period UNIQUE (tenant_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_records_tenant_id ON usage_records(tenant_id);

-- 19. Agreements
CREATE TABLE IF NOT EXISTS agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_number VARCHAR(32) NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    recipient_name VARCHAR(128) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL DEFAULT '',
    template_type VARCHAR(64) NOT NULL,
    department VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Draft', -- Draft, Awaiting OTP, Awaiting signature, Completed, Expired, Rejected, Cancelled
    fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    period VARCHAR(64) NOT NULL DEFAULT '12 months',
    content TEXT NOT NULL,
    sign_method VARCHAR(32) NOT NULL DEFAULT 'basic_drawn', -- basic_drawn, otp_verified, aadhaar_esign, dsc
    signature_data_url TEXT,
    document_hash VARCHAR(64) NOT NULL,
    witness_required BOOLEAN NOT NULL DEFAULT FALSE,
    witness_name VARCHAR(128),
    sent_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_agreement_number UNIQUE (tenant_id, agreement_number)
);

CREATE INDEX IF NOT EXISTS idx_agreements_tenant_id ON agreements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON agreements(status);
CREATE INDEX IF NOT EXISTS idx_agreements_created_by ON agreements(created_by);

-- 20. Agreement Audit Trail Events
CREATE TABLE IF NOT EXISTS agreement_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    event_type VARCHAR(32) NOT NULL, -- created, sent, viewed, otp, consent, signed, pdf, payment
    ip_address VARCHAR(45),
    device_info TEXT,
    document_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agreement_events_tenant_id ON agreement_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agreement_events_agreement_id ON agreement_events(agreement_id);

-- 21. Agreement Templates
CREATE TABLE IF NOT EXISTS templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    is_global BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Offer Letter',
    department VARCHAR(64) NOT NULL DEFAULT 'HR',
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'Draft', -- Draft, Published, Archived
    current_version INTEGER NOT NULL DEFAULT 1,
    published_version INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE templates ALTER COLUMN tenant_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_templates_tenant_id ON templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);

-- 22. Template Versions (Immutable history; publishing locks version)
CREATE TABLE IF NOT EXISTS template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Draft', -- Draft, Published, Archived
    content TEXT NOT NULL,
    fields_json JSONB NOT NULL DEFAULT '[]',
    created_by UUID NOT NULL REFERENCES users(id),
    published_by UUID REFERENCES users(id),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_template_version UNIQUE (template_id, version_number)
);

ALTER TABLE template_versions ALTER COLUMN tenant_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_template_versions_tenant_id ON template_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_template_id ON template_versions(template_id);

-- 23. Signing Requests
CREATE TABLE IF NOT EXISTS signing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    sequential BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, REVOKED, EXPIRED, REJECTED
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signing_requests_tenant_id ON signing_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_signing_requests_agreement_id ON signing_requests(agreement_id);

-- 24. Signing Recipients (Token hash only; raw token is never persisted)
CREATE TABLE IF NOT EXISTS signing_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    signing_request_id UUID NOT NULL REFERENCES signing_requests(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    email VARCHAR(255) NOT NULL,
    signing_order INTEGER NOT NULL DEFAULT 1,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    sign_method VARCHAR(32) NOT NULL DEFAULT 'basic_drawn',
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    token_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    otp_verified_at TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, OTP_VERIFIED, SIGNED, REJECTED, REVOKED, EXPIRED
    signed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signing_recipients_tenant_id ON signing_recipients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_signing_recipients_request_id ON signing_recipients(signing_request_id);
CREATE INDEX IF NOT EXISTS idx_signing_recipients_token_hash ON signing_recipients(token_hash);

-- 25. Signing Email OTP Attempts
CREATE TABLE IF NOT EXISTS signing_otp_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES signing_recipients(id) ON DELETE CASCADE,
    otp_hash VARCHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signing_otp_attempts_recipient_id ON signing_otp_attempts(recipient_id);

-- 26. Immutable Signature Records
CREATE TABLE IF NOT EXISTS signature_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    signing_request_id UUID NOT NULL REFERENCES signing_requests(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL UNIQUE REFERENCES signing_recipients(id) ON DELETE CASCADE,
    signature_data_url TEXT NOT NULL,
    document_hash VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_records_agreement_id ON signature_records(agreement_id);

-- 27. Immutable Consent Records
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL UNIQUE REFERENCES signing_recipients(id) ON DELETE CASCADE,
    consent_text TEXT NOT NULL,
    accepted BOOLEAN NOT NULL DEFAULT TRUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_agreement_id ON consent_records(agreement_id);

-- 28. Document Metadata (Original, Generated PDF, Signed PDF, Certificate)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID REFERENCES agreements(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    doc_kind VARCHAR(32) NOT NULL DEFAULT 'original', -- original, generated_pdf, signed_pdf, certificate
    current_version INTEGER NOT NULL DEFAULT 1,
    original_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ARCHIVED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_agreement_id ON documents(agreement_id);

-- 29. Immutable Document Version History
CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    agreement_id UUID REFERENCES agreements(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    version_kind VARCHAR(32) NOT NULL DEFAULT 'original', -- original, generated_pdf, signed_pdf, certificate
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    byte_size BIGINT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    storage_provider VARCHAR(32) NOT NULL DEFAULT 's3', -- s3, local_private
    storage_bucket VARCHAR(128) NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    is_immutable BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_document_version_number UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_tenant_id ON document_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_agreement_id ON document_versions(agreement_id);

-- 30. Signing Completion Certificates / Receipts
CREATE TABLE IF NOT EXISTS signing_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    signing_request_id UUID REFERENCES signing_requests(id) ON DELETE SET NULL,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    document_version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    certificate_number VARCHAR(64) NOT NULL UNIQUE,
    agreement_sha256 VARCHAR(64) NOT NULL,
    final_pdf_sha256 VARCHAR(64) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_signing_certificates_tenant_id ON signing_certificates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_signing_certificates_agreement_id ON signing_certificates(agreement_id);

-- 31. Document Access Audit Logs
CREATE TABLE IF NOT EXISTS document_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    document_version_id UUID REFERENCES document_versions(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(48) NOT NULL, -- UPLOAD, GENERATE_PDF, GENERATE_SIGNED_PDF, GENERATE_CERTIFICATE, DOWNLOAD, PRESIGNED_URL, VERIFY_INTEGRITY
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_access_logs_tenant_id ON document_access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_access_logs_document_id ON document_access_logs(document_id);

-- 32. Recoverable Signing Finalization State
CREATE TABLE IF NOT EXISTS signing_finalizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agreement_id UUID NOT NULL UNIQUE REFERENCES agreements(id) ON DELETE CASCADE,
    signing_request_id UUID REFERENCES signing_requests(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, COMPLETED, FAILED
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    signed_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    certificate_id UUID REFERENCES signing_certificates(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signing_finalizations_tenant_id ON signing_finalizations(tenant_id);

-- 33. Storage Cleanup & Reconciliation Queue
CREATE TABLE IF NOT EXISTS storage_cleanup_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    storage_provider VARCHAR(32) NOT NULL,
    storage_bucket VARCHAR(128) NOT NULL,
    storage_key TEXT NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, CLEANED, FAILED
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_tasks_tenant_id ON storage_cleanup_tasks(tenant_id);

-- =========================================================
-- POSTGRESQL ROW-LEVEL SECURITY (RLS) POLICIES
-- =========================================================

-- Enable RLS on Tenant-Scoped Tables
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_otp_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_cleanup_tasks ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners / application roles
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
ALTER TABLE agreements FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_events FORCE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;
ALTER TABLE template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE signing_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE signing_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE signing_otp_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE signature_records FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE signing_certificates FORCE ROW LEVEL SECURITY;
ALTER TABLE document_access_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE signing_finalizations FORCE ROW LEVEL SECURITY;
ALTER TABLE storage_cleanup_tasks FORCE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_memberships ON tenant_memberships;
DROP POLICY IF EXISTS tenant_isolation_invitations ON invitations;
DROP POLICY IF EXISTS tenant_isolation_sessions ON sessions;
DROP POLICY IF EXISTS tenant_isolation_subscriptions ON tenant_subscriptions;
DROP POLICY IF EXISTS tenant_isolation_payments ON payments;
DROP POLICY IF EXISTS tenant_isolation_invoices ON invoices;
DROP POLICY IF EXISTS tenant_isolation_usage ON usage_records;
DROP POLICY IF EXISTS tenant_isolation_agreements ON agreements;
DROP POLICY IF EXISTS tenant_isolation_agreement_events ON agreement_events;
DROP POLICY IF EXISTS tenant_isolation_templates ON templates;
DROP POLICY IF EXISTS tenant_isolation_template_versions ON template_versions;
DROP POLICY IF EXISTS tenant_isolation_signing_requests ON signing_requests;
DROP POLICY IF EXISTS tenant_isolation_signing_recipients ON signing_recipients;
DROP POLICY IF EXISTS tenant_isolation_signing_otp_attempts ON signing_otp_attempts;
DROP POLICY IF EXISTS tenant_isolation_signature_records ON signature_records;
DROP POLICY IF EXISTS tenant_isolation_consent_records ON consent_records;
DROP POLICY IF EXISTS tenant_isolation_documents ON documents;
DROP POLICY IF EXISTS tenant_isolation_document_versions ON document_versions;
DROP POLICY IF EXISTS tenant_isolation_signing_certificates ON signing_certificates;
DROP POLICY IF EXISTS tenant_isolation_document_access_logs ON document_access_logs;
DROP POLICY IF EXISTS tenant_isolation_signing_finalizations ON signing_finalizations;
DROP POLICY IF EXISTS tenant_isolation_storage_cleanup_tasks ON storage_cleanup_tasks;

-- RLS Policy on tenant_memberships:
-- Evaluates app.is_super_admin = 'true' OR tenant_id = app.current_tenant_id
CREATE POLICY tenant_isolation_memberships ON tenant_memberships
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on invitations:
CREATE POLICY tenant_isolation_invitations ON invitations
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on sessions:
CREATE POLICY tenant_isolation_sessions ON sessions
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on tenant_subscriptions:
CREATE POLICY tenant_isolation_subscriptions ON tenant_subscriptions
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on payments:
CREATE POLICY tenant_isolation_payments ON payments
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on invoices:
CREATE POLICY tenant_isolation_invoices ON invoices
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on usage_records:
CREATE POLICY tenant_isolation_usage ON usage_records
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on agreements:
CREATE POLICY tenant_isolation_agreements ON agreements
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on agreement_events:
CREATE POLICY tenant_isolation_agreement_events ON agreement_events
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on templates:
CREATE POLICY tenant_isolation_templates ON templates
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR is_global = true
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on template_versions:
CREATE POLICY tenant_isolation_template_versions ON template_versions
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR EXISTS (
        SELECT 1 FROM templates t
        WHERE t.id = template_versions.template_id AND t.is_global = true
    )
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on signing_requests:
CREATE POLICY tenant_isolation_signing_requests ON signing_requests
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on signing_recipients:
CREATE POLICY tenant_isolation_signing_recipients ON signing_recipients
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on signing_otp_attempts:
CREATE POLICY tenant_isolation_signing_otp_attempts ON signing_otp_attempts
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on signature_records:
CREATE POLICY tenant_isolation_signature_records ON signature_records
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on consent_records:
CREATE POLICY tenant_isolation_consent_records ON consent_records
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on documents:
CREATE POLICY tenant_isolation_documents ON documents
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on document_versions:
CREATE POLICY tenant_isolation_document_versions ON document_versions
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on signing_certificates:
CREATE POLICY tenant_isolation_signing_certificates ON signing_certificates
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on document_access_logs:
CREATE POLICY tenant_isolation_document_access_logs ON document_access_logs
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on signing_finalizations:
CREATE POLICY tenant_isolation_signing_finalizations ON signing_finalizations
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- RLS Policy on storage_cleanup_tasks:
CREATE POLICY tenant_isolation_storage_cleanup_tasks ON storage_cleanup_tasks
FOR ALL
USING (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
    NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- Grant privileges to application user gsign_app if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
        GRANT USAGE ON SCHEMA public TO gsign_app;
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gsign_app;
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gsign_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO gsign_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO gsign_app;
    END IF;
END
$$;
