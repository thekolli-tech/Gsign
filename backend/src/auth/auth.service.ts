import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { CryptoService } from './crypto.service';
import { MfaService } from './mfa.service';
import { SessionService, ActiveSession } from './session.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { RecoveryCodeDto } from './dto/recovery-code.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CompleteCompanySetupDto } from './dto/complete-company-setup.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly mfaService: MfaService,
    private readonly sessionService: SessionService
  ) {}

  /**
   * Primary User Login
   */
  async login(
    dto: LoginDto,
    ipAddress: string,
    userAgent: string
  ): Promise<{
    mfa_required: boolean;
    mfa_token?: string;
    session?: ActiveSession;
  }> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    // 1. Login attempt rate-limiting protection (OWASP standard: 5 failed attempts locks for 15m)
    const rateLimitKey = `rate:login:${normalizedEmail}`;
    const failedAttempts = Number((await this.redis.get(rateLimitKey)) || 0);
    if (failedAttempts >= 5) {
      throw new ForbiddenException(
        'Too many failed login attempts. Account temporarily locked for 15 minutes.'
      );
    }

    // 2. Fetch user
    const userRes = await this.db.query(
      `SELECT id, email, password_hash, full_name, is_super_admin, is_active 
       FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      await this.redis.incr(rateLimitKey);
      await this.redis.expire(rateLimitKey, 900); // 15 mins
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      throw new ForbiddenException('User account has been deactivated. Please contact your administrator.');
    }

    // 3. Verify Argon2id Password Hash
    const isPasswordValid = await this.crypto.verifyPassword(dto.password, user.password_hash);
    if (!isPasswordValid) {
      await this.redis.incr(rateLimitKey);
      await this.redis.expire(rateLimitKey, 900);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Clear failed login attempts counter on successful password match
    await this.redis.del(rateLimitKey);

    // 4. Check if Administrator MFA is configured & enabled
    const mfaRes = await this.db.query(
      `SELECT is_enabled FROM user_mfa_configs WHERE user_id = $1`,
      [user.id]
    );

    const isMfaEnabled = mfaRes.rows.length > 0 && mfaRes.rows[0].is_enabled;

    if (isMfaEnabled) {
      // Create ephemeral 5-minute MFA verification token in Redis
      const mfaToken = `mfa_tok_${this.crypto.generateToken(24)}`;
      await this.redis.setex(
        `mfa:pending:${mfaToken}`,
        300, // 5 min TTL
        JSON.stringify({ userId: user.id, email: user.email })
      );

      return {
        mfa_required: true,
        mfa_token: mfaToken,
      };
    }

    // 5. If MFA not enabled, establish session immediately
    const tenantId = await this.resolveDefaultTenantId(user.id, user.is_super_admin);
    const session = await this.sessionService.createSession(
      user.id,
      tenantId,
      ipAddress,
      userAgent
    );

    return {
      mfa_required: false,
      session,
    };
  }

  /**
   * Verify TOTP code during 2-Step Login
   */
  async verifyMfaLogin(
    dto: VerifyMfaDto,
    ipAddress: string,
    userAgent: string
  ): Promise<ActiveSession> {
    const rawPending = await this.redis.get(`mfa:pending:${dto.mfa_token}`);
    if (!rawPending) {
      throw new UnauthorizedException('MFA verification token expired or invalid. Please sign in again.');
    }

    const { userId } = JSON.parse(rawPending);

    // Fetch encrypted secret
    const mfaRes = await this.db.query(
      `SELECT secret_encrypted, is_enabled FROM user_mfa_configs WHERE user_id = $1`,
      [userId]
    );

    if (mfaRes.rows.length === 0 || !mfaRes.rows[0].is_enabled) {
      throw new UnauthorizedException('MFA is not enabled for this user.');
    }

    const secret = this.crypto.decryptAes256Gcm(mfaRes.rows[0].secret_encrypted);

    const isValid = await this.mfaService.verifyTotp(userId, dto.code, secret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 6-digit MFA verification code.');
    }

    // Invalidate the ephemeral MFA token
    await this.redis.del(`mfa:pending:${dto.mfa_token}`);

    // Create session
    const userRes = await this.db.query(`SELECT is_super_admin FROM users WHERE id = $1`, [userId]);
    const isSuperAdmin = userRes.rows[0]?.is_super_admin || false;
    const tenantId = await this.resolveDefaultTenantId(userId, isSuperAdmin);

    return this.sessionService.createSession(userId, tenantId, ipAddress, userAgent);
  }

  /**
   * Emergency Login with Single-Use Backup Recovery Code
   */
  async loginWithRecoveryCode(
    dto: RecoveryCodeDto,
    ipAddress: string,
    userAgent: string
  ): Promise<ActiveSession> {
    const rawPending = await this.redis.get(`mfa:pending:${dto.mfa_token}`);
    if (!rawPending) {
      throw new UnauthorizedException('MFA token has expired or is invalid. Please sign in again.');
    }

    const { userId } = JSON.parse(rawPending);

    // Fetch unused recovery codes for this user
    const codesRes = await this.db.query(
      `SELECT id, code_hash FROM mfa_recovery_codes 
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    if (codesRes.rows.length === 0) {
      throw new UnauthorizedException('No active recovery codes remaining for this account.');
    }

    let matchingCodeId: string | null = null;
    for (const record of codesRes.rows) {
      const match = await this.crypto.verifyRecoveryCode(dto.recovery_code, record.code_hash);
      if (match) {
        matchingCodeId = record.id;
        break;
      }
    }

    if (!matchingCodeId) {
      throw new UnauthorizedException('Invalid recovery code.');
    }

    // Single-use enforcement: Mark code as used immediately
    await this.db.query(
      `UPDATE mfa_recovery_codes SET used_at = NOW() WHERE id = $1`,
      [matchingCodeId]
    );

    // Invalidate the ephemeral MFA token
    await this.redis.del(`mfa:pending:${dto.mfa_token}`);

    // Create authenticated session
    const userRes = await this.db.query(`SELECT is_super_admin FROM users WHERE id = $1`, [userId]);
    const isSuperAdmin = userRes.rows[0]?.is_super_admin || false;
    const tenantId = await this.resolveDefaultTenantId(userId, isSuperAdmin);

    return this.sessionService.createSession(userId, tenantId, ipAddress, userAgent);
  }

  /**
   * Enroll Administrator MFA (Step 1: Generate Secret & QR)
   */
  async enrollMfa(userId: string): Promise<{
    secret: string;
    qr_code_data_url: string;
    otpauth_uri: string;
  }> {
    const userRes = await this.db.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found');
    }
    const userEmail = userRes.rows[0].email;

    const secret = this.mfaService.generateSecret();
    const otpauthUri = this.mfaService.generateOtpAuthUri(userEmail, secret);
    const qrCodeDataUrl = await this.mfaService.generateQrCodeDataUrl(otpauthUri);

    // Encrypt secret with AES-256-GCM
    const encryptedSecret = this.crypto.encryptAes256Gcm(secret);

    // Store unconfirmed MFA config
    await this.db.query(
      `INSERT INTO user_mfa_configs (user_id, secret_encrypted, is_enabled, updated_at)
       VALUES ($1, $2, false, NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, is_enabled = false, updated_at = NOW();`,
      [userId, encryptedSecret]
    );

    return {
      secret,
      qr_code_data_url: qrCodeDataUrl,
      otpauth_uri: otpauthUri,
    };
  }

  /**
   * Confirm Administrator MFA Enrollment (Step 2: Verify Code & Generate Recovery Codes)
   */
  async verifyMfaEnrollment(
    userId: string,
    code: string
  ): Promise<{
    success: boolean;
    recovery_codes: string[];
  }> {
    const mfaRes = await this.db.query(
      `SELECT secret_encrypted FROM user_mfa_configs WHERE user_id = $1`,
      [userId]
    );

    if (mfaRes.rows.length === 0) {
      throw new BadRequestException('MFA enrollment has not been initiated.');
    }

    const secret = this.crypto.decryptAes256Gcm(mfaRes.rows[0].secret_encrypted);
    const isValid = await this.mfaService.verifyTotp(userId, code, secret);
    if (!isValid) {
      throw new BadRequestException('Invalid 6-digit MFA code. Please enter the current code from your authenticator app.');
    }

    // Generate 8 single-use emergency recovery codes
    const recoveryCodes = this.crypto.generateRecoveryCodes(8);

    // Clear old recovery codes
    await this.db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);

    // Hash and store each recovery code
    for (const rCode of recoveryCodes) {
      const codeHash = await this.crypto.hashRecoveryCode(rCode);
      await this.db.query(
        `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
        [userId, codeHash]
      );
    }

    // Enable MFA
    await this.db.query(
      `UPDATE user_mfa_configs 
       SET is_enabled = true, confirmed_at = NOW(), updated_at = NOW() 
       WHERE user_id = $1`,
      [userId]
    );

    return {
      success: true,
      recovery_codes: recoveryCodes,
    };
  }

  /**
   * Disables Administrator MFA (requires re-authentication)
   */
  async disableMfa(
    userId: string,
    password: string,
    code?: string
  ): Promise<{ success: boolean; message: string }> {
    const userRes = await this.db.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) throw new NotFoundException('User not found');

    const isPasswordValid = await this.crypto.verifyPassword(password, userRes.rows[0].password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Re-authentication failed: incorrect password');
    }

    if (code) {
      const mfaRes = await this.db.query(
        `SELECT secret_encrypted FROM user_mfa_configs WHERE user_id = $1 AND is_enabled = true`,
        [userId]
      );
      if (mfaRes.rows.length > 0) {
        const secret = this.crypto.decryptAes256Gcm(mfaRes.rows[0].secret_encrypted);
        const isValid = await this.mfaService.verifyTotp(userId, code, secret);
        if (!isValid) {
          throw new UnauthorizedException('Invalid MFA verification code');
        }
      }
    }

    await this.db.query(
      `UPDATE user_mfa_configs SET is_enabled = false, confirmed_at = NULL WHERE user_id = $1`,
      [userId]
    );
    await this.db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [userId]);

    return {
      success: true,
      message: 'MFA has been successfully disabled.',
    };
  }

  /**
   * User Logout
   */
  async logout(sessionId: string): Promise<void> {
    await this.sessionService.revokeSession(sessionId);
  }

  /**
   * 1. Register Company (Creates pending registration + email verification token)
   */
  async registerCompany(dto: RegisterCompanyDto) {
    if (!dto.terms_accepted) {
      throw new BadRequestException('You must accept the Terms and Privacy Policy to register.');
    }

    const businessEmail = dto.business_email.trim().toLowerCase();
    const adminEmail = dto.admin_email.trim().toLowerCase();

    // Check if admin user already exists
    const existingUser = await this.db.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existingUser.rows.length > 0) {
      throw new BadRequestException('A user with this work email already exists. Please sign in instead.');
    }

    // Check if company registration already completed
    const existingReg = await this.db.query(
      `SELECT id, status FROM company_registrations WHERE business_email = $1 OR admin_email = $2`,
      [businessEmail, adminEmail]
    );
    if (existingReg.rows.length > 0 && existingReg.rows[0].status === 'COMPLETED') {
      throw new BadRequestException('A company with this business email is already registered.');
    }

    const passwordHash = await this.crypto.hashPassword(dto.password);
    const billingCycle = dto.billing_cycle || 'monthly';

    // Insert or update pending registration
    const regRes = await this.db.query(
      `INSERT INTO company_registrations (
        company_name, display_name, business_email, business_phone, country, state, city,
        address, website, admin_full_name, admin_email, admin_password_hash, selected_plan_id, billing_cycle, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDING_VERIFICATION')
      ON CONFLICT (business_email) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        display_name = EXCLUDED.display_name,
        business_phone = EXCLUDED.business_phone,
        address = EXCLUDED.address,
        admin_full_name = EXCLUDED.admin_full_name,
        admin_email = EXCLUDED.admin_email,
        admin_password_hash = EXCLUDED.admin_password_hash,
        selected_plan_id = EXCLUDED.selected_plan_id,
        billing_cycle = EXCLUDED.billing_cycle,
        status = 'PENDING_VERIFICATION',
        updated_at = NOW()
      RETURNING id;`,
      [
        dto.company_name.trim(),
        dto.display_name.trim(),
        businessEmail,
        dto.business_phone.trim(),
        dto.country.trim(),
        dto.state.trim(),
        dto.city.trim(),
        dto.address.trim(),
        dto.website ? dto.website.trim() : null,
        dto.admin_full_name.trim(),
        adminEmail,
        passwordHash,
        dto.selected_plan_id || null,
        billingCycle,
      ]
    );

    const regId = regRes.rows[0].id;

    // Generate single-use expiring verification token (32 bytes)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Invalidate old tokens for this registration
    await this.db.query('DELETE FROM email_verification_tokens WHERE registration_id = $1', [regId]);

    // Store token valid for 24 hours
    await this.db.query(
      `INSERT INTO email_verification_tokens (registration_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours');`,
      [regId, adminEmail, tokenHash]
    );

    const appBaseUrl = (process.env.APP_URL || 'https://www.gsign.in').replace(/\/+$/, '');
    const verifyUrl = `${appBaseUrl}/?verify_token=${rawToken}`;
    const delivery = await this.sendEmail(
      adminEmail,
      'Verify Your GSIGN Company Registration',
      `<p>Hello ${dto.admin_full_name.trim()},</p>
       <p>Thank you for registering <strong>${dto.company_name.trim()}</strong> on GSIGN.</p>
       <p>Click the link below to verify your work email address (expires in 24 hours):</p>
       <p><a href="${verifyUrl}">Verify Company Email</a></p>
       <p>If you did not initiate this registration, you can safely ignore this email.</p>`,
    );

    return {
      success: true,
      message: 'Company registration received. An email verification link has been sent.',
      registration_id: regId,
      email_delivery: delivery,
      ...(process.env.NODE_ENV !== 'production' ? { verification_token: rawToken } : {}),
    };
  }

  /**
   * 2. Verify Email via Single-Use Token
   */
  async verifyEmail(token: string) {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Verification token is required.');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const tokenRes = await this.db.query(
      `SELECT id, registration_id, expires_at, used_at 
       FROM email_verification_tokens 
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      throw new BadRequestException('Invalid verification token.');
    }

    const tokenRow = tokenRes.rows[0];
    if (tokenRow.used_at) {
      throw new BadRequestException('This verification token has already been used.');
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      throw new BadRequestException('Verification token has expired. Please request a new registration link.');
    }

    // Mark token used
    await this.db.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1', [tokenRow.id]);

    // Update company registration status
    await this.db.query(
      `UPDATE company_registrations SET status = 'EMAIL_VERIFIED', updated_at = NOW() WHERE id = $1`,
      [tokenRow.registration_id]
    );

    return {
      success: true,
      message: 'Email address verified successfully. Please choose your subscription plan to complete registration.',
      registration_id: tokenRow.registration_id,
    };
  }

  /**
   * 3. Complete Company Setup (Select Plan, Provision Tenant, Create First Admin, Create Subscription Awaiting Payment)
   * NO FREE TRIAL CREATED: Workspace remains in PAYMENT_PENDING state until payment is verified.
   */
  async completeCompanySetup(dto: CompleteCompanySetupDto) {
    const regRes = await this.db.query(
      `SELECT * FROM company_registrations WHERE id = $1`,
      [dto.registration_id]
    );

    if (regRes.rows.length === 0) {
      throw new NotFoundException('Company registration not found.');
    }

    const reg = regRes.rows[0];
    if (reg.status !== 'EMAIL_VERIFIED') {
      throw new BadRequestException(
        `Cannot complete setup: Registration status is '${reg.status}'. Email verification is required first.`
      );
    }

    // Verify paid plan
    const planRes = await this.db.query(
      `SELECT id, name, slug FROM subscription_plans WHERE id = $1 AND is_active = true`,
      [dto.plan_id]
    );
    if (planRes.rows.length === 0) {
      throw new BadRequestException('Selected subscription plan is invalid or inactive.');
    }
    const plan = planRes.rows[0];

    // Create Tenant and first Company Admin
    const slugBase = reg.company_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 48);
    const tenantSlug = `${slugBase}-${Date.now().toString().slice(-6)}`;

    // Begin isolated provisioning transaction
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.is_super_admin = 'true';");

      // 1. Create Tenant with Payment_Pending status
      const tenantRes = await client.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, $4, 'Payment_Pending')
         RETURNING id;`,
        [reg.company_name, tenantSlug, reg.business_email, reg.business_phone]
      );
      const tenantId = tenantRes.rows[0].id;

      // 2. Create First Company Administrator (CANNOT BE SUPER ADMIN OR PLATFORM OWNER)
      const userRes = await client.query(
        `INSERT INTO users (
           email, password_hash, full_name, phone_number, is_super_admin, is_platform_owner, is_active, email_verified_at
         ) VALUES ($1, $2, $3, $4, false, false, true, NOW())
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id;`,
        [reg.admin_email, reg.admin_password_hash, reg.admin_full_name, reg.business_phone]
      );
      const adminUserId = userRes.rows[0].id;

      // 3. Link Company Admin role in tenant_memberships
      const roleRes = await client.query(`SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1;`);
      const companyAdminRoleId = roleRes.rows[0].id;

      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, 'Executive', 'Active')
         ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
        [tenantId, adminUserId, companyAdminRoleId]
      );

      // 4. Create Subscription with status 'PAYMENT_PENDING' (NO FREE TRIAL)
      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status)
         VALUES ($1, $2, $3, 'PAYMENT_PENDING')
         ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'PAYMENT_PENDING';`,
        [tenantId, plan.id, dto.billing_cycle || 'monthly']
      );

      // 5. Update registration record
      await client.query(
        `UPDATE company_registrations 
         SET status = 'PAYMENT_PENDING', tenant_id = $1, admin_user_id = $2, selected_plan_id = $3, billing_cycle = $4, updated_at = NOW()
         WHERE id = $5;`,
        [tenantId, adminUserId, plan.id, dto.billing_cycle || 'monthly', reg.id]
      );

      await client.query('COMMIT');

      return {
        success: true,
        message: 'Company workspace provisioned. Paid subscription payment required to activate access.',
        tenant_id: tenantId,
        admin_email: reg.admin_email,
        subscription_status: 'PAYMENT_PENDING',
        plan_name: plan.name,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 4. Change Password (enforces password change on first login or user request)
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const userRes = await this.db.query(
      `SELECT id, password_hash FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      throw new NotFoundException('User not found.');
    }

    const user = userRes.rows[0];
    const isCurrentValid = await this.crypto.verifyPassword(dto.current_password, user.password_hash);
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password does not match.');
    }

    const newHash = await this.crypto.hashPassword(dto.new_password);
    await this.db.query(
      `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2`,
      [newHash, userId]
    );

    return {
      success: true,
      message: 'Password updated successfully. You may now continue using your account.',
    };
  }

  /**
   * 4.1 Request 6-digit Email OTP for Forgot Password
   */
  async requestPasswordResetOtp(emailInput: string) {
    const email = emailInput.trim().toLowerCase();

    // Check active user by email (or company_registrations admin_user_id)
    const userRes = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.is_active
       FROM users u
       WHERE LOWER(u.email) = $1
       LIMIT 1`,
      [email]
    );

    let user = userRes.rows[0];
    if (!user) {
      const regRes = await this.db.query(
        `SELECT u.id, u.email, u.full_name, u.is_active
         FROM company_registrations cr
         JOIN users u ON cr.admin_user_id = u.id
         WHERE LOWER(cr.business_email) = $1 OR LOWER(cr.admin_email) = $1
         LIMIT 1`,
        [email]
      );
      user = regRes.rows[0];
    }

    if (user && user.is_active) {
      const otp = crypto.randomInt(100000, 1000000).toString();
      const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

      await this.redis.setex(
        `pwd_reset_otp:${email}`,
        600,
        JSON.stringify({ userId: user.id, otpHash, attempts: 0 })
      );

      await this.sendEmail(
        user.email,
        'GSIGN Password Reset Verification Code',
        `<p>Hello ${user.full_name || 'User'},</p><p>Your GSIGN password reset verification code is:</p><h2 style="letter-spacing:4px;">${otp}</h2><p>This code expires in 10 minutes. If you did not request a password reset, please ignore this email.</p>`,
      );

      if (process.env.NODE_ENV !== 'production') {
        return {
          success: true,
          message: 'A 6-digit verification OTP has been sent to your registered email.',
          dev_otp_preview: otp,
        };
      }
    }

    return {
      success: true,
      message: 'If an active account exists for that email, a 6-digit verification OTP has been sent.',
    };
  }

  /**
   * 4.2 Verify 6-digit Email OTP and issue single-use reset token
   */
  async verifyPasswordResetOtp(emailInput: string, otpInput: string) {
    const email = emailInput.trim().toLowerCase();
    const otp = otpInput.trim();
    const redisKey = `pwd_reset_otp:${email}`;
    const raw = await this.redis.get(redisKey);

    if (!raw) {
      throw new BadRequestException('OTP expired or not requested. Please request a new code.');
    }

    const record = JSON.parse(raw) as { userId: string; otpHash: string; attempts: number };
    if (record.attempts >= 5) {
      await this.redis.del(redisKey);
      throw new BadRequestException('Too many invalid OTP attempts. Please request a new code.');
    }

    const candidateHash = crypto.createHash('sha256').update(otp).digest('hex');
    const valid =
      candidateHash.length === record.otpHash.length &&
      crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(record.otpHash, 'hex'));

    if (!valid) {
      record.attempts += 1;
      const ttl = await this.redis.ttl(redisKey);
      await this.redis.setex(redisKey, ttl > 0 ? ttl : 300, JSON.stringify(record));
      throw new BadRequestException('Invalid verification OTP. Please check the code and try again.');
    }

    // Consume OTP and issue single-use reset token (10 min TTL)
    await this.redis.del(redisKey);
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    await this.redis.setex(`pwd_reset_token:${resetTokenHash}`, 600, record.userId);

    return {
      verified: true,
      reset_token: resetToken,
      message: 'OTP verified. You may now set a new password.',
    };
  }

  /**
   * 4.3 Reset Password using verified single-use reset token
   */
  async resetPasswordWithOtp(resetToken: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(resetToken.trim()).digest('hex');
    const tokenKey = `pwd_reset_token:${tokenHash}`;
    const userId = await this.redis.get(tokenKey);

    if (!userId) {
      throw new BadRequestException('Password reset session expired or invalid. Please restart the OTP flow.');
    }

    await this.redis.del(tokenKey);
    const newHash = await this.crypto.hashPassword(newPassword);

    const updated = await this.db.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = false, updated_at = NOW()
       WHERE id = $2
       RETURNING email`,
      [newHash, userId]
    );

    if (updated.rows.length === 0) {
      throw new NotFoundException('User account not found.');
    }

    await this.sessionService.revokeAllUserSessions(userId);

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, reason)
       VALUES ($1, $2, 'USER', 'PASSWORD_RESET_OTP', 'USER', $3, 'Password reset completed via verified email OTP');`,
      [userId, updated.rows[0].email, userId]
    );

    return {
      success: true,
      message: 'Your password has been updated successfully. Please sign in with your new password.',
    };
  }

  /**
   * 5. Invite Employee to Company Workspace
   */
  async inviteMember(inviter: any, dto: InviteMemberDto) {
    if (!inviter.tenantId) {
      throw new BadRequestException('Invitations must be sent from within an active company tenant context.');
    }

    // SECURITY CHECK: Company admins CANNOT assign PLATFORM_OWNER or Super Admin roles
    if (dto.role_name === 'PLATFORM_OWNER' || dto.role_name === 'Super Admin') {
      throw new ForbiddenException('Company administrators cannot assign platform administration privileges.');
    }

    const roleRes = await this.db.query(
      `SELECT id, name FROM roles WHERE name = $1`,
      [dto.role_name]
    );
    if (roleRes.rows.length === 0) {
      throw new BadRequestException(`Role '${dto.role_name}' does not exist.`);
    }
    const role = roleRes.rows[0];

    const inviteeEmail = dto.email.trim().toLowerCase();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const tenantName = await this.db.executeWithTenantContext(inviter.tenantId, async (client) => {
      const tRes = await client.query(
        `SELECT name, status, deleted_at FROM tenants WHERE id = $1 LIMIT 1;`,
        [inviter.tenantId],
      );
      const tRow = tRes.rows[0];
      if (!tRow || tRow.deleted_at || tRow.status === 'Archived') {
        throw new ForbiddenException('Cannot send invitations for an archived workspace.');
      }
      // Expire any previous unaccepted invitations for the same email in this tenant
      await client.query(
        `DELETE FROM invitations WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL;`,
        [inviter.tenantId, inviteeEmail],
      );
      await client.query(
        `INSERT INTO invitations (tenant_id, email, role_id, department, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days', $6);`,
        [inviter.tenantId, inviteeEmail, role.id, dto.department.trim(), tokenHash, inviter.id]
      );
      return tRow.name || 'your company workspace';
    });

    const appBaseUrl = (process.env.APP_URL || 'https://www.gsign.in').replace(/\/+$/, '');
    const inviteUrl = `${appBaseUrl}/?invite_token=${rawToken}`;
    const delivery = await this.sendEmail(
      inviteeEmail,
      `You're invited to join ${tenantName} on GSIGN`,
      `<p>Hello,</p>
       <p>You have been invited to join <strong>${tenantName}</strong> on GSIGN as <strong>${role.name}</strong> (${dto.department.trim()}).</p>
       <p>Click the link below to accept your invitation and set up your account (expires in 7 days):</p>
       <p><a href="${inviteUrl}">Accept Workspace Invitation</a></p>`,
    );

    return {
      success: true,
      message: 'Employee invitation created successfully.',
      email_delivery: delivery,
      ...(process.env.NODE_ENV !== 'production' ? { invitation_token: rawToken } : {}),
    };
  }

  private async sendEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ sent: boolean; error?: string }> {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || 'GSIGN Security <noreply@gsign.in>';
    if (!resendKey) {
      return { sent: false, error: 'RESEND_API_KEY not configured' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          html,
        }),
      });
      if (!response.ok) {
        const msg = `Resend returned HTTP ${response.status}`;
        this.logger.warn(`Email delivery failed (${subject}): ${msg}`);
        return { sent: false, error: msg };
      }
      return { sent: true };
    } catch (err: any) {
      const msg = err?.message || 'Network error';
      this.logger.warn(`Email delivery error (${subject}): ${msg}`);
      return { sent: false, error: msg };
    }
  }

  /**
   * 6. Accept Employee Invitation
   */
  async acceptInvite(dto: AcceptInviteDto) {
    const tokenHash = crypto.createHash('sha256').update(dto.token.trim()).digest('hex');

    const inviteRes = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `SELECT i.id, i.tenant_id, i.email, i.role_id, i.department, i.expires_at, i.accepted_at,
                t.status as tenant_status, t.deleted_at as tenant_deleted_at
         FROM invitations i
         JOIN tenants t ON t.id = i.tenant_id
         WHERE i.token_hash = $1`,
        [tokenHash]
      );
    });

    if (inviteRes.rows.length === 0) {
      throw new BadRequestException('Invalid invitation token.');
    }

    const invite = inviteRes.rows[0];
    if (invite.tenant_deleted_at || invite.tenant_status === 'Archived') {
      throw new ForbiddenException('This company workspace has been archived and can no longer accept invitations.');
    }
    if (invite.accepted_at) {
      throw new BadRequestException('This invitation has already been accepted.');
    }
    if (new Date(invite.expires_at) < new Date()) {
      throw new BadRequestException('Invitation has expired. Please contact your company administrator.');
    }

    return this.db.executeWithTenantContext(invite.tenant_id, async (client) => {
      // Check if user already exists
      let userId: string;
      const userRes = await client.query('SELECT id FROM users WHERE email = $1', [invite.email]);
      if (userRes.rows.length === 0) {
        const passwordHash = await this.crypto.hashPassword(dto.password);
        const newUser = await client.query(
          `INSERT INTO users (email, password_hash, full_name, is_super_admin, is_platform_owner, is_active, email_verified_at)
           VALUES ($1, $2, $3, false, false, true, NOW())
           RETURNING id;`,
          [invite.email, passwordHash, dto.full_name.trim()]
        );
        userId = newUser.rows[0].id;
      } else {
        userId = userRes.rows[0].id;
      }

      // Add to tenant_memberships
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1, $2, $3, $4, 'Active')
         ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
        [invite.tenant_id, userId, invite.role_id, invite.department]
      );

      // Mark invitation accepted
      await client.query('UPDATE invitations SET accepted_at = NOW() WHERE id = $1', [invite.id]);

      return {
        success: true,
        message: 'Invitation accepted successfully. You may now sign in to your company workspace.',
      };
    });
  }

  /**
   * Helper to resolve default active tenant for user
   */
  private async resolveDefaultTenantId(
    userId: string,
    isSuperAdmin: boolean
  ): Promise<string | null> {
    const memberRes = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `SELECT tm.tenant_id
         FROM tenant_memberships tm
         JOIN tenants t ON t.id = tm.tenant_id
         WHERE tm.user_id = $1
           AND tm.status = 'Active'
           AND t.deleted_at IS NULL
           AND t.status <> 'Archived'
         ORDER BY tm.created_at ASC
         LIMIT 1`,
        [userId]
      );
    });

    if (memberRes.rows.length > 0) {
      return memberRes.rows[0].tenant_id;
    }

    if (isSuperAdmin) {
      return null; // Super Admin has global scope
    }

    const archivedCheck = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `SELECT 1
         FROM tenant_memberships tm
         JOIN tenants t ON t.id = tm.tenant_id
         WHERE tm.user_id = $1 AND (t.deleted_at IS NOT NULL OR t.status = 'Archived')
         LIMIT 1`,
        [userId],
      );
    });

    if (archivedCheck.rows.length > 0) {
      throw new ForbiddenException(
        'Your company workspace has been archived. Access is denied.',
      );
    }

    return null;
  }
}
