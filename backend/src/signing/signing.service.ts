import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import {
  CreateSigningRequestDto,
  RejectSigningDto,
  SubmitSignatureDto,
} from './dto/signing.dto';

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
  ) {}

  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || 'GSIGN Security <onboarding@resend.dev>';
    if (!resendKey) {
      return;
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
        this.logger.warn(`Resend email delivery failed with status ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Resend email delivery error: ${(error as Error).message}`);
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
      await this.sendEmail(
        r.email,
        `Signature Requested: ${result.agreement_title} (${result.agreement_number})`,
        `<p>Hello ${r.name},</p>
         <p>You have been invited to review and sign <strong>${result.agreement_title}</strong> (${result.agreement_number}).</p>
         <p><a href="${r.signing_url}">Open Secure Signing Portal</a></p>
         <p>This link expires at ${new Date(r.token_expires_at).toUTCString()}.</p>`,
      );
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

  async getPortalByToken(rawToken: string) {
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

    await this.sendEmail(
      recipientInfo.email,
      `Your GSIGN Verification Code — ${recipientInfo.agreementNumber}`,
      `<p>Hello ${recipientInfo.name},</p>
       <p>Use the following 6-digit verification code to unlock <strong>${recipientInfo.agreementTitle}</strong>:</p>
       <h2 style="letter-spacing: 4px;">${otp}</h2>
       <p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
    );

    return {
      message: 'Verification OTP sent to your registered email address.',
      expires_in_seconds: 600,
    };
  }

  async verifyOtp(rawToken: string, otp: string, ip?: string) {
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

  async submitSignature(
    rawToken: string,
    dto: SubmitSignatureDto,
    ip?: string,
    userAgent?: string,
  ) {
    if (!dto.consent_accepted) {
      throw new BadRequestException('Explicit electronic signature consent must be accepted.');
    }

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
          dto.signature_data_url,
          documentHash,
          ip || null,
          userAgent || null,
        ],
      );

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
          `${recipient.name} (${recipient.email}) signed the agreement`,
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
          JSON.stringify({ recipient_id: recipient.id, document_hash: documentHash }),
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

      if (allCompleted) {
        await client.query(
          `UPDATE signing_requests
           SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
           WHERE id = $1::uuid`,
          [request.id],
        );

        await client.query(
          `UPDATE agreements
           SET status = 'Completed',
               signature_data_url = COALESCE(signature_data_url, $2::text),
               completed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [agreement.id, dto.signature_data_url],
        );

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
        agreement_completed: allCompleted,
        agreement_status: allCompleted ? 'Completed' : 'Partially signed',
        document_hash: documentHash,
      };
    });

    if (result.agreement_completed && this.documentsService) {
      try {
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
          certificate_number: finalized.certificate?.certificate_number,
          signed_document_id:
            'signed_document' in finalized
              ? finalized.signed_document?.id
              : finalized.certificate?.metadata?.signed_document_id,
        };
      } catch (err) {
        this.logger.warn(
          `Automatic signed PDF finalization failed for agreement ${ctx.agreementId}: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  async rejectSigning(rawToken: string, dto: RejectSigningDto, ip?: string) {
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
