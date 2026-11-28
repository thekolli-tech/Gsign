import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { EmailProviderAdapter, ResendEmailProvider } from './email-provider.adapter';
import {
  NotificationPayloadMap,
  NotificationTemplateKey,
  renderEmailTemplate,
} from './email-templates';

export interface SendNotificationInput<K extends NotificationTemplateKey = NotificationTemplateKey> {
  template: K;
  to: string;
  payload: NotificationPayloadMap[K];
  tenantId?: string | null;
  idempotencyKey?: string;
  safeMetadata?: Record<string, unknown>;
}

export interface NotificationDeliveryResult {
  outboxId: string | null;
  queued: boolean;
  delivered: boolean;
  deduplicated?: boolean;
  deliveryStatus: 'sent' | 'disabled' | 'failed' | 'deduplicated';
  retryable: boolean;
  attemptCount: number;
  messageId?: string;
  errorCode?: string;
}

const SENSITIVE_KEY_PATTERN = /(otp|token|secret|password|authorization|verifyurl|inviteurl|signingurl)/i;
const SENSITIVE_TEMPLATES = new Set<NotificationTemplateKey>([
  'email_verification',
  'password_reset',
  'employee_invitation',
  'agreement_sent',
  'signing_otp',
]);

export function sanitizeNotificationMetadata(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) continue;
    clean[k] = v;
  }
  return clean;
}

@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private readonly provider: EmailProviderAdapter;
  private retryTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private activeSweepPromise: Promise<unknown> | null = null;

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly redis?: RedisService,
    @Optional() providerOverride?: EmailProviderAdapter,
  ) {
    this.provider = providerOverride ?? new ResendEmailProvider();
  }

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test' && process.env.ENABLE_OUTBOX_WORKER !== 'false' && this.db) {
      this.retryTimer = setInterval(() => {
        if (this.isShuttingDown || this.activeSweepPromise) return;
        this.activeSweepPromise = this.processRetryableOutbox(20)
          .catch((err) => {
            this.logger.warn(`Outbox retry sweep error: ${(err as Error)?.message || 'unknown'}`);
          })
          .finally(() => {
            this.activeSweepPromise = null;
          });
      }, 60_000);
      if (typeof this.retryTimer.unref === 'function') {
        this.retryTimer.unref();
      }
    }
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.activeSweepPromise) {
      await this.activeSweepPromise.catch(() => {});
    }
  }

  private getSenderAddress(): string {
    return process.env.EMAIL_FROM?.trim() || 'GSIGN Security <noreply@gsign.in>';
  }

  private getOutboxEncryptionKey(): Buffer | null {
    const raw = process.env.NOTIFICATION_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    const b64 = Buffer.from(raw, 'base64');
    return b64.length === 32 ? b64 : null;
  }

  private encryptSensitiveRetryPayload(payload: unknown, ttlSeconds: number): string | null {
    const key = this.getOutboxEncryptionKey();
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const envelope = JSON.stringify({
      payload,
      exp: Date.now() + ttlSeconds * 1000,
    });
    const encrypted = Buffer.concat([cipher.update(envelope, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decryptSensitiveRetryPayload(token: string): Record<string, unknown> | null {
    const key = this.getOutboxEncryptionKey();
    if (!key || !token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const iv = Buffer.from(parts[0], 'base64url');
      const tag = Buffer.from(parts[1], 'base64url');
      const data = Buffer.from(parts[2], 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(plain);
      if (!parsed.exp || parsed.exp < Date.now()) return null;
      return parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
    } catch {
      return null;
    }
  }

  async sendNotification<K extends NotificationTemplateKey>(
    input: SendNotificationInput<K>,
  ): Promise<NotificationDeliveryResult> {
    const recipient = input.to.trim().toLowerCase();
    const rendered = renderEmailTemplate(input.template, input.payload);
    const safeMeta = sanitizeNotificationMetadata(input.safeMetadata);
    if (!SENSITIVE_TEMPLATES.has(input.template)) {
      safeMeta.retry_payload = sanitizeNotificationMetadata(input.payload as unknown as Record<string, unknown>);
    } else {
      const ttl = input.template === 'password_reset' || input.template === 'signing_otp' ? 600 : 86400;
      const encrypted = this.encryptSensitiveRetryPayload(input.payload, ttl);
      if (encrypted) {
        safeMeta.encrypted_retry_payload = encrypted;
      } else {
        safeMeta.sensitive_retry_unconfigured = true;
      }
    }
    const idempotencyKey = input.idempotencyKey?.trim() || null;

    let outboxId: string | null = null;
    let attemptCount = 0;

    // 1. Persist durable outbox record (never storing OTPs, tokens, or auth URLs)
    if (this.db) {
      const outboxState = await this.db.executeAsSuperAdmin(async (client) => {
        if (idempotencyKey) {
          const existingRes = await client.query(
            `SELECT id, status, attempt_count, provider_message_id, last_error_code
             FROM notification_outbox
             WHERE idempotency_key = $1
             LIMIT 1`,
            [idempotencyKey],
          );
          if (existingRes.rows.length > 0) {
            const existing = existingRes.rows[0];
            if (existing.status === 'sent' || existing.status === 'processing') {
              return { deduplicated: true, row: existing };
            }
            return { deduplicated: false, row: existing };
          }
        }

        const insertRes = await client.query(
          `INSERT INTO notification_outbox (
             tenant_id, template_key, recipient_email, subject, idempotency_key,
             status, attempt_count, safe_metadata
           ) VALUES ($1, $2, $3, $4, $5, 'pending', 0, $6::jsonb)
           RETURNING id, status, attempt_count`,
          [
            input.tenantId || null,
            input.template,
            recipient,
            rendered.subject,
            idempotencyKey,
            JSON.stringify(safeMeta),
          ],
        );
        return { deduplicated: false, row: insertRes.rows[0] };
      });

      if (outboxState.deduplicated) {
        return {
          outboxId: outboxState.row.id,
          queued: false,
          delivered: outboxState.row.status === 'sent',
          deduplicated: true,
          deliveryStatus: 'deduplicated',
          retryable: false,
          attemptCount: Number(outboxState.row.attempt_count || 0),
          messageId: outboxState.row.provider_message_id || undefined,
        };
      }

      outboxId = outboxState.row.id;
      attemptCount = Number(outboxState.row.attempt_count || 0) + 1;

      await this.db.executeAsSuperAdmin(async (client) => {
        await client.query(
          `UPDATE notification_outbox
           SET status = 'processing', attempt_count = $2, updated_at = NOW()
           WHERE id = $1::uuid`,
          [outboxId, attemptCount],
        );
      });
    } else {
      attemptCount = 1;
    }

    // 2. Deliver via configured provider (never log OTPs, links, or API keys)
    const outcome = await this.provider.send({
      to: recipient,
      from: this.getSenderAddress(),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (outcome.status === 'failed') {
      this.logger.warn(
        `Notification delivery failed (template=${input.template}, code=${outcome.errorCode || 'UNKNOWN'})`,
      );
    }

    // 3. Update outbox status & bounded exponential backoff retry schedule
    const canRetryInWorker =
      !SENSITIVE_TEMPLATES.has(input.template) || Boolean(safeMeta.encrypted_retry_payload);
    const effectiveRetryable = outcome.retryable && canRetryInWorker;
    if (this.db && outboxId) {
      const backoffSeconds = Math.min(3600, Math.pow(2, Math.max(0, attemptCount - 1)) * 60);
      const nextRetryAt =
        outcome.status === 'failed' && effectiveRetryable && attemptCount < 3
          ? new Date(Date.now() + backoffSeconds * 1000).toISOString()
          : null;

      await this.db.executeAsSuperAdmin(async (client) => {
        await client.query(
          `UPDATE notification_outbox
           SET status = $2,
               sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
               provider_message_id = COALESCE($3, provider_message_id),
               last_error_code = $4,
               last_error_message = $5,
               next_retry_at = $6::timestamptz,
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [
            outboxId,
            outcome.status,
            outcome.messageId || null,
            outcome.errorCode || null,
            outcome.errorMessage || null,
            nextRetryAt,
          ],
        );
      });
    }

    // Optional Redis queue notification marker for observability
    if (this.redis && outboxId && outcome.status === 'failed' && outcome.retryable) {
      await this.redis.setex(`notification:retry:${outboxId}`, 3600, String(attemptCount)).catch(() => {});
    }

    return {
      outboxId,
      queued: Boolean(outboxId),
      delivered: outcome.delivered,
      deliveryStatus: outcome.status,
      retryable: effectiveRetryable,
      attemptCount,
      messageId: outcome.messageId,
      errorCode: outcome.errorCode,
    };
  }

  async findRetryableOutboxItems(limit = 20): Promise<
    Array<{
      id: string;
      tenant_id: string | null;
      template_key: string;
      recipient_email: string;
      attempt_count: number;
      max_attempts: number;
      safe_metadata?: Record<string, unknown>;
    }>
  > {
    if (!this.db) return [];
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT id, tenant_id, template_key, recipient_email, attempt_count, max_attempts, safe_metadata
         FROM notification_outbox
         WHERE status = 'failed'
           AND attempt_count < max_attempts
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY created_at ASC
         LIMIT $1`,
        [safeLimit],
      );
      return res.rows;
    });
  }

  async processRetryableOutbox(limit = 20): Promise<{ processed: number; sent: number; failed: number }> {
    if (!this.db || this.isShuttingDown) {
      return { processed: 0, sent: 0, failed: 0 };
    }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

    // Atomically claim pending, retryable failed, or stale crashed-processing rows via FOR UPDATE SKIP LOCKED
    const items = await this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `WITH claimed AS (
           SELECT id
           FROM notification_outbox
           WHERE (
             (
               status IN ('pending', 'failed')
               AND attempt_count < max_attempts
               AND (next_retry_at IS NULL OR next_retry_at <= NOW())
             )
             OR (
               status = 'processing'
               AND updated_at < NOW() - INTERVAL '5 minutes'
               AND attempt_count < max_attempts
             )
           )
           ORDER BY next_retry_at ASC NULLS FIRST, created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE notification_outbox o
         SET status = 'processing',
             attempt_count = o.attempt_count + 1,
             updated_at = NOW()
         FROM claimed
         WHERE o.id = claimed.id
         RETURNING o.id, o.tenant_id, o.template_key, o.recipient_email, o.attempt_count, o.max_attempts, o.safe_metadata`,
        [safeLimit],
      );
      return res.rows;
    });

    let sent = 0;
    let failed = 0;

    for (const item of items) {
      const meta = (item.safe_metadata || {}) as Record<string, any>;
      let retryPayload: Record<string, unknown> | null = null;
      if (SENSITIVE_TEMPLATES.has(item.template_key)) {
        if (typeof meta.encrypted_retry_payload === 'string') {
          retryPayload = this.decryptSensitiveRetryPayload(meta.encrypted_retry_payload);
        }
      } else if (meta.retry_payload && typeof meta.retry_payload === 'object') {
        retryPayload = meta.retry_payload;
      }

      if (!retryPayload) {
        await this.db.executeAsSuperAdmin(async (client) => {
          await client.query(
            `UPDATE notification_outbox
             SET status = 'failed',
                 next_retry_at = NULL,
                 last_error_code = COALESCE(last_error_code, 'RETRY_PAYLOAD_UNAVAILABLE'),
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [item.id],
          );
        });
        failed += 1;
        continue;
      }

      const rendered = renderEmailTemplate(item.template_key as NotificationTemplateKey, retryPayload as any);
      const currentAttempt = Number(item.attempt_count || 1);
      const outcome = await this.provider.send({
        to: item.recipient_email,
        from: this.getSenderAddress(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      if (outcome.delivered) sent += 1;
      else failed += 1;

      const backoffSeconds = Math.min(3600, Math.pow(2, Math.max(0, currentAttempt - 1)) * 60);
      const nextRetryAt =
        outcome.status === 'failed' && outcome.retryable && currentAttempt < Number(item.max_attempts || 3)
          ? new Date(Date.now() + backoffSeconds * 1000).toISOString()
          : null;

      await this.db.executeAsSuperAdmin(async (client) => {
        await client.query(
          `UPDATE notification_outbox
           SET status = $2,
               sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
               provider_message_id = COALESCE($3, provider_message_id),
               last_error_code = $4,
               last_error_message = $5,
               next_retry_at = $6::timestamptz,
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [
            item.id,
            outcome.status,
            outcome.messageId || null,
            outcome.errorCode || null,
            outcome.errorMessage || null,
            nextRetryAt,
          ],
        );
      });
    }

    return { processed: items.length, sent, failed };
  }
}
