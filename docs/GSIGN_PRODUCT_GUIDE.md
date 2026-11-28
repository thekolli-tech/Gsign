# GSIGN — Product & Architecture Guide

## 1. Product Feature Completion Checklist

| Module | Status | Notes |
| :--- | :--- | :--- |
| Authentication, Sessions & TOTP MFA | **Implemented** | Argon2 passwords, Redis + PostgreSQL sessions, TOTP MFA, recovery codes, OTP password reset |
| RBAC & Tenant Isolation | **Implemented** | `AuthGuard`, `PermissionsGuard`, `RolesGuard`, `PlatformOwnerGuard`, `SuperAdminGuard`, PostgreSQL RLS + `FORCE RLS` |
| Company Registration & Self-Serve Checkout | **Implemented** | Email verification, HMAC `checkout_access_token`, `PAYMENT_PENDING` state machine, signed webhook confirmation |
| Team & Role Management | **Implemented** | Member invitations, invite acceptance, role/department updates, activation/deactivation |
| Agreement Lifecycle & Reminders | **Implemented** | Draft/dispatch/transition state machine, immutable `agreement_events`, `POST /agreements/:id/remind` (15-min cooldown) |
| Templates Library & Builder | **Implemented** | Create, edit, publish, duplicate, archive templates |
| Signing Portal & OTP Verification | **Implemented** | Token-gated public portal, multi-signatory requests, OTP verification, signature submission/rejection |
| Document Storage, PDF & Certificates | **Implemented** | Private R2/S3 (with `.local_storage` dev fallback), `pdf-lib` PDFs & completion certificates, SHA-256 verification |
| Payment Receipts & Acknowledgement | **Implemented** | `payment_receipts` table with `FORCE RLS`, no-`DELETE` for `gsign_app`, `receipt:read` / `receipt:issue` |
| Platform Owner Administration | **Implemented** | Tenants, pricing plans, manual activation, live integrations, feature flags, support access, usage analytics, sales inquiries |
| Centralized Email & Outbox Worker | **Implemented** | `NotificationsModule`, `ResendEmailProvider`, 11 templates, `FOR UPDATE SKIP LOCKED` retry worker |

---

## 2. User-Role & Permission Matrix

| Role | Scope | Key Capabilities |
| :--- | :--- | :--- |
| **Platform Owner** (`isPlatformOwner = true`) | Global (Cross-Tenant) | Manage tenants, plans & pricing, manual subscription activation, usage analytics (`/tenants/platform/analytics`), sales inquiries (`/tenants/platform/sales-inquiries`), feature flags, integrations, support access |
| **Super Admin** (`isSuperAdmin = true`) | Global Support | View tenants, feature flags, integrations, grant/revoke time-boxed support access sessions |
| **Company Admin** | Single Tenant (RLS) | Full tenant management, invite/manage team, create/send/remind/cancel agreements, manage templates, upload/verify documents, acknowledge receipts, branding & domain |
| **Company Staff / Member** | Single Tenant (RLS) | Scoped by assigned role permissions (`agreement:read`, `agreement:create`, `agreement:update`, `receipt:read`, etc.) |
| **External Signatory** | Public Token-Gated | View agreement via signing token, request/verify OTP, submit signature or decline |

---

## 3. Frontend Route (`ActiveView`) Inventory

- **Public / Standalone Views:** `signin`, `register_company`, `pricing`, `contact_sales`, `accept_invite`
- **Tenant Workspace Views:** `dashboard`, `agreements`, `agreement_detail`, `templates`, `documents_receipts`, `reports`, `team_roles`, `branding_domain`, `subscription`
- **Platform Owner / Super Admin Views:** `superadmin_tenants`, `superadmin_pricing`, `superadmin_analytics`, `superadmin_sales_inquiries`, `superadmin_integrations`, `superadmin_support`, `superadmin_flags`
- **Modals:** `NewAgreementModal`, `RecipientPortalModal`

---

## 4. API Endpoint Inventory (`/api/v1`)

- **Auth (`/auth`):** `POST /login`, `POST /logout`, `GET /me`, `POST /mfa/enroll`, `POST /mfa/confirm`, `POST /mfa/verify`, `POST /mfa/recovery`, `POST /mfa/disable`, `POST /change-password`, `POST /register-company`, `GET /verify-email`, `POST /complete-company-setup`, `POST /forgot-password/*`, `POST /invite`, `GET /invitations`, `GET /invite-info`, `POST /accept-invite`
- **Users & Roles (`/users`, `/roles`):** `GET /users`, `PATCH /users/:id/status`, `PATCH /users/:id/role`, `GET /roles`
- **Tenants & Platform (`/tenants`):** `GET /current`, `GET /current/branding`, `PATCH /current/branding`, `POST /current/verify-domain`, `GET /`, `POST /`, `DELETE /:id`, `POST /contact-sales` (public), `GET /platform/integrations`, `GET /platform/analytics` (Platform Owner), `GET/PATCH /platform/sales-inquiries` (Platform Owner), `GET/POST /platform/support-access`, `GET/PATCH /platform/feature-flags`
- **Subscriptions & Payments (`/subscriptions`, `/payments`):** `GET /subscriptions/plans`, `GET /subscriptions/plans/manage`, `PATCH /subscriptions/plans/:id`, `GET /subscriptions/current`, `GET /subscriptions/usage`, `POST /subscriptions/activate-manual`, `POST /payments/simulate-checkout` (non-prod Platform Owner), `GET /payments/invoices`, `GET /payments/history`, `GET/POST /payments/receipts`, `POST /payments/receipts/:id/acknowledge`, `POST /payments/checkout/initiate`, `POST /payments/checkout/status`, `POST /payments/checkout/:ref/transition`, `POST /payments/webhook/confirm`, `GET /payments/platform/checkouts`
- **Agreements & Templates (`/agreements`, `/templates`):** `GET/POST /agreements`, `GET/PATCH/DELETE /agreements/:id`, `POST /agreements/:id/transition`, `POST /agreements/:id/remind`, `GET/POST /templates`, `GET/PATCH /templates/:id`, `POST /templates/:id/publish|duplicate|archive`
- **Signing & Documents (`/signing`, `/documents`):** `POST /signing/requests`, `GET /signing/requests/agreement/:id`, `POST /signing/requests/:id/revoke`, `POST /signing/portal/:token/*`, `POST /documents/upload`, `POST /documents/agreements/:id/generate-pdf|finalize`, `GET /documents`, `GET /documents/certificates`, `GET /documents/:id/verify|audit-logs|download`

---

## 5. Integration Configuration Guide

- **PostgreSQL:** `DATABASE_URL` (`gsign_app` `NOBYPASSRLS` runtime role); `DIRECT_DATABASE_URL` (`neondb_owner` migrations only).
- **Redis:** `REDIS_URL` (or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`) for sessions, rate limits, OTPs, and reminder cooldowns.
- **Cloudflare R2 / S3:** `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`.
- **Resend Email:** `RESEND_API_KEY`, `EMAIL_FROM` (omitting `RESEND_API_KEY` disables outbound delivery in non-prod and fails closed in prod).
- **Notification Outbox Encryption:** `NOTIFICATION_ENCRYPTION_KEY` (32-byte hex/base64 key) enables AES-256-GCM encrypted retries for OTP/token emails.
- **Payment Webhooks:** `PAYMENT_WEBHOOK_SECRET` for HMAC-SHA256 signature verification on `POST /payments/webhook/confirm`.

---

## 6. Known Limitations & Remaining External Dependencies

- Live PostgreSQL execution of migrations `002–007` and live RLS/index verification are pending staging execution.
- Live Redis, Resend API delivery, Cloudflare R2 bucket access, and Razorpay/Stripe gateway SDKs require staging/production credentials.
- Automated tests currently use mocked DB/Redis/fetch adapters in this offline environment.

---

## 7. Local Development Instructions

```powershell
# Backend build & offline unit tests
npm --prefix backend run build
npm --prefix backend test -- verify-runtime-rls.spec.ts migration-and-rls.spec.ts notifications.spec.ts checkout.spec.ts payments-receipts.spec.ts platform-analytics.spec.ts sales-inquiries.spec.ts security-guards.spec.ts storage.service.spec.ts billing-plans.spec.ts quota-usage.spec.ts team-management.spec.ts

# Frontend build, lint & unit tests
npm run lint
npm test
npm run build
```
