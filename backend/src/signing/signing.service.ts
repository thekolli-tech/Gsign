import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../notifications/email.service';
import {
  CreateSigningRequestDto,
  RejectSigningDto,
  SubmitSignatureDto,
  VerifyBiometricAssertionDto,
} from './dto/signing.dto';
import {
  ApprovedBiometricServiceAdapter,
  DedicatedFingerprintScannerAdapter,
  InMemoryTrustedCredentialStore,
  TrustedWebAuthnCredentialStore,
  WebAuthnBiometricVerifier,
} from './biometric.provider';

interface TokenContext {
  tenantId: string;
  recipientId: string;
  signingRequestId: string;
  agreementId: string;
}

@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    @Optional() private readonly documentsService?: DocumentsService,
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly webAuthnVerifier?: WebAuthnBiometricVerifier,
    @Optional() private readonly scannerAdapter?: DedicatedFingerprintScannerAdapter,
    @Optional() private readonly approvedBiometricAdapter?: ApprovedBiometricServiceAdapter,
    @Optional() private readonly credentialStore?: InMemoryTrustedCredentialStore,
  ) {}

  private readonly fallbackCredentialStore = new InMemoryTrustedCredentialStore();

  private getCredentialStore(): TrustedWebAuthnCredentialStore {
    return this.credentialStore ?? this.fallbackCredentialStore;
  }

  private async atomicConsumeRedisKey(key: string): Promise<string | null> {
    if (typeof (this.redis as any).getdel === 'function') {
      return (this.redis as any).getdel(key);
    }
    const val = await this.redis.get(key);
    if (val !== null) {
      await this.redis.del(key);
    }
    return val;
  }

  private getWebAuthnVerifier(): WebAuthnBiometricVerifier {
    return this.webAuthnVerifier ?? new WebAuthnBiometricVerifier();
  }

  private getScannerAdapter(): DedicatedFingerprintScannerAdapter {
    return this.scannerAdapter ?? new DedicatedFingerprintScannerAdapter();
  }

  private getApprovedBiometricAdapter(): ApprovedBiometricServiceAdapter {
    return this.approvedBiometricAdapter ?? new ApprovedBiometricServiceAdapter();
  }

  private getEmailService(): EmailService {
    return this.emailService ?? new EmailService(this.db, this.redis);
  }

  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private async enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    if (count > limit) {
      throw new HttpException(
        'Too many requests. Please wait before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async resolveRecipientContextByToken(rawToken: string): Promise<TokenContext> {
    if (!rawToken || rawToken.length < 16) {
      throw new NotFoundException('Invalid or expired signing link.');
    }

    const tokenHash = this.hashValue(rawToken);
    const row = await this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT tenant_id, id, signing_request_id, agreement_id
         FROM signing_recipients
         WHERE token_hash = $1::varchar
         LIMIT 1`,
        [tokenHash],
      );
      return res.rows[0] || null;
    });

    if (!row) {
      throw new NotFoundException('Invalid or expired signing link.');
    }

    return {
      tenantId: row.tenant_id,
      recipientId: row.id,
      signingRequestId: row.signing_request_id,
      agreementId: row.agreement_id,
    };
  }

  private evaluatePortalStatus(
    recipient: any,
    request: any,
    agreement: any,
    allRecipients: any[],
  ): string {
    if (recipient.revoked_at || request.status === 'REVOKED' || recipient.status === 'REVOKED') {
      return 'REVOKED';
    }

    if (agreement.status === 'Cancelled') {
      return 'CANCELLED';
    }
    if (agreement.status === 'Rejected' || request.status === 'REJECTED' || recipient.status === 'REJECTED') {
      return 'REJECTED';
    }
    if (
      agreement.status === 'Expired' ||
      request.status === 'EXPIRED' ||
      recipient.status === 'EXPIRED' ||
      new Date(recipient.token_expires_at).getTime() < Date.now() ||
      new Date(request.expires_at).getTime() < Date.now()
    ) {
      return 'EXPIRED';
    }

    if (recipient.status === 'SIGNED') {
      return 'ALREADY_SIGNED';
    }

    if (request.sequential) {
      const blockedByPredecessor = allRecipients.some(
        (r) =>
          r.is_required &&
          r.signing_order < recipient.signing_order &&
          r.status !== 'SIGNED',
      );
      if (blockedByPredecessor) {
        return 'WAITING_PREDECESSOR';
      }
    }

    if (!recipient.otp_verified_at) {
      return 'OTP_REQUIRED';
    }

    return 'READY_TO_SIGN';
  }

  async createSigningRequest(
    tenantId: string,
    user: { id: string; email?: string; role?: string },
    dto: CreateSigningRequestDto,
    originUrl: string,
    ip?: string,
  ) {
    const expiresHours = dto.expires_in_hours ?? 168;
    const sequential = dto.sequential ?? true;

    const result = await this.db.executeWithTenantContext(tenantId, async (client) => {
      const agreementRes = await client.query(
        `SELECT id, agreement_number, template_type, department, status, document_hash, content
         FROM agreements
         WHERE id = $1::uuid
         FOR UPDATE`,
        [dto.agreement_id],
      );
      const agreement = agreementRes.rows[0];
      if (!agreement) {
        throw new NotFoundException('Agreement not found.');
      }

      if (['Completed', 'Cancelled', 'Rejected', 'Expired'].includes(agreement.status)) {
        throw new BadRequestException(
          `Cannot create signing request for an agreement in ${agreement.status} state.`,
        );
      }

      // Revoke prior active signing requests for this agreement so stale tokens cannot be reused
      await client.query(
        `UPDATE signing_requests
         SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
         WHERE agreement_id = $1::uuid AND status = 'ACTIVE'`,
        [agreement.id],
      );
      await client.query(
        `UPDATE signing_recipients
         SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
         WHERE agreement_id = $1::uuid AND status IN ('PENDING', 'OTP_VERIFIED')`,
        [agreement.id],
      );

      const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000);
      const reqRes = await client.query(
        `INSERT INTO signing_requests (tenant_id, agreement_id, created_by, sequential, status, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::boolean, 'ACTIVE', $5::timestamptz)
         RETURNING *`,
        [tenantId, agreement.id, user.id, sequential, expiresAt],
      );
      const signingRequest = reqRes.rows[0];

      const recipientsWithTokens: Array<{ recipient: any; rawToken: string; signingUrl: string }> = [];
      for (let i = 0; i < dto.recipients.length; i += 1) {
        const input = dto.recipients[i];
        const rawToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = this.hashValue(rawToken);
        const order = input.signing_order ?? i + 1;
        const isRequired = input.is_required ?? true;
        const signMethod = input.sign_method || 'basic_drawn';

        const recRes = await client.query(
          `INSERT INTO signing_recipients (
             tenant_id, signing_request_id, agreement_id, name, email,
             signing_order, is_required, sign_method, token_hash, token_expires_at, status
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar,
             $6::integer, $7::boolean, $8::varchar, $9::varchar, $10::timestamptz, 'PENDING'
           )
           RETURNING id, tenant_id, signing_request_id, agreement_id, name, email,
                     signing_order, is_required, sign_method, token_expires_at, status, created_at`,
          [
            tenantId,
            signingRequest.id,
            agreement.id,
            input.name.trim(),
            input.email.trim().toLowerCase(),
            order,
            isRequired,
            signMethod,
            tokenHash,
            expiresAt,
          ],
        );

        const cleanBase = originUrl.replace(/\/+$/, '');
        recipientsWithTokens.push({
          recipient: recRes.rows[0],
          rawToken,
          signingUrl: `${cleanBase}/?token=${rawToken}`,
        });
      }

      if (agreement.status === 'Draft') {
        await client.query(
          `UPDATE agreements
           SET status = 'Awaiting OTP', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
           WHERE id = $1::uuid`,
          [agreement.id],
        );
      }

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::text, 'sent', $6::varchar, $7::varchar)`,
        [
          tenantId,
          agreement.id,
          user.id,
          'Signing Request Created',
          `Signing request created for ${dto.recipients.length} recipient(s) (${sequential ? 'sequential' : 'parallel'})`,
          ip || null,
          agreement.document_hash || null,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, metadata, ip_address)
         VALUES ($1::uuid, $2::varchar, $3::varchar, 'SIGNING_REQUEST_CREATED', 'signing_request', $4::varchar, $5::uuid, $6::jsonb, $7::varchar)`,
        [
          user.id,
          user.email || 'system@gsign.in',
          user.role || 'Company Admin',
          signingRequest.id,
          tenantId,
          JSON.stringify({ agreement_id: agreement.id, recipient_count: dto.recipients.length }),
          ip || null,
        ],
      );

      return {
        signing_request: signingRequest,
        agreement_title: `${agreement.template_type} (${agreement.department})`,
        agreement_number: agreement.agreement_number,
        recipients: recipientsWithTokens.map((item) => ({
          ...item.recipient,
          signing_token: item.rawToken,
          signing_url: item.signingUrl,
        })),
      };
    });

    for (const r of result.recipients) {
      await this.getEmailService().sendNotification({
        template: 'agreement_sent',
        to: r.email,
        tenantId,
        payload: {
          recipientName: r.name,
          agreementTitle: result.agreement_title,
          agreementNumber: result.agreement_number,
          signingUrl: r.signing_url,
          expiresAtText: new Date(r.token_expires_at).toUTCString(),
        },
        safeMetadata: { agreement_number: result.agreement_number },
      });
    }

    return result;
  }

  async listRequestsForAgreement(tenantId: string, agreementId: string) {
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM signing_requests
         WHERE agreement_id = $1::uuid AND tenant_id = $2::uuid
         ORDER BY created_at DESC`,
        [agreementId, tenantId],
      );

      const recRes = await client.query(
        `SELECT sr.id, sr.signing_request_id, sr.agreement_id, sr.name, sr.email,
                sr.signing_order, sr.is_required, sr.sign_method, sr.token_expires_at,
                sr.revoked_at, sr.otp_verified_at, sr.status, sr.signed_at, sr.created_at,
                sig.document_hash, sig.signed_at AS signature_recorded_at,
                con.consented_at
         FROM signing_recipients sr
         LEFT JOIN signature_records sig ON sig.recipient_id = sr.id
         LEFT JOIN consent_records con ON con.recipient_id = sr.id
         WHERE sr.agreement_id = $1::uuid AND sr.tenant_id = $2::uuid
         ORDER BY sr.signing_order ASC, sr.created_at ASC`,
        [agreementId, tenantId],
      );

      return {
        requests: reqRes.rows,
        recipients: recRes.rows,
      };
    });
  }

  async revokeSigningRequest(
    tenantId: string,
    user: { id: string; email?: string; role?: string },
    requestId: string,
    ip?: string,
  ) {
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const reqRes = await client.query(
        `UPDATE signing_requests
         SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
         WHERE id = $1::uuid AND status = 'ACTIVE'
         RETURNING *`,
        [requestId],
      );
      const updated = reqRes.rows[0];
      if (!updated) {
        throw new NotFoundException('Active signing request not found.');
      }

      await client.query(
        `UPDATE signing_recipients
         SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
         WHERE signing_request_id = $1::uuid AND status IN ('PENDING', 'OTP_VERIFIED')`,
        [requestId],
      );

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Signing Request Revoked', 'Signing request revoked by sender', 'sent', $4::varchar)`,
        [tenantId, updated.agreement_id, user.id, ip || null],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, metadata, ip_address)
         VALUES ($1::uuid, $2::varchar, $3::varchar, 'SIGNING_REQUEST_REVOKED', 'signing_request', $4::varchar, $5::uuid, $6::jsonb, $7::varchar)`,
        [
          user.id,
          user.email || 'system@gsign.in',
          user.role || 'Company Admin',
          requestId,
          tenantId,
          JSON.stringify({ agreement_id: updated.agreement_id }),
          ip || null,
        ],
      );

      return updated;
    });
  }

  async getPortalByToken(rawToken: string, ip?: string) {
    const tokenHash = this.hashValue(rawToken || '');
    await this.enforceRateLimit(`rate:signing:portal:ip:${ip || 'unknown'}`, 60, 60);
    await this.enforceRateLimit(`rate:signing:portal:tok:${tokenHash}`, 30, 60);
    const ctx = await this.resolveRecipientContextByToken(rawToken);

    return this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
      const recRes = await client.query(
        `SELECT id, tenant_id, signing_request_id, agreement_id, name, email,
                signing_order, is_required, sign_method, token_expires_at,
                revoked_at, otp_verified_at, status, signed_at
         FROM signing_recipients
         WHERE id = $1::uuid`,
        [ctx.recipientId],
      );
      const recipient = recRes.rows[0];

      const reqRes = await client.query(
        `SELECT id, sequential, status, expires_at, revoked_at, completed_at, created_at
         FROM signing_requests
         WHERE id = $1::uuid`,
        [ctx.signingRequestId],
      );
      const request = reqRes.rows[0];

      const agrRes = await client.query(
        `SELECT id, agreement_number, template_type, department, status,
                content, document_hash, period, fee_amount, expires_at, created_at
         FROM agreements
         WHERE id = $1::uuid`,
        [ctx.agreementId],
      );
      const agreement = agrRes.rows[0];
      if (!recipient || !request || !agreement) {
        throw new NotFoundException('Signing request or agreement no longer exists.');
      }

      const allRecRes = await client.query(
        `SELECT id, name, email, signing_order, is_required, status, signed_at
         FROM signing_recipients
         WHERE signing_request_id = $1::uuid
         ORDER BY signing_order ASC, created_at ASC`,
        [ctx.signingRequestId],
      );
      const allRecipients = allRecRes.rows;

      const tenantRes = await client.query(
        `SELECT id, name, slug FROM tenants WHERE id = $1::uuid`,
        [ctx.tenantId],
      );

      const portalStatus = this.evaluatePortalStatus(recipient, request, agreement, allRecipients);

      return {
        portal_status: portalStatus,
        tenant: tenantRes.rows[0] || null,
        agreement: {
          ...agreement,
          title: `${agreement.template_type} Agreement`,
        },
        signing_request: request,
        recipient,
        recipients_progress: allRecipients,
      };
    });
  }

  async requestOtp(rawToken: string, ip?: string) {
    const tokenHash = this.hashValue(rawToken || '');
    await this.enforceRateLimit(`rate:signing:otp_req:ip:${ip || 'unknown'}`, 10, 900);
    await this.enforceRateLimit(`rate:signing:otp_req:tok:${tokenHash}`, 10, 900);
    const ctx = await this.resolveRecipientContextByToken(rawToken);
    const cooldownKey = `signing:otp:cooldown:${ctx.recipientId}`;

    const existingCooldown = await this.redis.get(cooldownKey);
    if (existingCooldown) {
      throw new BadRequestException('Please wait 60 seconds before requesting another OTP.');
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashValue(otp);

    const recipientInfo = await this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
      const recRes = await client.query(
        `SELECT * FROM signing_recipients WHERE id = $1::uuid FOR UPDATE`,
        [ctx.recipientId],
      );
      const recipient = recRes.rows[0];

      const reqRes = await client.query(
        `SELECT * FROM signing_requests WHERE id = $1::uuid`,
        [ctx.signingRequestId],
      );
      const request = reqRes.rows[0];

      const agrRes = await client.query(
        `SELECT id, agreement_number, template_type, status, document_hash FROM agreements WHERE id = $1::uuid`,
        [ctx.agreementId],
      );
      const agreement = agrRes.rows[0];

      const allRecRes = await client.query(
        `SELECT id, signing_order, is_required, status FROM signing_recipients WHERE signing_request_id = $1::uuid`,
        [ctx.signingRequestId],
      );

      if (!recipient || !request || !agreement) {
        throw new NotFoundException('Signing request not found.');
      }

      const portalStatus = this.evaluatePortalStatus(
        recipient,
        request,
        agreement,
        allRecRes.rows,
      );

      if (['REVOKED', 'EXPIRED', 'REJECTED', 'CANCELLED', 'ALREADY_SIGNED', 'WAITING_PREDECESSOR'].includes(portalStatus)) {
        throw new BadRequestException(`Cannot send OTP while signing status is ${portalStatus}.`);
      }

      await client.query(
        `UPDATE signing_otp_attempts
         SET consumed_at = NOW()
         WHERE recipient_id = $1::uuid AND consumed_at IS NULL`,
        [recipient.id],
      );

      await client.query(
        `INSERT INTO signing_otp_attempts (tenant_id, recipient_id, otp_hash, attempts, max_attempts, expires_at, ip_address)
         VALUES ($1::uuid, $2::uuid, $3::varchar, 0, 5, NOW() + INTERVAL '10 minutes', $4::varchar)`,
        [ctx.tenantId, recipient.id, otpHash, ip || null],
      );

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1::uuid, $2::uuid, 'Signing OTP Requested', $3::text, 'otp', $4::varchar, $5::varchar)`,
        [
          ctx.tenantId,
          agreement.id,
          `Verification OTP dispatched to ${recipient.email}`,
          ip || null,
          agreement.document_hash || null,
        ],
      );

      return {
        email: recipient.email,
        name: recipient.name,
        agreementTitle: `${agreement.template_type} Agreement`,
        agreementNumber: agreement.agreement_number,
      };
    });

    await this.redis.setex(cooldownKey, 60, '1');

    await this.getEmailService().sendNotification({
      template: 'signing_otp',
      to: recipientInfo.email,
      payload: {
        recipientName: recipientInfo.name,
        agreementTitle: recipientInfo.agreementTitle,
        agreementNumber: recipientInfo.agreementNumber,
        otp,
      },
      safeMetadata: { agreement_number: recipientInfo.agreementNumber },
    });

    return {
      message: 'Verification OTP sent to your registered email address.',
      expires_in_seconds: 600,
    };
  }

  async verifyOtp(rawToken: string, otp: string, ip?: string) {
    const tokenHash = this.hashValue(rawToken || '');
    await this.enforceRateLimit(`rate:signing:otp_ver:ip:${ip || 'unknown'}`, 30, 900);
    await this.enforceRateLimit(`rate:signing:otp_ver:tok:${tokenHash}`, 10, 900);
    const ctx = await this.resolveRecipientContextByToken(rawToken);
    const providedHash = this.hashValue(otp.trim());

    const outcome = await this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
      const recRes = await client.query(
        `SELECT * FROM signing_recipients WHERE id = $1::uuid FOR UPDATE`,
        [ctx.recipientId],
      );
      const recipient = recRes.rows[0];
      const reqRes = await client.query(
        `SELECT * FROM signing_requests WHERE id = $1::uuid`,
        [ctx.signingRequestId],
      );
      const request = reqRes.rows[0];
      const agrRes = await client.query(
        `SELECT * FROM agreements WHERE id = $1::uuid FOR UPDATE`,
        [ctx.agreementId],
      );
      const agreement = agrRes.rows[0];
      const allRecRes = await client.query(
        `SELECT id, signing_order, is_required, status FROM signing_recipients WHERE signing_request_id = $1::uuid`,
        [ctx.signingRequestId],
      );

      if (!recipient || !request || !agreement) {
        return { errorType: 'not_found' as const, message: 'Signing request not found.' };
      }

      const portalStatus = this.evaluatePortalStatus(
        recipient,
        request,
        agreement,
        allRecRes.rows,
      );
      if (['REVOKED', 'EXPIRED', 'REJECTED', 'CANCELLED', 'ALREADY_SIGNED', 'WAITING_PREDECESSOR'].includes(portalStatus)) {
        return {
          errorType: 'bad_request' as const,
          message: `Cannot verify OTP while signing status is ${portalStatus}.`,
        };
      }

      const otpRes = await client.query(
        `SELECT * FROM signing_otp_attempts
         WHERE recipient_id = $1::uuid AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [recipient.id],
      );
      const attemptRow = otpRes.rows[0];
      if (!attemptRow) {
        return {
          errorType: 'bad_request' as const,
          message: 'No active OTP found. Please request a new code.',
        };
      }

      if (new Date(attemptRow.expires_at).getTime() < Date.now()) {
        await client.query(
          `UPDATE signing_otp_attempts SET consumed_at = NOW() WHERE id = $1::uuid`,
          [attemptRow.id],
        );
        return {
          errorType: 'bad_request' as const,
          message: 'OTP has expired. Please request a new code.',
        };
      }

      if (attemptRow.attempts >= attemptRow.max_attempts) {
        await client.query(
          `UPDATE signing_otp_attempts SET consumed_at = NOW() WHERE id = $1::uuid`,
          [attemptRow.id],
        );
        return {
          errorType: 'bad_request' as const,
          message: 'Maximum OTP attempts exceeded. Please request a new code.',
        };
      }

      const a = Buffer.from(providedHash, 'hex');
      const b = Buffer.from(attemptRow.otp_hash, 'hex');
      const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

      if (!matches) {
        const nextAttempts = attemptRow.attempts + 1;
        await client.query(
          `UPDATE signing_otp_attempts
           SET attempts = $1::integer,
               consumed_at = CASE WHEN $1::integer >= max_attempts THEN NOW() ELSE NULL END
           WHERE id = $2::uuid`,
          [nextAttempts, attemptRow.id],
        );
        return {
          errorType: 'unauthorized' as const,
          message: 'Invalid OTP code.',
        };
      }

      await client.query(
        `UPDATE signing_otp_attempts SET consumed_at = NOW() WHERE id = $1::uuid`,
        [attemptRow.id],
      );

      await client.query(
        `UPDATE signing_recipients
         SET otp_verified_at = NOW(), status = 'OTP_VERIFIED', updated_at = NOW()
         WHERE id = $1::uuid`,
        [recipient.id],
      );

      if (agreement.status === 'Awaiting OTP') {
        await client.query(
          `UPDATE agreements SET status = 'Awaiting signature', updated_at = NOW() WHERE id = $1::uuid`,
          [agreement.id],
        );
      }

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1::uuid, $2::uuid, 'Email OTP Verified', $3::text, 'otp', $4::varchar, $5::varchar)`,
        [
          ctx.tenantId,
          agreement.id,
          `Recipient ${recipient.name} verified email OTP`,
          ip || null,
          agreement.document_hash || null,
        ],
      );

      return {
        errorType: null,
        verified: true,
        portal_status: 'READY_TO_SIGN',
      };
    });

    if (outcome.errorType === 'not_found') {
      throw new NotFoundException(outcome.message);
    }
    if (outcome.errorType === 'bad_request') {
      throw new BadRequestException(outcome.message);
    }
    if (outcome.errorType === 'unauthorized') {
      throw new UnauthorizedException(outcome.message);
    }

    return {
      verified: outcome.verified,
      portal_status: outcome.portal_status,
    };
  }

  async getBiometricCapabilities(rawToken: string) {
    const ctx = await this.resolveRecipientContextByToken(rawToken);
    const hasTrustedCredential = await this.getCredentialStore().hasActiveCredentialsForSubject(
      ctx.recipientId,
    );
    return {
      device_webauthn: {
        available: hasTrustedCredential,
        label: 'Device Biometric / Passkey Verification',
        reason: hasTrustedCredential
          ? undefined
          : 'No registered trusted passkey/device credential exists for this recipient. Use Drawn Signature, OTP, or Digital Thumb Impression.',
        note: 'Uses browser WebAuthn user verification (platform passkey, Touch ID, Face ID, Windows Hello, or device PIN).',
      },
      dedicated_scanner: this.getScannerAdapter().getStatus(),
      approved_service: this.getApprovedBiometricAdapter().getStatus(),
      aadhaar_esign: {
        available: false,
        label: 'Aadhaar eSign',
        reason: 'Unavailable until an approved ASP/UIDAI eSign provider is integrated.',
      },
      dsc: {
        available: false,
        label: 'DSC',
        reason: 'Unavailable until an approved DSC token provider is integrated.',
      },
    };
  }

  async createBiometricChallenge(
    rawToken: string,
    origin: string,
    rpId: string,
    ip?: string,
  ) {
    const tokenHash = this.hashValue(rawToken || '');
    await this.enforceRateLimit(`rate:signing:bio_chal:ip:${ip || 'unknown'}`, 20, 900);
    const ctx = await this.resolveRecipientContextByToken(rawToken);
    const hasTrustedCredential = await this.getCredentialStore().hasActiveCredentialsForSubject(
      ctx.recipientId,
    );
    if (!hasTrustedCredential) {
      throw new ForbiddenException(
        'No registered trusted passkey/device credential found for this recipient.',
      );
    }
    const verifier = this.getWebAuthnVerifier();
    const { challengeId, challenge } = verifier.generateChallenge();

    const redisKey = `signing:webauthn:challenge:${tokenHash}:${challengeId}`;
    await this.redis.setex(
      redisKey,
      300,
      JSON.stringify({
        recipientId: ctx.recipientId,
        agreementId: ctx.agreementId,
        challenge,
        origin,
        rpId,
      }),
    );

    await this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address)
         VALUES ($1::uuid, $2::uuid, 'Biometric Authentication Initiated', $3::text, 'otp', $4::varchar)`,
        [
          ctx.tenantId,
          ctx.agreementId,
          'Recipient initiated Device Biometric / Passkey verification challenge',
          ip || null,
        ],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_role, action, target_type, target_id, tenant_id, metadata, ip_address)
         VALUES ('Recipient', 'BIOMETRIC_AUTH_INITIATED', 'agreement', $1::varchar, $2::uuid, $3::jsonb, $4::varchar)`,
        [
          ctx.agreementId,
          ctx.tenantId,
          JSON.stringify({ provider_category: 'device_webauthn', challenge_id: challengeId }),
          ip || null,
        ],
      );
    });

    return {
      challenge_id: challengeId,
      challenge,
      rp_id: rpId,
      timeout: 60000,
      user_verification: 'required',
      provider_category: 'device_webauthn',
    };
  }

  async verifyBiometricAssertion(
    rawToken: string,
    dto: VerifyBiometricAssertionDto,
    origin: string,
    rpId: string,
    ip?: string,
    userAgent?: string,
  ) {
    const tokenHash = this.hashValue(rawToken || '');
    const ctx = await this.resolveRecipientContextByToken(rawToken);
    const redisKey = `signing:webauthn:challenge:${tokenHash}:${dto.challenge_id}`;
    const storedRaw = await this.atomicConsumeRedisKey(redisKey);

    if (!storedRaw) {
      throw new ForbiddenException('Biometric challenge expired, invalid, or already used.');
    }

    let stored: { recipientId: string; agreementId: string; challenge: string; origin: string; rpId: string };
    try {
      stored = JSON.parse(storedRaw);
    } catch {
      throw new ForbiddenException('Malformed stored biometric challenge.');
    }

    if (stored.recipientId !== ctx.recipientId || stored.agreementId !== ctx.agreementId) {
      throw new ForbiddenException('Biometric challenge does not match this recipient session.');
    }

    const store = this.getCredentialStore();
    const trustedCred = await store.findCredentialForSubject(ctx.recipientId, dto.credential_id);
    if (!trustedCred) {
      throw new ForbiddenException('Credential is not registered or trusted for this recipient.');
    }
    if (trustedCred.revokedAt) {
      throw new ForbiddenException('This biometric credential has been revoked.');
    }

    const verifier = this.getWebAuthnVerifier();
    try {
      const verified = verifier.verifyAssertion({
        challenge_id: dto.challenge_id,
        credential_id: dto.credential_id,
        client_data_json: dto.client_data_json,
        authenticator_data: dto.authenticator_data,
        signature: dto.signature,
        trusted_public_key_spki_pem: trustedCred.publicKeySpkiPem,
        expected_rp_id: stored.rpId || rpId,
        expected_origin: stored.origin || origin,
        expected_challenge: stored.challenge,
        previous_sign_count: trustedCred.signCount,
      });

      await store.updateSignCount(trustedCred.credentialId, verified.signCount);

      const issued = verifier.issueVerificationToken({
        recipientId: ctx.recipientId,
        agreementId: ctx.agreementId,
        signingRequestId: ctx.signingRequestId,
        providerCategory: 'device_webauthn',
        referenceId: dto.challenge_id,
      });

      await this.redis.setex(`signing:biometric:jti:${issued.jti}`, issued.ttlSeconds, '1');

      await this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
        await client.query(
          `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, device_info)
           VALUES ($1::uuid, $2::uuid, 'Device Biometric / Passkey Verified', $3::text, 'consent', $4::varchar, $5::text)`,
          [
            ctx.tenantId,
            ctx.agreementId,
            `Device Biometric / Passkey verification succeeded (ref: ${dto.challenge_id.slice(0, 12)})`,
            ip || null,
            userAgent || null,
          ],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_role, action, target_type, target_id, tenant_id, metadata, ip_address, user_agent)
           VALUES ('Recipient', 'BIOMETRIC_AUTH_VERIFIED', 'agreement', $1::varchar, $2::uuid, $3::jsonb, $4::varchar, $5::text)`,
          [
            ctx.agreementId,
            ctx.tenantId,
            JSON.stringify({
              provider_category: 'device_webauthn',
              reference_id: dto.challenge_id,
              user_verified: verified.userVerified,
            }),
            ip || null,
            userAgent || null,
          ],
        );
      });

      return {
        verified: true,
        provider_category: 'device_webauthn',
        reference_id: dto.challenge_id,
        biometric_verification_token: issued.token,
      };
    } catch (err: any) {
      await this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
        await client.query(
          `INSERT INTO audit_logs (actor_role, action, target_type, target_id, tenant_id, metadata, ip_address, user_agent)
           VALUES ('Recipient', 'BIOMETRIC_AUTH_FAILED', 'agreement', $1::varchar, $2::uuid, $3::jsonb, $4::varchar, $5::text)`,
          [
            ctx.agreementId,
            ctx.tenantId,
            JSON.stringify({
              provider_category: 'device_webauthn',
              reference_id: dto.challenge_id,
              reason: err?.message || 'Verification failed',
            }),
            ip || null,
            userAgent || null,
          ],
        );
      }).catch(() => {});
      throw err;
    }
  }

  async submitSignature(
    rawToken: string,
    dto: SubmitSignatureDto,
    ip?: string,
    userAgent?: string,
  ) {
    if (!dto.consent_accepted) {
      throw new BadRequestException('Explicit electronic signature consent must be accepted.');
    }

    const tokenHash = this.hashValue(rawToken || '');
    await this.enforceRateLimit(`rate:signing:submit:ip:${ip || 'unknown'}`, 10, 900);
    await this.enforceRateLimit(`rate:signing:submit:tok:${tokenHash}`, 10, 900);
    const ctx = await this.resolveRecipientContextByToken(rawToken);

    const result = await this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM signing_requests WHERE id = $1::uuid FOR UPDATE`,
        [ctx.signingRequestId],
      );
      const request = reqRes.rows[0];

      const agrRes = await client.query(
        `SELECT * FROM agreements WHERE id = $1::uuid FOR UPDATE`,
        [ctx.agreementId],
      );
      const agreement = agrRes.rows[0];

      const recRes = await client.query(
        `SELECT * FROM signing_recipients WHERE id = $1::uuid FOR UPDATE`,
        [ctx.recipientId],
      );
      const recipient = recRes.rows[0];

      if (!request || !agreement || !recipient) {
        throw new NotFoundException('Signing record not found.');
      }

      if (recipient.status === 'SIGNED') {
        throw new ConflictException('Signature has already been submitted for this recipient.');
      }

      const allRecRes = await client.query(
        `SELECT id, signing_order, is_required, status
         FROM signing_recipients
         WHERE signing_request_id = $1::uuid
         ORDER BY signing_order ASC
         FOR UPDATE`,
        [ctx.signingRequestId],
      );

      const portalStatus = this.evaluatePortalStatus(
        recipient,
        request,
        agreement,
        allRecRes.rows,
      );

      if (portalStatus === 'WAITING_PREDECESSOR') {
        throw new BadRequestException('Sequential signing order requires previous signers to complete first.');
      }
      if (portalStatus === 'OTP_REQUIRED') {
        throw new ForbiddenException('Email OTP verification is required before signing.');
      }
      if (portalStatus !== 'READY_TO_SIGN') {
        throw new BadRequestException(`Cannot submit signature when status is ${portalStatus}.`);
      }

      if (Array.isArray(dto.field_responses)) {
        for (const fieldResp of dto.field_responses) {
          const role = fieldResp.assigned_role || 'Recipient';
          if (role !== 'Recipient') {
            throw new ForbiddenException(
              `Recipients can only complete fields assigned to them (field '${fieldResp.field_id}' is assigned to '${role}').`,
            );
          }
          if (fieldResp.required) {
            const typeLower = (fieldResp.type || '').toLowerCase();
            if (typeLower === 'checkbox' && fieldResp.checked !== true) {
              throw new BadRequestException(`Required checkbox field '${fieldResp.field_id}' must be checked.`);
            }
            if (
              ['text', 'date', 'initials'].includes(typeLower) &&
              !String(fieldResp.value || '').trim()
            ) {
              throw new BadRequestException(`Required ${fieldResp.type} field '${fieldResp.field_id}' cannot be empty.`);
            }
          }
        }
      }

      let effectiveSignatureDataUrl = dto.signature_data_url;
      const effectiveSigningMethod = dto.signing_method || 'basic_drawn';
      let biometricRef: { providerCategory: string; referenceId: string } | null = null;

      if (effectiveSigningMethod === 'digital_thumb_impression') {
        if (!dto.thumb_impression?.data_url) {
          throw new BadRequestException('Digital thumb impression image is required.');
        }
        const thumbMatch = dto.thumb_impression.data_url.match(/^data:image\/(png|jpeg);base64,(.+)$/i);
        if (!thumbMatch || Buffer.from(thumbMatch[2], 'base64').length <= 32) {
          throw new BadRequestException('Digital thumb impression must be a valid PNG or JPEG image.');
        }
        effectiveSignatureDataUrl = dto.thumb_impression.data_url;
      }

      if (effectiveSigningMethod === 'device_biometric') {
        if (!dto.biometric_verification_token) {
          throw new ForbiddenException('Device Biometric / Passkey verification is required before submitting.');
        }
        const verifiedTok = this.getWebAuthnVerifier().verifyVerificationToken(
          dto.biometric_verification_token,
          recipient.id,
          agreement.id,
          request.id,
        );
        const consumedJti = await this.atomicConsumeRedisKey(`signing:biometric:jti:${verifiedTok.jti}`);
        if (!consumedJti) {
          throw new ForbiddenException('Biometric verification token has already been used or expired.');
        }
        biometricRef = verifiedTok;
      }

      const documentHash =
        agreement.document_hash ||
        this.hashValue(`${agreement.id}:${agreement.agreement_number}:${agreement.template_type}`);

      await client.query(
        `INSERT INTO consent_records (tenant_id, agreement_id, recipient_id, consent_text, accepted, ip_address, user_agent)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, TRUE, $5::varchar, $6::text)`,
        [ctx.tenantId, agreement.id, recipient.id, dto.consent_text, ip || null, userAgent || null],
      );

      await client.query(
        `INSERT INTO signature_records (
           tenant_id, agreement_id, signing_request_id, recipient_id,
           signature_data_url, document_hash, ip_address, user_agent
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid,
           $5::text, $6::varchar, $7::varchar, $8::text
         )`,
        [
          ctx.tenantId,
          agreement.id,
          request.id,
          recipient.id,
          effectiveSignatureDataUrl,
          documentHash,
          ip || null,
          userAgent || null,
        ],
      );

      if (effectiveSigningMethod === 'digital_thumb_impression' && dto.thumb_impression) {
        await client.query(
          `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, device_info, document_hash)
           VALUES ($1::uuid, $2::uuid, 'Digital Thumb Impression Captured', $3::text, 'signed', $4::varchar, $5::text, $6::varchar)`,
          [
            ctx.tenantId,
            agreement.id,
            `${recipient.name} provided ${dto.thumb_impression.thumb_type} thumb impression (${dto.thumb_impression.capture_mode})`,
            ip || null,
            userAgent || null,
            documentHash,
          ],
        );
      }

      await client.query(
        `UPDATE signing_recipients
         SET status = 'SIGNED', signed_at = NOW(), updated_at = NOW()
         WHERE id = $1::uuid`,
        [recipient.id],
      );

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, device_info, document_hash)
         VALUES ($1::uuid, $2::uuid, 'Recipient Signed', $3::text, 'signed', $4::varchar, $5::text, $6::varchar)`,
        [
          ctx.tenantId,
          agreement.id,
          `${recipient.name} (${recipient.email}) signed via ${effectiveSigningMethod}`,
          ip || null,
          userAgent || null,
          documentHash,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, metadata, ip_address, user_agent)
         VALUES ($1::varchar, 'Recipient', 'RECIPIENT_SIGNED', 'agreement', $2::varchar, $3::uuid, $4::jsonb, $5::varchar, $6::text)`,
        [
          recipient.email,
          agreement.id,
          ctx.tenantId,
          JSON.stringify({
            recipient_id: recipient.id,
            document_hash: documentHash,
            signing_method: effectiveSigningMethod,
            thumb_type: dto.thumb_impression?.thumb_type,
            capture_mode: dto.thumb_impression?.capture_mode,
            biometric_provider_category: biometricRef?.providerCategory,
            biometric_reference_id: biometricRef?.referenceId,
          }),
          ip || null,
          userAgent || null,
        ],
      );

      const pendingRes = await client.query(
        `SELECT COUNT(*)::int AS pending_count
         FROM signing_recipients
         WHERE signing_request_id = $1::uuid
           AND is_required = TRUE
           AND status <> 'SIGNED'`,
        [request.id],
      );
      const pendingCount = Number(pendingRes.rows[0]?.pending_count ?? 0);
      const allCompleted = pendingCount === 0;

      const nextSignerRes = allCompleted
        ? { rows: [] }
        : await client.query(
            `SELECT name, email, signing_order
             FROM signing_recipients
             WHERE signing_request_id = $1::uuid
               AND is_required = TRUE
               AND status <> 'SIGNED'
             ORDER BY signing_order ASC, created_at ASC
             LIMIT 1`,
            [request.id],
          );
      const nextSigner = nextSignerRes.rows[0] || null;

      if (allCompleted) {
        if (this.documentsService) {
          await client.query(
            `UPDATE signing_requests
             SET status = 'FINALIZING', updated_at = NOW()
             WHERE id = $1::uuid`,
            [request.id],
          );

          await client.query(
            `UPDATE agreements
             SET status = 'Finalizing',
                 signature_data_url = COALESCE(signature_data_url, $2::text),
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [agreement.id, dto.signature_data_url],
          );
        } else {
          await client.query(
            `UPDATE signing_requests
             SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid`,
            [request.id],
          );

          const completedRes = await client.query(
            `UPDATE agreements
             SET status = 'Completed',
                 signature_data_url = COALESCE(signature_data_url, $2::text),
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1::uuid AND status <> 'Completed'
             RETURNING id`,
            [agreement.id, dto.signature_data_url],
          );

          if ((completedRes.rowCount ?? completedRes.rows.length) > 0) {
            await client.query(
              `INSERT INTO usage_records (tenant_id, period_start, period_end, agreements_completed)
               VALUES (
                 $1::uuid,
                 date_trunc('month', NOW() AT TIME ZONE 'UTC')::date,
                 (date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date,
                 1
               )
               ON CONFLICT (tenant_id, period_start)
               DO UPDATE SET
                 agreements_completed = usage_records.agreements_completed + 1,
                 updated_at = NOW()`,
              [ctx.tenantId],
            );
          }

          await client.query(
            `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, document_hash)
             VALUES ($1::uuid, $2::uuid, 'Agreement Completed', 'All required recipients signed; agreement completed', 'signed', $3::varchar, $4::varchar)`,
            [ctx.tenantId, agreement.id, ip || null, documentHash],
          );

          await client.query(
            `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, metadata, ip_address)
             VALUES ($1::varchar, 'System', 'AGREEMENT_COMPLETED', 'agreement', $2::varchar, $3::uuid, $4::jsonb, $5::varchar)`,
            [
              recipient.email,
              agreement.id,
              ctx.tenantId,
              JSON.stringify({ signing_request_id: request.id }),
              ip || null,
            ],
          );
        }
      } else {
        await client.query(
          `UPDATE agreements
           SET status = 'Partially signed', updated_at = NOW()
           WHERE id = $1::uuid`,
          [agreement.id],
        );
      }

      return {
        signed: true,
        agreement_completed: allCompleted && !this.documentsService,
        agreement_status: allCompleted
          ? this.documentsService
            ? 'Finalizing'
            : 'Completed'
          : 'Partially signed',
        next_signer: nextSigner,
        document_hash: documentHash,
        signer_name: recipient.name,
        recipient_email: agreement.recipient_email,
        recipient_name: agreement.recipient_name,
        agreement_number: agreement.agreement_number,
        agreement_title: `${agreement.template_type} (${agreement.department})`,
      };
    });

    if (this.emailService && result.recipient_email) {
      await this.emailService
        .sendNotification({
          template: result.agreement_status === 'Partially signed' ? 'agreement_signed' : 'agreement_completed',
          to: result.recipient_email,
          tenantId: ctx.tenantId,
          payload:
            result.agreement_status === 'Partially signed'
              ? {
                  recipientName: result.recipient_name || 'Recipient',
                  signerName: result.signer_name || 'Signatory',
                  agreementNumber: result.agreement_number,
                  agreementTitle: result.agreement_title,
                }
              : {
                  recipientName: result.recipient_name || 'Recipient',
                  agreementNumber: result.agreement_number,
                  agreementTitle: result.agreement_title,
                },
          safeMetadata: { agreement_number: result.agreement_number },
        })
        .catch(() => {});
    }

    if (result.agreement_status === 'Finalizing' && this.documentsService) {
      const finalized = await this.documentsService.generateFinalSignedPackage(
        ctx.tenantId,
        ctx.agreementId,
        ctx.signingRequestId,
        { email: 'signing-engine@gsign.in', role: 'System' },
        ip,
        userAgent,
      );
      return {
        ...result,
        agreement_completed: true,
        agreement_status: 'Completed',
        certificate_number: finalized.certificate?.certificate_number,
        signed_document_id:
          'signed_document' in finalized
            ? finalized.signed_document?.id
            : finalized.certificate?.metadata?.signed_document_id,
      };
    }

    return result;
  }

  async retryFinalization(
    tenantId: string,
    agreementId: string,
    user: { id: string; email?: string; role?: string },
    ip?: string,
    userAgent?: string,
  ) {
    if (!this.documentsService) {
      throw new BadRequestException('DocumentsService is not available.');
    }
    return this.documentsService.generateFinalSignedPackage(
      tenantId,
      agreementId,
      undefined,
      user,
      ip,
      userAgent,
    );
  }

  async rejectSigning(rawToken: string, dto: RejectSigningDto, ip?: string) {
    const tokenHash = this.hashValue(rawToken || '');
    await this.enforceRateLimit(`rate:signing:reject:ip:${ip || 'unknown'}`, 10, 900);
    await this.enforceRateLimit(`rate:signing:reject:tok:${tokenHash}`, 10, 900);
    const ctx = await this.resolveRecipientContextByToken(rawToken);

    return this.db.executeWithTenantContext(ctx.tenantId, async (client) => {
      const reqRes = await client.query(
        `SELECT * FROM signing_requests WHERE id = $1::uuid FOR UPDATE`,
        [ctx.signingRequestId],
      );
      const request = reqRes.rows[0];
      const agrRes = await client.query(
        `SELECT * FROM agreements WHERE id = $1::uuid FOR UPDATE`,
        [ctx.agreementId],
      );
      const agreement = agrRes.rows[0];
      const recRes = await client.query(
        `SELECT * FROM signing_recipients WHERE id = $1::uuid FOR UPDATE`,
        [ctx.recipientId],
      );
      const recipient = recRes.rows[0];

      if (!request || !agreement || !recipient) {
        throw new NotFoundException('Signing request not found.');
      }

      if (
        recipient.status === 'SIGNED' ||
        ['Completed', 'Cancelled', 'Rejected', 'Expired'].includes(agreement.status) ||
        request.status === 'REVOKED'
      ) {
        throw new BadRequestException('This signing request can no longer be rejected.');
      }

      await client.query(
        `UPDATE signing_recipients SET status = 'REJECTED', updated_at = NOW() WHERE id = $1::uuid`,
        [recipient.id],
      );
      await client.query(
        `UPDATE signing_requests SET status = 'REJECTED', updated_at = NOW() WHERE id = $1::uuid`,
        [request.id],
      );
      await client.query(
        `UPDATE agreements SET status = 'Rejected', updated_at = NOW() WHERE id = $1::uuid`,
        [agreement.id],
      );

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1::uuid, $2::uuid, 'Agreement Rejected', $3::text, 'signed', $4::varchar, $5::varchar)`,
        [
          ctx.tenantId,
          agreement.id,
          `${recipient.name} rejected the agreement: ${dto.reason.trim()}`,
          ip || null,
          agreement.document_hash || null,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata, ip_address)
         VALUES ($1::varchar, 'Recipient', 'RECIPIENT_REJECTED', 'agreement', $2::varchar, $3::uuid, $4::text, $5::jsonb, $6::varchar)`,
        [
          recipient.email,
          agreement.id,
          ctx.tenantId,
          dto.reason.trim(),
          JSON.stringify({ recipient_id: recipient.id }),
          ip || null,
        ],
      );

      return {
        rejected: true,
        agreement_status: 'Rejected',
      };
    });
  }
}
