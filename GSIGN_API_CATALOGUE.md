# GSIGN — Versioned REST API Catalogue

**Product:** GSIGN (Digital Agreement Management & Electronic Signature Platform)  
**Base Path:** `/api/v1`  
**Protocol:** HTTPS / TLS 1.3  
**Data Format:** JSON (`application/json`) / Multipart Form (`multipart/form-data`)  
**Standard Response Envelope:** `{ "success": boolean, "data"?: T, "error"?: { "code": string, "message": string, "details"?: any } }`

---

## 1. Authentication & Administrator MFA (`/api/v1/auth`)

### 1.1 `POST /auth/login`
- **Purpose:** Initial credential verification for company administrators and staff. If MFA is configured, returns a short-lived `mfa_token` for step 2.
- **Auth:** Public / Unauthenticated.
- **Tenant Scope:** Global / Resolves user memberships.
- **Rate Limit:** 5 requests / minute per IP.
- **Request Body:**
  ```json
  {
    "email": "priya@gsign.in",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK — MFA Required):**
  ```json
  {
    "success": true,
    "data": {
      "mfa_required": true,
      "mfa_token": "mfa_tok_018f3a5e...",
      "expires_in_seconds": 300
    }
  }
  ```
- **Response (200 OK — Direct Login):** Sets `Set-Cookie: gsign_session=...; HttpOnly; Secure; SameSite=Lax`.
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "usr_018f3a5e...",
        "email": "priya@gsign.in",
        "full_name": "Priya N",
        "is_super_admin": false
      },
      "active_tenant": {
        "id": "ten_018f3a5e...",
        "name": "GSIGN Pvt Ltd",
        "role": "Company Admin",
        "department": "HR"
      }
    }
  }
  ```
- **Errors:** `401 Unauthorized` (Invalid credentials), `429 Too Many Requests`.

### 1.2 `POST /auth/verify-mfa`
- **Purpose:** Validates RFC 6238 TOTP code from authenticator app or backup recovery code.
- **Auth:** `mfa_token` Bearer header or body.
- **Request Body:**
  ```json
  {
    "mfa_token": "mfa_tok_018f3a5e...",
    "code": "892011"
  }
  ```
- **Response (200 OK):** Sets secure `gsign_session` cookie; returns user profile and active tenant.
- **Errors:** `401 Unauthorized` (Invalid or expired code), `429 Too Many Requests`.

### 1.3 `POST /auth/logout`
- **Purpose:** Invalidates active session in Redis; clears `gsign_session` cookie.
- **Auth:** Authenticated Session.
- **Response (200 OK):** `{ "success": true, "message": "Session terminated successfully." }`

---

## 2. Agreement Management & Lifecycle (`/api/v1/agreements`)

### 2.1 `GET /agreements`
- **Purpose:** Paginated list of agreements for the active tenant with multi-criteria filtering. Matches `AgreementsView.tsx`.
- **Auth:** Authenticated (`Company Admin`, `Company Staff`).
- **Tenant Scope:** Bound by active tenant context via RLS.
- **Query Parameters:**
  - `page` (integer, default 1)
  - `limit` (integer, default 20)
  - `status` (`Completed`, `Awaiting OTP`, `Awaiting signature`, `Expired`, `Rejected`, `Draft`, `Cancelled`)
  - `department` (`HR`, `Legal`, `Ops`, `Sales`, `Executive`)
  - `search` (string: agreement ID or recipient name)
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "AGR-2026-0412",
          "recipient_name": "Ravi Kumar",
          "recipient_email": "ravi.kumar@example.com",
          "template_type": "Offer Letter",
          "department": "HR",
          "status": "Completed",
          "fee_amount": 45000.00,
          "period": "12 months",
          "updated_at": "2026-11-24T10:26:00Z",
          "created_at": "2026-11-24T10:02:00Z",
          "document_hash": "a91f3b72c4e908f0923058cd41209e7c"
        }
      ],
      "meta": {
        "total": 62,
        "page": 1,
        "limit": 20,
        "total_pages": 4
      }
    }
  }
  ```

### 2.2 `POST /agreements`
- **Purpose:** Creates a new agreement, binds template variables, creates recipient record, generates secure signing token, and creates audit log. Matches `NewAgreementModal.tsx`.
- **Auth:** Authenticated (`agreement:create` permission).
- **Tenant Scope:** Active tenant.
- **Request Body:**
  ```json
  {
    "recipient_name": "Alok Verma",
    "recipient_email": "alok@example.com",
    "recipient_phone": "+91 98765 00000",
    "template_type": "Offer Letter",
    "department": "HR",
    "fee_amount": 50000,
    "period": "12 months",
    "signing_method": "basic_drawn",
    "custom_fields": {
      "stipulated_covenants": "Schedule A standard covenants apply."
    }
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "AGR-2026-0413",
      "status": "Awaiting signature",
      "signing_url": "https://sign.gsign.in/sign/AGR-2026-0413?token=d9f4a1...",
      "created_at": "2026-11-25T11:00:00Z"
    }
  }
  ```

### 2.3 `GET /agreements/:id`
- **Purpose:** Retrieves complete agreement details, rendered text, parties, signature metadata, and full audit trail timeline. Matches `AgreementDetailView.tsx`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "AGR-2026-0412",
      "status": "Completed",
      "template_type": "Offer Letter",
      "department": "HR",
      "fee_amount": 45000.00,
      "period": "12 months",
      "recipient": {
        "name": "Ravi Kumar",
        "email": "ravi.kumar@example.com",
        "phone": "+91 98765 44821",
        "role": "Signer"
      },
      "signature": {
        "method": "basic_drawn",
        "signature_image_url": "https://s3.ap-south-1.amazonaws.com/gsign-private/...",
        "signed_at": "2026-11-24T10:25:00Z"
      },
      "document_hash": "a91f3b72c4e908f0923058cd41209e7c",
      "audit_trail": [
        {
          "id": 1,
          "title": "Agreement created",
          "description": "Template v3 · by Priya, 24 Nov 10:02",
          "timestamp": "24 Nov 10:02",
          "type": "created"
        },
        {
          "id": 6,
          "title": "Signed (basic electronic)",
          "description": "Document hash a91f…c7 · 10:25",
          "timestamp": "24 Nov 10:25",
          "type": "signed",
          "hash": "a91f3b72c4e908f0923058cd41209e7c"
        }
      ]
    }
  }
  ```

### 2.4 `GET /agreements/:id/pdf`
- **Purpose:** Generates a short-lived (15-minute) pre-signed S3 URL to download the sealed PDF.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "download_url": "https://gsign-private.s3.ap-south-1.amazonaws.com/tenants/.../AGR-2026-0412.pdf?X-Amz-Signature=...",
      "expires_at": "2026-11-25T11:15:00Z",
      "file_name": "AGR-2026-0412_Ravi_Kumar.pdf",
      "checksum_sha256": "a91f3b72c4e908f0923058cd41209e7c"
    }
  }
  ```

---

## 3. Public Recipient Signing Portal (`/api/v1/public/signing`)

Public endpoints accessed by document signers via secure tokens. No user login required; secured via token hashing, OTP, rate limiting, and session binding.

### 3.1 `GET /public/signing/:token`
- **Purpose:** Validates the high-entropy URL token, returns masked recipient phone number, agreement metadata, terms, and current step requirements.
- **Request Param:** `token` (64-character hex string).
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "agreement_id": "AGR-2026-0411",
      "recipient_name": "Meera Iyer",
      "masked_phone": "+91 ••••• 4821",
      "template_type": "Offer Letter",
      "content": "This offer is made to Meera Iyer for a monthly fee of ₹45,000...",
      "step_required": "otp_verification",
      "branding": {
        "logo_text": "GSIGN",
        "brand_color": "#2563EB",
        "hide_powered_by": false
      }
    }
  }
  ```
- **Errors:** `404 Not Found` (Token revoked or invalid), `410 Gone` (Agreement expired).

### 3.2 `POST /public/signing/:token/otp/send`
- **Purpose:** Generates 6-digit OTP, stores salted hash in Redis with 5-minute TTL, and dispatches via SMS gateway.
- **Rate Limit:** 1 request per 60 seconds (cooldown); max 5 per day per token.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Verification code dispatched via SMS.",
      "cooldown_seconds": 60,
      "expires_in_seconds": 300
    }
  }
  ```

### 3.3 `POST /public/signing/:token/otp/verify`
- **Purpose:** Validates recipient-entered OTP against Redis cache. On success, issues an ephemeral `signing_session_token` cookie.
- **Request Body:**
  ```json
  {
    "otp": "482190"
  }
  ```
- **Response (200 OK):** Sets `gsign_sign_session` cookie.
  ```json
  {
    "success": true,
    "data": {
      "verified": true,
      "next_step": "review_and_sign"
    }
  }
  ```
- **Errors:** `400 Bad Request` (Invalid OTP. 2 attempts remaining), `429 Too Many Requests` (Account locked after 3 failed attempts).

### 3.4 `POST /public/signing/:token/submit-signature`
- **Purpose:** Records legal consent checkbox, captures drawn canvas base64 image or Aadhaar eSign ASP transaction ID, calculates document hash, and completes execution.
- **Request Body:**
  ```json
  {
    "consent_checked": true,
    "consent_statement": "I have read the full agreement and consent to sign it electronically.",
    "signature_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "signing_method": "basic_drawn"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "status": "Completed",
      "document_hash": "e8a9103c72b4f910a4...",
      "signed_pdf_ready": true,
      "message": "Agreement signed and cryptographically sealed."
    }
  }
  ```

---

## 4. Templates Engine (`/api/v1/templates`)

### 4.1 `GET /templates`
- **Purpose:** Lists all templates for the active tenant.
- **Response (200 OK):** Returns array of templates with active versions and field counts.

### 4.2 `POST /templates`
- **Purpose:** Creates a new template draft.
- **Request Body:**
  ```json
  {
    "name": "Employment Offer Letter",
    "type": "Offer Letter",
    "description": "Standard engineering offer template."
  }
  ```

### 4.3 `POST /templates/:id/versions`
- **Purpose:** Saves field layout, coordinate positions, and placeholder configuration.
- **Request Body:**
  ```json
  {
    "content_html": "<p>This offer is made to {{recipient_name}} for a monthly fee of {{fee_amount}}...</p>",
    "fields": [
      {
        "field_key": "recipient_signature",
        "field_type": "Signature",
        "label": "Signature · Recipient",
        "is_required": true,
        "signing_method": "basic_drawn",
        "page_number": 1,
        "coord_x_pct": 10.5,
        "coord_y_pct": 75.0,
        "width_pct": 35.0,
        "height_pct": 10.0
      },
      {
        "field_key": "witness_signature",
        "field_type": "Witness",
        "label": "Witness",
        "is_required": false,
        "signing_method": "basic_drawn",
        "page_number": 1,
        "coord_x_pct": 55.0,
        "coord_y_pct": 75.0,
        "width_pct": 35.0,
        "height_pct": 10.0
      }
    ]
  }
  ```

### 4.4 `POST /templates/:id/publish`
- **Purpose:** Publishes draft version to production. Any sent agreement remains frozen on its original version.
- **Response (200 OK):** `{ "success": true, "published_version": 4 }`

---

## 5. Documents & Receipts (`/api/v1/receipts`)

### 5.1 `GET /receipts`
- **Purpose:** Receipts ledger list matching `DocumentsReceiptsView.tsx`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "RCT-0091",
        "payer": "Ravi Kumar",
        "amount": 45000.00,
        "amount_in_words": "Forty-five thousand rupees only",
        "mode": "UPI",
        "status": "Issued",
        "date": "24 Nov 2026",
        "tx_ref": "UPI-982340192841",
        "purpose": "First month fee",
        "acknowledged_by": "Priya (Admin)"
      },
      {
        "id": "RCT-PENDING",
        "payer": "Meera Iyer",
        "amount": 30000.00,
        "amount_in_words": "Thirty thousand rupees only",
        "mode": "—",
        "status": "Payment not confirmed",
        "date": "24 Nov 2026",
        "tx_ref": "—",
        "purpose": "Advisory retainer",
        "acknowledged_by": "—"
      }
    ]
  }
  ```

### 5.2 `POST /receipts/acknowledge`
- **Purpose:** Authorised company administrator confirms receipt of funds, assigns sequential number, and issues verified voucher.
- **Request Body:**
  ```json
  {
    "receipt_id": "RCT-PENDING",
    "agreement_id": "AGR-2026-0411",
    "payment_mode": "UPI",
    "transaction_ref": "UPI-202611259981",
    "notes": "Verified in HDFC current account."
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "RCT-0092",
      "status": "Issued",
      "acknowledged_by": "Priya (Admin)",
      "issued_at": "2026-11-25T11:30:00Z"
    }
  }
  ```

---

## 6. White-label Branding & Custom Domains (`/api/v1/branding`)

### 6.1 `GET /branding`
- **Purpose:** Fetches current branding configuration, custom domain, and DNS verification status.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "logo_text": "GSIGN",
      "brand_color": "#2563EB",
      "email_display_name": "GSIGN HR",
      "custom_domain": "sign.gsign.in",
      "dns_verified": true,
      "ssl_status": "Active",
      "hide_powered_by": false
    }
  }
  ```

### 6.2 `POST /branding/domains/verify-dns`
- **Purpose:** Performs live DNS CNAME resolution lookup against target hostname and provisions SSL certificate.
- **Request Body:** `{ "domain": "sign.mycompany.com" }`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "domain": "sign.mycompany.com",
      "cname_resolved": true,
      "ssl_issued": true,
      "message": "CNAME correctly points to cname.gsign.in. SSL certificate active."
    }
  }
  ```

---

## 7. Super Admin Management (`/api/v1/superadmin`)

Requires `is_super_admin: true` and active audit-logged support context.

### 7.1 `GET /superadmin/tenants`
- **Purpose:** Lists all customer companies across the platform. Matches `SuperAdminTenantsView.tsx`.
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "ten-1",
        "company": "GSIGN Pvt Ltd",
        "plan": "Business",
        "status": "Active",
        "docs_this_month": 62,
        "domain": "sign.gsign.in",
        "admin_email": "admin@gsign.in"
      },
      {
        "id": "ten-4",
        "company": "Zenith BPO",
        "plan": "Enterprise",
        "status": "Payment failed",
        "docs_this_month": 480,
        "domain": "esign.zenithbpo.in",
        "admin_email": "legal@zenithbpo.in"
      }
    ]
  }
  ```

### 7.2 `PUT /superadmin/pricing`
- **Purpose:** Updates global plans, document quotas, seats, and overage fees without code modifications. Matches `SuperAdminPricingView.tsx`.
- **Request Body:**
  ```json
  {
    "plans": [
      { "id": "plan-1", "name": "Starter", "price_monthly": 499, "documents_limit": 25, "users_limit": 2 },
      { "id": "plan-2", "name": "Business", "price_monthly": 1499, "documents_limit": 100, "users_limit": 5 },
      { "id": "plan-3", "name": "Professional", "price_monthly": 2999, "documents_limit": 300, "users_limit": 15 },
      { "id": "plan-4", "name": "Enterprise", "price_monthly": -1, "documents_limit": -1, "users_limit": -1 }
    ]
  }
  ```

---

## 8. Public Cryptographic Document Verification (`/api/v1/public/verify-document`)

### 8.1 `POST /public/verify-document`
- **Purpose:** Independent public endpoint allowing any party, auditor, or court to upload a PDF or supply a SHA-256 hash to verify against the immutable ledger.
- **Request Body:** Multi-part file upload (`pdf_file`) OR `{ "sha256_hash": "a91f3b72c4e9..." }`.
- **Response (200 OK — Valid):**
  ```json
  {
    "success": true,
    "data": {
      "is_valid": true,
      "agreement_id": "AGR-2026-0412",
      "executing_company": "GSIGN Pvt Ltd",
      "signatory_name": "Ravi Kumar",
      "signing_method": "Basic electronic (OTP verified)",
      "signed_timestamp": "2026-11-24T10:25:00+05:30",
      "audit_hash_chain_verified": true,
      "tamper_detected": false
    }
  }
  ```
