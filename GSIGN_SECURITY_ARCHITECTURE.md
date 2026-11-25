# GSIGN — Security, Authentication & Cryptographic Verification Architecture

**Product:** GSIGN (Digital Agreement Management & Electronic Signature Platform)  
**Security Standard:** OWASP Top 10 (2021), NIST SP 800-63B (Digital Identity Guidelines), RFC 6238 (TOTP), IT Act 2000 (India)  
**Encryption Standard:** AES-256-GCM (At-Rest), TLS 1.3 (In-Transit), Argon2id (Passwords), SHA-256 (Document Hashing)

---

## 1. Authentication Architecture (Administrators & Staff)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Company Admin (Priya N)
    participant Client as GSIGN Web App
    participant AuthCtrl as AuthController
    participant AuthService as AuthService
    participant UserDB as PostgreSQL (Users / MFA)
    participant Redis as Redis Session Cache
    participant AuthApp as Authenticator App (RFC 6238)

    Admin->>Client: Enters Work Email & Password
    Client->>AuthCtrl: POST /api/v1/auth/login
    AuthCtrl->>AuthService: validateCredentials(email, password)
    AuthService->>UserDB: Query user by email (Argon2id hash)
    UserDB-->>AuthService: Return User & MFA Config
    AuthService->>AuthService: Verify Argon2id Password Hash

    alt MFA Enabled (is_mfa_enabled = true)
        AuthService->>Redis: Store ephemeral mfa_token (5 min TTL)
        AuthService-->>Client: 200 OK (mfa_required: true, mfa_token: "mfa_tok_...")
        Client->>Admin: Display "Enter 6-digit MFA Code"
        Admin->>AuthApp: Open Google Authenticator / Authy
        AuthApp-->>Admin: Displays TOTP (e.g. 892011)
        Admin->>Client: Enters 6-digit Code
        Client->>AuthCtrl: POST /api/v1/auth/verify-mfa (mfa_token, code)
        AuthCtrl->>AuthService: verifyTotp(mfa_token, code)
        AuthService->>UserDB: Fetch AES-256 decrypted TOTP Secret
        AuthService->>AuthService: Validate Code within ±1 Time Window (30s)
    end

    AuthService->>Redis: Create Authenticated Session (24h TTL)
    AuthService-->>Client: 200 OK + Set-Cookie: gsign_session=...; HttpOnly; Secure; SameSite=Lax
    Client->>Admin: Redirect to Dashboard (Priya N · Company Admin)
```

### 1.1 Password Hashing Specification (Argon2id)
All user passwords must be hashed using the **Argon2id** hybrid algorithm with the following OWASP-recommended parameters:
- **Memory Cost (`m`):** 65,536 KiB (64 MiB).
- **Time Cost (`t`):** 3 iterations.
- **Parallelism (`p`):** 4 threads.
- **Salt:** 16 cryptographically secure random bytes generated via `crypto.randomBytes(16)`.
- **Hash Length:** 32 bytes (256 bits).
- **Format:** Standard PHC string format (`$argon2id$v=19$m=65536,t=3,p=4$...`).

### 1.2 Session Management & Cookie Hardening
- **Cookie Name:** `__Host-gsign_session` (Enforces HTTPS, root path, and origin binding).
- **Cookie Flags:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`.
- **Session ID:** 256-bit cryptographically secure random token generated with `crypto.randomBytes(32).toString('hex')`.
- **Session Store:** Redis 7+ with key structure `session:<session_id>` storing user ID, active tenant ID, role, and last activity timestamp.
- **Session Revocation:** Triggered on user logout, password reset, or admin deactivation. An active user can revoke all other active sessions via `POST /api/v1/users/me/sessions/revoke-others`.
- **Idle Timeout:** 60 minutes of inactivity; absolute maximum session lifetime of 24 hours.

### 1.3 Administrator MFA Specification (RFC 6238 TOTP)
- **Algorithm:** RFC 6238 Time-based One-Time Password (TOTP) using HMAC-SHA1, 30-second time-step, and 6-digit output.
- **Secret Generation:** 20 bytes (160 bits) of cryptographic entropy encoded in Base32.
- **Secret Encryption At Rest:** The Base32 secret is encrypted in PostgreSQL using **AES-256-GCM** with a dedicated encryption key (`MFA_ENCRYPTION_KEY`) rotated independently from the database master password.
- **Window Tolerance:** Exactly $\pm 1$ time-step (allowing a 30-second clock skew window) to prevent user lockouts while preventing replay attacks.
- **Replay Protection:** Used TOTP tokens are stored in Redis with a 90-second TTL; submitting the identical code within the same window is rejected.
- **Emergency Recovery Codes:** When MFA is enabled, 8 single-use alphanumeric recovery codes (format: `XXXX-XXXX-XXXX`) are generated, hashed with Argon2id, and saved. Using a recovery code invalidates it permanently.

---

## 2. Distinction Matrix: Administrator MFA vs. Recipient OTP Verification

The handover specification mandates that administrator security and recipient identity verification must remain distinct architectural subsystems:

| Dimension | Administrator MFA | Recipient OTP Verification |
|---|---|---|
| **Target Actor** | Company Admin / Super Admin. | Signatory / Recipient (External public). |
| **Authentication Standard** | RFC 6238 Time-based One-Time Password (TOTP). | SMS / WhatsApp One-Time Password (HMAC-SHA256). |
| **Credential Possession** | Authenticator App (Google Authenticator, Authy, YubiKey). | Mobile SIM card / Phone number in agreement party record. |
| **Lifecycle** | Persistent (Setup once, active across all logins). | Ephemeral (Generated per signing session, 5-minute TTL). |
| **Delivery Channel** | Completely offline algorithmic calculation on device. | Telecom SMS Gateway (Twilio / MSG91 / Gupshup). |
| **Re-use Policy** | Re-computed every 30 seconds indefinitely. | Single-use; invalidated immediately upon verification. |
| **Failure Handling** | Account remains locked; emergency recovery code required. | Dispatched again after 60-second cooldown (max 3 tries). |
| **Legal Effect in India** | Internal administrative access authorization. | Section 10A IT Act 2000 evidentiary attribution proof. |

---

## 3. Recipient Signing Link & OTP Security

```mermaid
sequenceDiagram
    autonumber
    actor Signer as Signatory (Ravi Kumar)
    participant Portal as Signing Portal (Web)
    participant SignCtrl as PublicSigningController
    participant OtpService as OtpVerificationService
    participant Redis as Redis Cache
    participant SMS as SMS Gateway (MSG91 / Twilio)
    participant AgrDB as PostgreSQL (Agreements)
    participant Audit as Audit Trail Ledger

    Signer->>Portal: Opens Link: https://sign.gsign.in/sign/AGR-XXXX?token=k7f9a2...
    Portal->>SignCtrl: GET /api/v1/public/signing/k7f9a2...
    SignCtrl->>SignCtrl: Compute SHA-256 of Raw Token
    SignCtrl->>AgrDB: SELECT * FROM agreement_recipients WHERE secure_token_hash = $1
    AgrDB-->>SignCtrl: Return Recipient (Phone: +91 ••••• 4821, Status: Pending)
    SignCtrl->>Audit: Record "Link Opened" Event (IP, User-Agent)
    SignCtrl-->>Portal: Render "Verify It Is You" Screen (+91 ••••• 4821)

    Signer->>Portal: Clicks "Send Code" / Auto-triggers on Load
    Portal->>SignCtrl: POST /public/signing/k7f9a2.../otp/send
    SignCtrl->>OtpService: generateAndSendOtp(recipient_id)
    OtpService->>OtpService: Check Cooldown (Key: otp_cooldown:<id>, 60s)
    OtpService->>OtpService: Generate CSPRNG 6-digit code (e.g. 482190)
    OtpService->>Redis: SETEX otp:rec_id 300 (Hash + Attempts: 0)
    OtpService->>SMS: Dispatch SMS "Your GSIGN verification code is 482190. Valid for 5 min."
    SMS-->>Signer: Delivers SMS to handset
    OtpService-->>Portal: 200 OK (cooldown_seconds: 60)

    Signer->>Portal: Enters "482190" & Clicks "Verify and continue"
    Portal->>SignCtrl: POST /public/signing/k7f9a2.../otp/verify (otp: "482190")
    SignCtrl->>OtpService: verifyOtp(recipient_id, "482190")
    OtpService->>Redis: Compare SHA-256(entered_otp) == cached_hash

    alt Valid Code
        OtpService->>Redis: DEL otp:rec_id
        OtpService->>AgrDB: UPDATE agreement_recipients SET status = 'Verified'
        OtpService->>Audit: Append "OTP Verified" Event (Timestamp, Method)
        OtpService-->>Portal: Set-Cookie: gsign_sign_session=...; Step 2 Unlocked
    else Invalid Code (Attempts < 3)
        OtpService->>Redis: INCR attempts
        OtpService-->>Portal: 400 Bad Request ("Invalid code. 2 attempts remaining.")
    else Exceeded Max Attempts (Attempts >= 3)
        OtpService->>Redis: Lock token for 30 minutes
        OtpService->>Audit: Log Security Alert "Excessive OTP Failures"
        OtpService-->>Portal: 429 Too Many Requests ("Too many attempts. Link locked.")
    end
```

### 3.1 High-Entropy Signing Token Specification
- **Generation:** 32 bytes (256 bits) of cryptographically secure random bytes:
  ```typescript
  const rawToken = crypto.randomBytes(32).toString('hex'); // 64 hex characters
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  ```
- **Storage:** Only the SHA-256 hash (`tokenHash`) is stored in the `agreement_recipients.secure_token_hash` column. The raw token is sent exclusively in the email/SMS link and is never persisted in the database.
- **Revocation:** An administrator can revoke an agreement at any time, immediately invalidating the token hash.
- **Expiration:** Links automatically expire after 48 hours (or the tenant's configured SLA).

### 3.2 Recipient OTP Security Parameters
- **Entropy:** 6-digit numeric string generated via `crypto.randomInt(100000, 999999)`.
- **TTL:** Exactly 300 seconds (5 minutes). Stored in Redis with automatic eviction.
- **Resend Cooldown:** 60 seconds enforced via a separate Redis key (`otp_cooldown:<recipient_id>`).
- **Maximum Attempt Threshold:** Exactly 3 failed verification attempts before the OTP is invalidated and the session is throttled for 30 minutes.

---

## 4. Role-Based Access Control (RBAC) Architecture

GSIGN implements a hierarchical, granular RBAC model:

```
[ Super Admin (Platform Operator) ]
        │
        ├── Root Tenant Management
        ├── Global Pricing Matrices
        └── Audited Customer Support Sessions
        
[ Company Admin (Tenant Owner / HR Director) ]
        │
        ├── Manage Company Branding & Custom Domains
        ├── Team Management (Invite, Assign Roles, Deactivate)
        ├── Template Publishing & Version Deprecation
        ├── Financial Receipt Issuance & Payment Acknowledgement
        └── Subscription Billing & Plan Changes
        
[ Company Staff (HR Recruiter / Legal Ops) ]
        │
        ├── Create & Dispatch Agreements from Published Templates
        ├── View Department Agreements & Track Status
        └── Resend Recipient Reminders
        
[ Signatory / Recipient (External Signer) ]
        │
        ├── Verify Identity via SMS OTP
        ├── Review Agreement Terms
        └── Provide Electronic Consent & Execute Signature
```

### Permission Matrix

| Permission Code | Super Admin | Company Admin | Company Staff | Signatory |
|---|:---:|:---:|:---:|:---:|
| `tenant:read_all` | Yes | No | No | No |
| `pricing:manage` | Yes | No | No | No |
| `branding:update` | Audit-Only | Yes | No | No |
| `users:invite` | Audit-Only | Yes | No | No |
| `template:publish` | Audit-Only | Yes | No | No |
| `receipt:acknowledge` | Audit-Only | Yes | No | No |
| `agreement:create` | Audit-Only | Yes | Yes | No |
| `agreement:read_dept`| Audit-Only | Yes | Yes (Assigned) | No |
| `agreement:sign` | No | No | No | Yes (Via Token) |

---

## 5. Defense-in-Depth Security Controls

1. **Strict CORS Policy:** Restricts origins to approved tenant domains (`https://*.gsign.in` and verified custom domains). Rejects arbitrary cross-origin requests.
2. **CSRF Protection:** Double Submit Cookie pattern implemented for state-changing browser sessions, combined with `SameSite=Lax` cookies and custom header validation (`X-Requested-With: XMLHttpRequest`).
3. **HTTP Security Headers (Helmet):**
   - `Content-Security-Policy`: Restricts script execution, frame embedding (`frame-ancestors 'none'`), and asset origins.
   - `Strict-Transport-Security`: `max-age=31536000; includeSubDomains; preload`.
   - `X-Content-Type-Options`: `nosniff`.
   - `X-Frame-Options`: `DENY`.
4. **Rate Limiting (Tiered Redis Throttling):**
   - `/api/v1/auth/login`: 5 requests / minute per IP.
   - `/api/v1/public/signing/*/otp/verify`: 3 requests / 5 minutes per token.
   - `/api/v1/agreements`: 100 requests / minute per tenant.
5. **Input Sanitization & Validation:** Enforced globally using NestJS `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, and `class-validator` DTO schemas. Prevents XSS, NoSQL injection, and prototype pollution.
6. **File Upload Security:**
   - Supported extensions strictly checked against Magic Bytes (e.g. `%PDF-` for PDFs, `PK\x03\x04` for DOCX).
   - Maximum upload size capped at 15 MB.
   - Uploaded files are immediately processed in isolated sandboxes and transferred to private S3 buckets. Direct public execution is impossible.
