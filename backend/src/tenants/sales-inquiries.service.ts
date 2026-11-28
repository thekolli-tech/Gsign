import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../notifications/email.service';
import {
  CreateSalesInquiryDto,
  SALES_INQUIRY_STATUSES,
  UpdateSalesInquiryDto,
} from './dto/sales-inquiry.dto';

@Injectable()
export class SalesInquiriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  private async enforcePublicRateLimit(ip: string): Promise<void> {
    const safeIp = (ip || 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '');
    const key = `sales_inquiry:rl:${safeIp}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, 900); // 15 minutes
      }
      if (count > 5) {
        throw new HttpException(
          'Too many inquiries submitted. Please wait 15 minutes before trying again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Fail open only if Redis is unavailable in local dev
    }
  }

  async submitPublicInquiry(dto: CreateSalesInquiryDto, ip?: string) {
    await this.enforcePublicRateLimit(ip || 'unknown');

    const contactName = dto.contact_name.trim();
    const companyName = dto.company_name.trim();
    const normalizedEmail = dto.business_email.trim().toLowerCase();
    const phoneNumber = dto.phone_number?.trim() || null;
    const companySize = dto.company_size.trim();
    const requestedPlan = dto.requested_plan?.trim() || 'Enterprise';
    const monthlyAgreements = dto.monthly_agreements?.trim() || null;
    const message = dto.message?.trim() || null;

    const dedupHash = crypto
      .createHash('sha256')
      .update(`${normalizedEmail}|${companyName.toLowerCase()}|${requestedPlan.toLowerCase()}`)
      .digest('hex');

    await this.db.executeAsSuperAdmin(async (client) => {
      const recentDup = await client.query(
        `SELECT id
         FROM sales_inquiries
         WHERE dedup_hash = $1
           AND created_at >= NOW() - INTERVAL '15 minutes'
         LIMIT 1`,
        [dedupHash],
      );
      if (recentDup.rows.length > 0) {
        return;
      }

      await client.query(
        `INSERT INTO sales_inquiries (
           contact_name, company_name, business_email, phone_number,
           company_size, requested_plan, monthly_agreements, message,
           status, dedup_hash, source_ip
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           'new', $9, $10
         )`,
        [
          contactName,
          companyName,
          normalizedEmail,
          phoneNumber,
          companySize,
          requestedPlan,
          monthlyAgreements,
          message,
          dedupHash,
          ip || null,
        ],
      );
    });

    if (this.emailService) {
      await this.emailService
        .sendNotification({
          template: 'contact_sales_ack',
          to: normalizedEmail,
          idempotencyKey: `contact_sales:${dedupHash}`,
          payload: {
            recipientName: contactName,
            companyName,
            requestedPlan,
          },
          safeMetadata: { requested_plan: requestedPlan, company_size: companySize },
        })
        .catch(() => {});
    }

    // Generic public acknowledgement; never expose internal IDs, notes, or admin metadata
    return {
      success: true,
      message: 'Thank you. Your enterprise inquiry has been received and our solutions team will contact you shortly.',
    };
  }

  async listInquiries(params: {
    page?: number;
    limit?: number;
    status?: string;
    from?: string;
    to?: string;
  }) {
    const safePage = Math.max(1, Number(params.page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const offset = (safePage - 1) * safeLimit;

    const conditions: string[] = [];
    const values: any[] = [];

    if (params.status && params.status !== 'all') {
      if (!(SALES_INQUIRY_STATUSES as readonly string[]).includes(params.status)) {
        throw new BadRequestException(`Invalid inquiry status filter: ${params.status}`);
      }
      values.push(params.status);
      conditions.push(`status = $${values.length}`);
    }

    if (params.from) {
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(params.from.trim())
        ? new Date(`${params.from.trim()}T00:00:00.000Z`)
        : new Date(params.from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('Invalid "from" date filter.');
      }
      values.push(fromDate.toISOString());
      conditions.push(`created_at >= $${values.length}::timestamptz`);
    }

    if (params.to) {
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(params.to.trim())
        ? new Date(`${params.to.trim()}T23:59:59.999Z`)
        : new Date(params.to);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException('Invalid "to" date filter.');
      }
      values.push(toDate.toISOString());
      conditions.push(`created_at <= $${values.length}::timestamptz`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return this.db.executeAsSuperAdmin(async (client) => {
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS total FROM sales_inquiries ${whereClause}`,
        values,
      );
      const total = Number(countRes.rows[0]?.total ?? 0);

      const listRes = await client.query(
        `SELECT id, contact_name, company_name, business_email, phone_number,
                company_size, requested_plan, monthly_agreements, message,
                status, assigned_to, assigned_to_email, internal_notes,
                created_at, updated_at
         FROM sales_inquiries
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, safeLimit, offset],
      );

      return {
        items: listRes.rows,
        total,
        page: safePage,
        limit: safeLimit,
      };
    });
  }

  async getInquiry(id: string) {
    return this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT id, contact_name, company_name, business_email, phone_number,
                company_size, requested_plan, monthly_agreements, message,
                status, assigned_to, assigned_to_email, internal_notes,
                created_at, updated_at
         FROM sales_inquiries
         WHERE id = $1::uuid
         LIMIT 1`,
        [id],
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('Sales inquiry not found.');
      }
      return res.rows[0];
    });
  }

  async updateInquiry(
    id: string,
    dto: UpdateSalesInquiryDto,
    actor: { id: string; email?: string; role?: string },
    ip?: string,
  ) {
    return this.db.executeAsSuperAdmin(async (client) => {
      const existingRes = await client.query(
        `SELECT id, status, assigned_to_email FROM sales_inquiries WHERE id = $1::uuid LIMIT 1`,
        [id],
      );
      if (existingRes.rows.length === 0) {
        throw new NotFoundException('Sales inquiry not found.');
      }
      const existing = existingRes.rows[0];

      const nextStatus = dto.status ?? existing.status;
      const nextAssignedTo = dto.assigned_to !== undefined ? dto.assigned_to : undefined;
      const nextAssignedEmail =
        dto.assigned_to_email !== undefined ? dto.assigned_to_email.trim().toLowerCase() : undefined;

      const updRes = await client.query(
        `UPDATE sales_inquiries
         SET status = $2,
             assigned_to = COALESCE($3::uuid, assigned_to),
             assigned_to_email = COALESCE($4, assigned_to_email),
             internal_notes = COALESCE($5, internal_notes),
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING id, contact_name, company_name, business_email, phone_number,
                   company_size, requested_plan, monthly_agreements, message,
                   status, assigned_to, assigned_to_email, internal_notes,
                   created_at, updated_at`,
        [
          id,
          nextStatus,
          nextAssignedTo ?? null,
          nextAssignedEmail ?? null,
          dto.internal_notes !== undefined ? dto.internal_notes : null,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, reason, ip_address, metadata)
         VALUES ($1::uuid, $2, $3, 'SALES_INQUIRY_UPDATED', 'sales_inquiry', $4, $5, $6, $7::jsonb)`,
        [
          actor.id,
          actor.email || 'owner@gsign.in',
          actor.role || 'PLATFORM_OWNER',
          id,
          `Updated inquiry status to ${nextStatus}`,
          ip || null,
          JSON.stringify({
            previous_status: existing.status,
            new_status: nextStatus,
            assigned_to_email: nextAssignedEmail ?? existing.assigned_to_email,
            notes_updated: dto.internal_notes !== undefined,
          }),
        ],
      );

      return updRes.rows[0];
    });
  }
}
