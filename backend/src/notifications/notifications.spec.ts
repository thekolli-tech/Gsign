import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AgreementsController } from '../agreements/agreements.controller';
import { AgreementsService } from '../agreements/agreements.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { EmailProviderAdapter, ResendEmailProvider } from './email-provider.adapter';
import { EmailService, sanitizeNotificationMetadata } from './email.service';
import { renderEmailTemplate } from './email-templates';

describe('NotificationsModule & Agreement Reminders (P5)', () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.NODE_ENV;
    delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    jest.restoreAllMocks();
  });

  it('delivers email via mocked provider and transitions outbox pending -> processing -> sent', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-1', status: 'pending', attempt_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] }) // processing
      .mockResolvedValueOnce({ rows: [] }); // sent
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query })),
    } as any;
    const provider: EmailProviderAdapter = {
      providerName: 'mock-resend',
      isConfigured: () => true,
      send: jest.fn().mockResolvedValue({
        delivered: true,
        status: 'sent',
        retryable: false,
        messageId: 'msg_123',
      }),
    };

    const svc = new EmailService(db, undefined, provider);
    const res = await svc.sendNotification({
      template: 'contact_sales_ack',
      to: 'LEAD@Acme.IN',
      payload: { recipientName: 'Lead', companyName: 'Acme', requestedPlan: 'Enterprise' },
      idempotencyKey: 'sales:1',
    });

    expect(res).toMatchObject({
      outboxId: 'outbox-1',
      queued: true,
      delivered: true,
      deliveryStatus: 'sent',
      attemptCount: 1,
      messageId: 'msg_123',
    });
    expect(query.mock.calls[1][0]).toContain("status = 'processing'");
    expect(query.mock.calls[2][1][1]).toBe('sent');
  });

  it('returns disabled in non-prod and failed in prod when RESEND_API_KEY is missing (no silent success)', async () => {
    const provider = new ResendEmailProvider();
    process.env.NODE_ENV = 'test';
    const devRes = await provider.send({
      to: 'user@acme.in',
      from: 'noreply@gsign.in',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    });
    expect(devRes.delivered).toBe(false);
    expect(devRes.status).toBe('disabled');

    process.env.NODE_ENV = 'production';
    const prodRes = await provider.send({
      to: 'user@acme.in',
      from: 'noreply@gsign.in',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    });
    expect(prodRes.delivered).toBe(false);
    expect(prodRes.status).toBe('failed');
    expect(prodRes.errorCode).toBe('MISSING_PROVIDER_CONFIG');
  });

  it('handles provider failure and schedules retry for retryable errors', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-2', status: 'pending', attempt_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query })),
    } as any;
    const redis = { setex: jest.fn().mockResolvedValue('OK') } as any;
    const provider: EmailProviderAdapter = {
      providerName: 'mock-resend',
      isConfigured: () => true,
      send: jest.fn().mockResolvedValue({
        delivered: false,
        status: 'failed',
        retryable: true,
        errorCode: 'RESEND_HTTP_503',
        errorMessage: 'Upstream unavailable',
      }),
    };

    const svc = new EmailService(db, redis, provider);
    const res = await svc.sendNotification({
      template: 'company_registration_ack',
      to: 'admin@acme.in',
      payload: { recipientName: 'Admin', companyName: 'Acme' },
    });

    expect(res.delivered).toBe(false);
    expect(res.deliveryStatus).toBe('failed');
    expect(res.retryable).toBe(true);
    expect(query.mock.calls[2][1][5]).toBeTruthy(); // next_retry_at scheduled
    expect(redis.setex).toHaveBeenCalledWith('notification:retry:outbox-2', 3600, '1');
  });

  it('suppresses duplicate notifications by idempotencyKey', async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'outbox-dup', status: 'sent', attempt_count: 1, provider_message_id: 'msg_1' }],
    });
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query })),
    } as any;
    const provider: EmailProviderAdapter = {
      providerName: 'mock-resend',
      isConfigured: () => true,
      send: jest.fn(),
    };

    const svc = new EmailService(db, undefined, provider);
    const res = await svc.sendNotification({
      template: 'contact_sales_ack',
      to: 'lead@acme.in',
      payload: { recipientName: 'Lead', companyName: 'Acme', requestedPlan: 'Enterprise' },
      idempotencyKey: 'dup-key-1',
    });

    expect(res.deduplicated).toBe(true);
    expect(res.deliveryStatus).toBe('deduplicated');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('never persists plaintext OTPs, tokens, or auth URLs in safe_metadata and renders all 10 templates safely', () => {
    const sanitized = sanitizeNotificationMetadata({
      agreement_number: 'AGR-1',
      otp: '123456',
      token: 'secret-tok',
      verifyUrl: 'https://gsign.in/?verify_token=secret',
      inviteUrl: 'https://gsign.in/?invite_token=secret',
      signingUrl: 'https://gsign.in/?signing_token=secret',
    });
    expect(sanitized).toEqual({ agreement_number: 'AGR-1' });

    const rendered = renderEmailTemplate('password_reset', {
      recipientName: '<script>alert(1)</script>',
      otp: '654321',
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('enforces tenant isolation, permissions, eligibility, cooldown, and audit events on agreement reminders', async () => {
    // 1. Guards on AgreementsController.remind
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, AgreementsController);
    expect(classGuards).toEqual([AuthGuard, SubscriptionGuard, PermissionsGuard]);

    // 2. Cross-tenant / missing agreement -> NotFoundException
    const notFoundDb = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (c: any) => Promise<any>) =>
        fn({ query: jest.fn().mockResolvedValue({ rows: [] }) }),
      ),
    } as any;
    await expect(
      new AgreementsService(notFoundDb).remindAgreement('tenant-1', { id: 'u1' }, 'AGR-999', 'https://gsign.in'),
    ).rejects.toThrow(NotFoundException);

    // 3. Ineligible status (Completed) -> BadRequestException
    const completedDb = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValueOnce({
            rows: [{ id: 'ag-1', agreement_number: 'AGR-1', status: 'Completed' }],
          }),
        }),
      ),
    } as any;
    await expect(
      new AgreementsService(completedDb).remindAgreement('tenant-1', { id: 'u1' }, 'AGR-1', 'https://gsign.in'),
    ).rejects.toThrow(BadRequestException);

    // 4. Cooldown active -> 429 TooManyRequests
    const activeDb = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValueOnce({
            rows: [{ id: 'ag-1', agreement_number: 'AGR-1', status: 'Awaiting signature' }],
          }),
        }),
      ),
    } as any;
    const cooldownRedis = { get: jest.fn().mockResolvedValue('1') } as any;
    await expect(
      new AgreementsService(activeDb, cooldownRedis).remindAgreement('tenant-1', { id: 'u1' }, 'AGR-1', 'https://gsign.in'),
    ).rejects.toThrow(HttpException);

    // 5. Eligible pending agreement -> queues reminder, writes agreement_events + audit_logs, returns accurate disabled status
    const agQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ag-1',
            agreement_number: 'AGR-1',
            status: 'Awaiting signature',
            template_type: 'NDA',
            department: 'Legal',
            recipient_name: 'Signer One',
            recipient_email: 'signer@client.in',
            document_hash: 'hash123',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // signing_recipients
      .mockResolvedValue({ rows: [] });
    const fullDb = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (c: any) => Promise<any>) =>
        fn({ query: agQuery }),
      ),
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValue({ rows: [{ id: 'outbox-rem-1', status: 'pending', attempt_count: 0 }] }),
        }),
      ),
    } as any;
    const okRedis = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK') } as any;
    const disabledProvider: EmailProviderAdapter = {
      providerName: 'resend',
      isConfigured: () => false,
      send: jest.fn().mockResolvedValue({
        delivered: false,
        status: 'disabled',
        retryable: false,
        errorCode: 'PROVIDER_DISABLED_NON_PROD',
      }),
    };
    const emailSvc = new EmailService(fullDb, okRedis, disabledProvider);

    const remRes = await new AgreementsService(fullDb, okRedis, emailSvc).remindAgreement(
      'tenant-1',
      { id: 'u1', email: 'admin@acme.in', role: 'Company Admin' },
      'AGR-1',
      'https://gsign.in',
      '127.0.0.1',
    );

    expect(remRes.recipients_notified).toBe(1);
    expect(remRes.delivery_results[0].delivered).toBe(false);
    expect(remRes.delivery_results[0].status).toBe('disabled');
    expect(agQuery.mock.calls.some((c) => String(c[0]).includes('INSERT INTO agreement_events'))).toBe(true);
    expect(agQuery.mock.calls.some((c) => String(c[0]).includes('AGREEMENT_REMINDER_SENT'))).toBe(true);
  });

  it('queries retryable failed outbox items safely within max_attempts', async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'outbox-r1', tenant_id: null, template_key: 'contact_sales_ack', recipient_email: 'a@b.in', attempt_count: 1, max_attempts: 3 }],
    });
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query })),
    } as any;
    const svc = new EmailService(db);
    const rows = await svc.findRetryableOutboxItems(10);
    expect(rows).toHaveLength(1);
    expect(query.mock.calls[0][0]).toContain("status = 'failed'");
    expect(query.mock.calls[0][0]).toContain('attempt_count < max_attempts');
  });

  it('processes retryable non-secret outbox items via processRetryableOutbox and skips items without retry_payload', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'outbox-r1',
            tenant_id: null,
            template_key: 'contact_sales_ack',
            recipient_email: 'a@b.in',
            attempt_count: 1,
            max_attempts: 3,
            safe_metadata: {
              retry_payload: { recipientName: 'A', companyName: 'B', requestedPlan: 'Enterprise' },
            },
          },
          {
            id: 'outbox-otp',
            tenant_id: null,
            template_key: 'password_reset',
            recipient_email: 'u@b.in',
            attempt_count: 1,
            max_attempts: 3,
            safe_metadata: {},
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query })),
    } as any;
    const provider: EmailProviderAdapter = {
      providerName: 'mock-resend',
      isConfigured: () => true,
      send: jest.fn().mockResolvedValue({ delivered: true, status: 'sent', retryable: false, messageId: 'msg_retry_1' }),
    };

    const svc = new EmailService(db, undefined, provider);
    const summary = await svc.processRetryableOutbox(10);
    expect(summary).toEqual({ processed: 2, sent: 1, failed: 1 });
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(query.mock.calls[0][0]).toContain("status IN ('pending', 'failed')");
    expect(query.mock.calls[0][0]).toContain("INTERVAL '5 minutes'");
    expect(provider.send).toHaveBeenCalledTimes(1);

    await svc.onModuleDestroy();
    const afterShutdown = await svc.processRetryableOutbox(10);
    expect(afterShutdown).toEqual({ processed: 0, sent: 0, failed: 0 });
  });

  it('encrypts sensitive OTP retry payloads with AES-256-GCM when NOTIFICATION_ENCRYPTION_KEY is set and disables retry without it', async () => {
    // 1. Without key: no plaintext OTP stored, retryable=false
    const qNoKey = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'outbox-no-key', status: 'pending', attempt_count: 0 }] })
      .mockResolvedValue({ rows: [] });
    const dbNoKey = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query: qNoKey })),
    } as any;
    const failProvider: EmailProviderAdapter = {
      providerName: 'mock-resend',
      isConfigured: () => true,
      send: jest.fn().mockResolvedValue({ delivered: false, status: 'failed', retryable: true, errorCode: 'RESEND_HTTP_503' }),
    };

    const resNoKey = await new EmailService(dbNoKey, undefined, failProvider).sendNotification({
      template: 'password_reset',
      to: 'user@acme.in',
      payload: { recipientName: 'User', otp: '987654' },
    });
    expect(resNoKey.retryable).toBe(false);
    expect(qNoKey.mock.calls[0][1][5]).not.toContain('987654');
    expect(qNoKey.mock.calls[0][1][5]).toContain('sensitive_retry_unconfigured');

    // 2. With 32-byte hex key: encrypted_retry_payload stored without plaintext OTP, and decrypted on retry
    process.env.NOTIFICATION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    let capturedMetaJson = '';
    const qWithKey = jest
      .fn()
      .mockImplementationOnce(async (_sql: string, params: any[]) => {
        capturedMetaJson = params[5];
        return { rows: [{ id: 'outbox-enc-1', status: 'pending', attempt_count: 0 }] };
      })
      .mockResolvedValue({ rows: [] });
    const dbWithKey = {
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query: qWithKey })),
    } as any;

    const encSvc = new EmailService(dbWithKey, undefined, failProvider);
    const resWithKey = await encSvc.sendNotification({
      template: 'password_reset',
      to: 'user@acme.in',
      payload: { recipientName: 'User', otp: '987654' },
    });
    expect(resWithKey.retryable).toBe(true);
    expect(capturedMetaJson).not.toContain('987654');
    const parsedMeta = JSON.parse(capturedMetaJson);
    expect(typeof parsedMeta.encrypted_retry_payload).toBe('string');

    // Simulate worker retry claiming the encrypted row and delivering it
    const qRetry = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'outbox-enc-1',
            tenant_id: null,
            template_key: 'password_reset',
            recipient_email: 'user@acme.in',
            attempt_count: 2,
            max_attempts: 3,
            safe_metadata: parsedMeta,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const okProvider: EmailProviderAdapter = {
      providerName: 'mock-resend',
      isConfigured: () => true,
      send: jest.fn().mockResolvedValue({ delivered: true, status: 'sent', retryable: false, messageId: 'msg_enc_ok' }),
    };
    const retrySvc = new EmailService(
      { executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) => fn({ query: qRetry })) } as any,
      undefined,
      okProvider,
    );
    const retrySummary = await retrySvc.processRetryableOutbox(5);
    expect(retrySummary).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect((okProvider.send as jest.Mock).mock.calls[0][0].text).toContain('987654');
  });
});
