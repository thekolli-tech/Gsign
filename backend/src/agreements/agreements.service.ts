import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../notifications/email.service';
import {
  AgreementStatusValue,
  CreateAgreementDto,
  TransitionAgreementDto,
  UpdateAgreementDto,
} from './dto/agreement.dto';

const ALLOWED_TRANSITIONS: Record<AgreementStatusValue, AgreementStatusValue[]> = {
  Draft: ['Awaiting OTP', 'Awaiting signature', 'Cancelled'],
  'Awaiting OTP': ['Awaiting signature', 'Partially signed', 'Finalizing', 'Completed', 'Rejected', 'Expired', 'Cancelled'],
  'Awaiting signature': ['Partially signed', 'Finalizing', 'Completed', 'Rejected', 'Expired', 'Cancelled'],
  'Partially signed': ['Finalizing', 'Completed', 'Rejected', 'Expired', 'Cancelled'],
  Finalizing: [],
  Completed: [],
  Expired: [],
  Rejected: [],
  Cancelled: [],
};

@Injectable()
export class AgreementsService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  private computeHash(payload: {
    agreement_number: string;
    tenant_id: string;
    recipient_email: string;
    template_type: string;
    content: string;
    fee_amount: number;
  }): string {
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          agreement_number: payload.agreement_number,
          tenant_id: payload.tenant_id,
          recipient_email: payload.recipient_email,
          template_type: payload.template_type,
          content: payload.content,
          fee_amount: Number(payload.fee_amount),
        })
      )
      .digest('hex');
  }

  private mapRow(row: any, events: any[] = []) {
    return {
      id: row.agreement_number,
      uuid: row.id,
      tenantId: row.tenant_id,
      createdBy: row.created_by,
      recipientName: row.recipient_name,
      recipientEmail: row.recipient_email,
      recipientPhone: row.recipient_phone || '',
      templateType: row.template_type,
      department: row.department,
      status: row.status,
      feeAmount: Number(row.fee_amount || 0),
      period: row.period,
      content: row.content,
      signMethod: row.sign_method,
      signatureDataUrl: row.signature_data_url || undefined,
      documentHash: row.document_hash,
      witnessRequired: Boolean(row.witness_required),
      witnessName: row.witness_name || undefined,
      createdAt: new Date(row.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      updatedAt: new Date(row.updated_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      auditTrail: events.map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        timestamp: new Date(e.created_at).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
        type: e.event_type,
        ip: e.ip_address || undefined,
        device: e.device_info || undefined,
        hash: e.document_hash || undefined,
      })),
    };
  }

  private async findByIdentifier(client: any, tenantId: string, identifier: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const res = await client.query(
      isUuid
        ? `SELECT * FROM agreements WHERE tenant_id = $1 AND id = $2 LIMIT 1`
        : `SELECT * FROM agreements WHERE tenant_id = $1 AND agreement_number = $2 LIMIT 1`,
      [tenantId, identifier]
    );
    return res.rows[0] || null;
  }

  async listAgreements(tenantId: string, filters?: { status?: string; department?: string }) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required to list agreements.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      const conditions = ['a.tenant_id = $1'];
      const params: any[] = [tenantId];

      if (filters?.status && filters.status !== 'All') {
        params.push(filters.status);
        conditions.push(`a.status = $${params.length}`);
      }
      if (filters?.department && filters.department !== 'All') {
        params.push(filters.department);
        conditions.push(`a.department = $${params.length}`);
      }

      const agRes = await client.query(
        `SELECT * FROM agreements a WHERE ${conditions.join(' AND ')} ORDER BY a.created_at DESC`,
        params
      );

      if (agRes.rows.length === 0) return [];

      const agIds = agRes.rows.map(r => r.id);
      const evRes = await client.query(
        `SELECT * FROM agreement_events WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[]) ORDER BY created_at ASC`,
        [tenantId, agIds]
      );

      const eventsByAg = new Map<string, any[]>();
      for (const ev of evRes.rows) {
        const list = eventsByAg.get(ev.agreement_id) || [];
        list.push(ev);
        eventsByAg.set(ev.agreement_id, list);
      }

      return agRes.rows.map(r => this.mapRow(r, eventsByAg.get(r.id) || []));
    });
  }

  async getAgreement(tenantId: string, identifier: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      const row = await this.findByIdentifier(client, tenantId, identifier);
      if (!row) {
        throw new NotFoundException('Agreement not found.');
      }

      const evRes = await client.query(
        `SELECT * FROM agreement_events WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY created_at ASC`,
        [tenantId, row.id]
      );

      return this.mapRow(row, evRes.rows);
    });
  }

  async createAgreement(tenantId: string, user: any, dto: CreateAgreementDto, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required to create an agreement.');
    }
    if (dto.sign_method === 'aadhaar_esign' || dto.sign_method === 'dsc') {
      throw new BadRequestException(
        'Aadhaar eSign and DSC are not yet integrated; please select basic_drawn or otp_verified.',
      );
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      // Lock tenant row to serialize monthly agreement quota checks & sequence numbering.
      await client.query(`SELECT id FROM tenants WHERE id = $1::uuid FOR UPDATE`, [tenantId]);

      if (!user?.isPlatformOwner) {
        const subRes = await client.query(
          `SELECT sp.name AS plan_name, sp.max_agreements_per_month
           FROM tenant_subscriptions ts
           JOIN subscription_plans sp ON sp.id = ts.plan_id
           WHERE ts.tenant_id = $1::uuid
             AND (
               (UPPER(ts.status) IN ('ACTIVE', 'TRIALING') AND (ts.current_period_end IS NULL OR ts.current_period_end >= NOW() OR (ts.grace_period_end IS NOT NULL AND ts.grace_period_end > NOW())))
               OR (UPPER(ts.status) = 'PAST_DUE' AND ts.grace_period_end IS NOT NULL AND ts.grace_period_end > NOW())
             )
           ORDER BY ts.updated_at DESC NULLS LAST, ts.created_at DESC
           LIMIT 1`,
          [tenantId],
        );
        const activeSub = subRes.rows[0];
        if (!activeSub) {
          throw new ForbiddenException('An active subscription plan is required to create agreements.');
        }

        await client.query(
          `INSERT INTO usage_records (tenant_id, period_start, period_end)
           VALUES (
             $1::uuid,
             date_trunc('month', NOW() AT TIME ZONE 'UTC')::date,
             (date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date
           )
           ON CONFLICT (tenant_id, period_start) DO NOTHING`,
          [tenantId],
        );

        const usageRes = await client.query(
          `SELECT
             ur.agreements_created::int AS recorded_created,
             (
               SELECT COUNT(*)::int
               FROM agreements a
               WHERE a.tenant_id = $1::uuid
                 AND a.created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
                 AND a.created_at < date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month'
             ) AS actual_created
           FROM usage_records ur
           WHERE ur.tenant_id = $1::uuid
             AND ur.period_start = date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
           FOR UPDATE`,
          [tenantId],
        );
        const usedAgreements = Math.max(
          Number(usageRes.rows[0]?.recorded_created ?? 0),
          Number(usageRes.rows[0]?.actual_created ?? 0),
        );
        const maxAgreements = Number(activeSub.max_agreements_per_month);
        if (maxAgreements !== -1 && usedAgreements >= maxAgreements) {
          throw new ForbiddenException(
            `Monthly agreement limit (${maxAgreements}) reached for the ${activeSub.plan_name} plan. Please upgrade your subscription to create more agreements.`,
          );
        }
      }

      const year = new Date().getFullYear();
      const countRes = await client.query(
        `SELECT COUNT(*)::int as cnt FROM agreements WHERE tenant_id = $1`,
        [tenantId]
      );
      const seq = (countRes.rows[0].cnt + 1).toString().padStart(4, '0');
      const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
      const agreementNumber = `AGR-${year}-${seq}-${randomSuffix}`;

      const signMethod = dto.sign_method || 'basic_drawn';
      const initialStatus: AgreementStatusValue =
        dto.initial_status ||
        (signMethod === 'otp_verified' ? 'Awaiting OTP' : 'Awaiting signature');

      const feeAmount = Number(dto.fee_amount || 0);
      const recipientEmail = dto.recipient_email.trim().toLowerCase();
      const docHash = this.computeHash({
        agreement_number: agreementNumber,
        tenant_id: tenantId,
        recipient_email: recipientEmail,
        template_type: dto.template_type,
        content: dto.content,
        fee_amount: feeAmount,
      });

      const isSent = initialStatus !== 'Draft';
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const insRes = await client.query(
        `INSERT INTO agreements (
           agreement_number, tenant_id, created_by, recipient_name, recipient_email, recipient_phone,
           template_type, department, status, fee_amount, period, content, sign_method,
           document_hash, witness_required, witness_name, sent_at, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *;`,
        [
          agreementNumber,
          tenantId,
          user.id,
          dto.recipient_name.trim(),
          recipientEmail,
          (dto.recipient_phone || '').trim(),
          dto.template_type.trim(),
          dto.department.trim(),
          initialStatus,
          feeAmount,
          (dto.period || '12 months').trim(),
          dto.content,
          signMethod,
          docHash,
          Boolean(dto.witness_required),
          dto.witness_name || null,
          isSent ? new Date() : null,
          expiresAt,
        ]
      );

      const created = insRes.rows[0];

      await client.query(
        `INSERT INTO usage_records (tenant_id, period_start, period_end, agreements_created)
         VALUES (
           $1::uuid,
           date_trunc('month', NOW() AT TIME ZONE 'UTC')::date,
           (date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date,
           1
         )
         ON CONFLICT (tenant_id, period_start)
         DO UPDATE SET
           agreements_created = usage_records.agreements_created + 1,
           updated_at = NOW()`,
        [tenantId],
      );

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1, $2, $3, $4, $5, 'created', $6, $7);`,
        [
          tenantId,
          created.id,
          user.id,
          'Agreement drafted',
          `${dto.template_type} prepared by ${user.fullName || user.email}`,
          ip || null,
          docHash,
        ]
      );

      if (isSent) {
        await client.query(
          `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address)
           VALUES ($1, $2, $3, $4, $5, 'sent', $6);`,
          [
            tenantId,
            created.id,
            user.id,
            'Dispatched for signing',
            `Agreement sent to ${dto.recipient_name.trim()} (${recipientEmail})`,
            ip || null,
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'AGREEMENT_CREATED', 'AGREEMENT', $4, $5, $6, $7);`,
        [
          user.id,
          user.email,
          user.role || 'USER',
          created.id,
          tenantId,
          `Created ${agreementNumber} (${initialStatus})`,
          ip || null,
        ]
      );

      const evRes = await client.query(
        `SELECT * FROM agreement_events WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY created_at ASC`,
        [tenantId, created.id]
      );

      return this.mapRow(created, evRes.rows);
    });
  }

  async updateAgreement(tenantId: string, user: any, identifier: string, dto: UpdateAgreementDto, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      const existing = await this.findByIdentifier(client, tenantId, identifier);
      if (!existing) {
        throw new NotFoundException('Agreement not found.');
      }
      if (existing.status !== 'Draft') {
        throw new BadRequestException('Only Draft agreements can be edited.');
      }
      if (existing.created_by !== user.id && user.role !== 'Company Admin' && !user.isSuperAdmin) {
        throw new ForbiddenException('You do not have permission to edit this agreement.');
      }

      const nextRecipientEmail = (dto.recipient_email || existing.recipient_email).trim().toLowerCase();
      const nextTemplateType = (dto.template_type || existing.template_type).trim();
      const nextContent = dto.content ?? existing.content;
      const nextFeeAmount = dto.fee_amount !== undefined ? Number(dto.fee_amount) : Number(existing.fee_amount);

      const docHash = this.computeHash({
        agreement_number: existing.agreement_number,
        tenant_id: tenantId,
        recipient_email: nextRecipientEmail,
        template_type: nextTemplateType,
        content: nextContent,
        fee_amount: nextFeeAmount,
      });

      const updRes = await client.query(
        `UPDATE agreements
         SET recipient_name = $1,
             recipient_email = $2,
             recipient_phone = $3,
             template_type = $4,
             department = $5,
             fee_amount = $6,
             period = $7,
             content = $8,
             sign_method = $9,
             document_hash = $10,
             updated_at = NOW()
         WHERE tenant_id = $11 AND id = $12
         RETURNING *;`,
        [
          (dto.recipient_name || existing.recipient_name).trim(),
          nextRecipientEmail,
          (dto.recipient_phone ?? existing.recipient_phone).trim(),
          nextTemplateType,
          (dto.department || existing.department).trim(),
          nextFeeAmount,
          (dto.period || existing.period).trim(),
          nextContent,
          dto.sign_method || existing.sign_method,
          docHash,
          tenantId,
          existing.id,
        ]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'AGREEMENT_UPDATED', 'AGREEMENT', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', existing.id, tenantId, `Updated draft ${existing.agreement_number}`, ip || null]
      );

      const evRes = await client.query(
        `SELECT * FROM agreement_events WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY created_at ASC`,
        [tenantId, existing.id]
      );

      return this.mapRow(updRes.rows[0], evRes.rows);
    });
  }

  async transitionStatus(
    tenantId: string,
    user: any,
    identifier: string,
    dto: TransitionAgreementDto,
    ip?: string
  ) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      const existing = await this.findByIdentifier(client, tenantId, identifier);
      if (!existing) {
        throw new NotFoundException('Agreement not found.');
      }

      const currentStatus = existing.status as AgreementStatusValue;
      if (dto.status === 'Completed' || dto.status === 'Finalizing') {
        throw new ForbiddenException(
          'Agreements can only be marked Completed through the verified Signing Module.'
        );
      }
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Invalid state transition from '${currentStatus}' to '${dto.status}'.`
        );
      }

      const updRes = await client.query(
        `UPDATE agreements
         SET status = $1::varchar,
             signature_data_url = COALESCE($2, signature_data_url),
             sent_at = CASE WHEN $1::text IN ('Awaiting OTP', 'Awaiting signature') AND sent_at IS NULL THEN NOW() ELSE sent_at END,
             completed_at = CASE WHEN $1::text = 'Completed' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *;`,
        [dto.status, dto.signature_data_url || null, tenantId, existing.id]
      );

      const eventType =
        dto.status === 'Awaiting OTP' || dto.status === 'Awaiting signature'
          ? 'sent'
          : 'viewed';

      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
        [
          tenantId,
          existing.id,
          user.id,
          `Status changed to ${dto.status}`,
          dto.reason || `Transitioned from ${currentStatus} to ${dto.status} by ${user.fullName || user.email}`,
          eventType,
          ip || null,
          existing.document_hash,
        ]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'AGREEMENT_TRANSITION', 'AGREEMENT', $4, $5, $6, $7);`,
        [
          user.id,
          user.email,
          user.role || 'USER',
          existing.id,
          tenantId,
          `${existing.agreement_number}: ${currentStatus} -> ${dto.status}`,
          ip || null,
        ]
      );

      const evRes = await client.query(
        `SELECT * FROM agreement_events WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY created_at ASC`,
        [tenantId, existing.id]
      );

      return this.mapRow(updRes.rows[0], evRes.rows);
    });
  }

  async deleteDraft(tenantId: string, user: any, identifier: string, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      const existing = await this.findByIdentifier(client, tenantId, identifier);
      if (!existing) {
        throw new NotFoundException('Agreement not found.');
      }
      if (existing.status !== 'Draft') {
        throw new BadRequestException('Only Draft agreements can be deleted. Cancel active agreements instead.');
      }
      if (existing.created_by !== user.id && user.role !== 'Company Admin' && !user.isSuperAdmin) {
        throw new ForbiddenException('You do not have permission to delete this agreement.');
      }

      await client.query(`DELETE FROM agreements WHERE tenant_id = $1 AND id = $2`, [tenantId, existing.id]);

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'AGREEMENT_DELETED', 'AGREEMENT', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', existing.id, tenantId, `Deleted draft ${existing.agreement_number}`, ip || null]
      );

      return { success: true, deleted: existing.agreement_number };
    });
  }

  async remindAgreement(
    tenantId: string,
    user: any,
    identifier: string,
    originUrl: string,
    ip?: string,
  ) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    const eligibleStatuses = ['Awaiting OTP', 'Awaiting signature', 'Partially signed'];

    const context = await this.db.executeWithTenantContext(tenantId, async (client) => {
      const existing = await this.findByIdentifier(client, tenantId, identifier);
      if (!existing) {
        throw new NotFoundException('Agreement not found.');
      }
      if (!eligibleStatuses.includes(existing.status)) {
        throw new BadRequestException(
          `Cannot send reminder for agreement in '${existing.status}' status. Only pending signature agreements are eligible.`,
        );
      }

      // Check cooldown in Redis (15 minutes per agreement)
      if (this.redis) {
        const cooldownKey = `agreement:remind:cd:${tenantId}:${existing.id}`;
        const existingCooldown = await this.redis.get(cooldownKey).catch(() => null);
        if (existingCooldown) {
          throw new HttpException(
            'A reminder was already sent recently for this agreement. Please wait 15 minutes before sending another.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      // Find pending signatories if signing_recipients exist; otherwise fall back to primary agreement recipient
      const recRes = await client.query(
        `SELECT sr.id, sr.name, sr.email, sr.status, sr.token_expires_at
         FROM signing_recipients sr
         JOIN signing_requests sreq ON sreq.id = sr.signing_request_id
         WHERE sr.tenant_id = $1::uuid
           AND sr.agreement_id = $2::uuid
           AND sreq.status IN ('PENDING', 'IN_PROGRESS')
           AND sr.status IN ('PENDING', 'OTP_VERIFIED')
         ORDER BY sr.signing_order ASC`,
        [tenantId, existing.id],
      );

      const recipients: Array<{ name: string; email: string; expiresAtText?: string }> =
        recRes.rows.length > 0
          ? recRes.rows.map((r) => ({
              name: r.name,
              email: r.email,
              expiresAtText: r.token_expires_at ? new Date(r.token_expires_at).toUTCString() : undefined,
            }))
          : [
              {
                name: existing.recipient_name,
                email: existing.recipient_email,
              },
            ];

      return { agreement: existing, recipients };
    });

    const emailSvc = this.emailService ?? new EmailService(this.db, this.redis);
    const agreementTitle = `${context.agreement.template_type} (${context.agreement.department})`;
    const cleanOrigin = originUrl.replace(/\/+$/, '');
    const deliveryResults = [];

    for (const r of context.recipients) {
      const res = await emailSvc.sendNotification({
        template: 'agreement_sent',
        to: r.email,
        tenantId,
        payload: {
          recipientName: r.name,
          agreementTitle,
          agreementNumber: context.agreement.agreement_number,
          signingUrl: `${cleanOrigin}/`,
          expiresAtText: r.expiresAtText,
          isReminder: true,
        },
        safeMetadata: {
          agreement_id: context.agreement.id,
          agreement_number: context.agreement.agreement_number,
          reminder: true,
        },
      });
      deliveryResults.push({
        recipient_email: r.email,
        outbox_id: res.outboxId,
        delivered: res.delivered,
        status: res.deliveryStatus,
        retryable: res.retryable,
        error_code: res.errorCode,
      });
    }

    if (this.redis) {
      await this.redis
        .setex(`agreement:remind:cd:${tenantId}:${context.agreement.id}`, 900, '1')
        .catch(() => {});
    }

    await this.db.executeWithTenantContext(tenantId, async (client) => {
      await client.query(
        `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
         VALUES ($1, $2, $3, 'Reminder sent', $4, 'sent', $5, $6);`,
        [
          tenantId,
          context.agreement.id,
          user.id,
          `Signing reminder triggered for ${context.recipients.length} pending recipient(s) by ${user.fullName || user.email}`,
          ip || null,
          context.agreement.document_hash,
        ],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address, metadata)
         VALUES ($1, $2, $3, 'AGREEMENT_REMINDER_SENT', 'AGREEMENT', $4, $5, $6, $7, $8::jsonb);`,
        [
          user.id,
          user.email,
          user.role || 'USER',
          context.agreement.id,
          tenantId,
          `Reminder queued for ${context.agreement.agreement_number}`,
          ip || null,
          JSON.stringify({ recipients_count: context.recipients.length, delivery_results: deliveryResults }),
        ],
      );
    });

    return {
      success: true,
      agreement_id: context.agreement.agreement_number,
      recipients_notified: context.recipients.length,
      delivery_results: deliveryResults,
    };
  }
}
