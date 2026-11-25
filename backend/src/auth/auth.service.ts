import {
  Injectable,
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

@Injectable()
export class AuthService {
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
   * Helper to resolve default active tenant for user
   */
  private async resolveDefaultTenantId(
    userId: string,
    isSuperAdmin: boolean
  ): Promise<string | null> {
    const memberRes = await this.db.query(
      `SELECT tenant_id FROM tenant_memberships 
       WHERE user_id = $1 AND status = 'Active' 
       ORDER BY created_at ASC LIMIT 1`,
      [userId]
    );

    if (memberRes.rows.length > 0) {
      return memberRes.rows[0].tenant_id;
    }

    if (isSuperAdmin) {
      return null; // Super Admin has global scope
    }

    return null;
  }
}
