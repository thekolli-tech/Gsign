import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { AgreementsService } from '../agreements/agreements.service';
import { SigningService } from './signing.service';

describe('SigningService, OTP, Sequential/Concurrent Signing & RLS Isolation', () => {
  let db: DatabaseService;
  let redis: RedisService;
  let agreementsService: AgreementsService;
  let signingService: SigningService;
  let tenantAId: string;
  let tenantBId: string;
  let userA: any;
  const createdAgreementUuids: string[] = [];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '../.env'],
        }),
        DatabaseModule,
        RedisModule,
      ],
      providers: [AgreementsService, SigningService],
    }).compile();

    db = module.get<DatabaseService>(DatabaseService);
    redis = module.get<RedisService>(RedisService);
    agreementsService = module.get<AgreementsService>(AgreementsService);
    signingService = module.get<SigningService>(SigningService);
    await db.onModuleInit();

    const tenantsRes = await db.query(
      `SELECT id, slug FROM tenants WHERE slug IN ('gsign', 'acme') ORDER BY slug ASC`,
    );
    tenantAId = tenantsRes.rows.find((t) => t.slug === 'gsign').id;
    tenantBId = tenantsRes.rows.find((t) => t.slug === 'acme').id;

    const uARes = await db.query(
      `SELECT id, email, full_name FROM users WHERE email = 'priya@gsign.in' LIMIT 1`,
    );
    userA = { ...uARes.rows[0], fullName: uARes.rows[0].full_name, role: 'Company Admin' };
  });

  afterAll(async () => {
    for (const uuid of createdAgreementUuids) {
      await db.executeAsSuperAdmin(async (client) => {
        await client.query(`DELETE FROM agreements WHERE id = $1::uuid`, [uuid]);
      });
    }
    await db.onModuleDestroy();
    await redis.onModuleDestroy();
  });

  async function setKnownOtpForRecipient(recipientId: string, otp: string, expired = false) {
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    await db.executeWithTenantContext(tenantAId, async (client) => {
      await client.query(
        `UPDATE signing_otp_attempts SET consumed_at = NOW() WHERE recipient_id = $1::uuid AND consumed_at IS NULL`,
        [recipientId],
      );
      await client.query(
        `INSERT INTO signing_otp_attempts (tenant_id, recipient_id, otp_hash, attempts, max_attempts, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::varchar, 0, 5, ${expired ? "NOW() - INTERVAL '1 minute'" : "NOW() + INTERVAL '10 minutes'"})`,
        [tenantAId, recipientId, otpHash],
      );
    });
  }

  it('Enforces invalid token rejection, OTP attempt limits/expiry, sequential signing, completion rule, replay & RLS isolation', async () => {
    const draft = await agreementsService.createAgreement(tenantAId, userA, {
      recipient_name: 'Alice Signer',
      recipient_email: 'alice@example.com',
      template_type: 'NDA',
      department: 'Legal',
      fee_amount: 0,
      period: '12 months',
      content: 'Sequential multi-party NDA content.',
      sign_method: 'basic_drawn',
      initial_status: 'Draft',
    });
    createdAgreementUuids.push(draft.uuid);

    const createdReq = await signingService.createSigningRequest(
      tenantAId,
      userA,
      {
        agreement_id: draft.uuid,
        sequential: true,
        expires_in_hours: 48,
        recipients: [
          { name: 'Alice Signer', email: 'alice@example.com', signing_order: 1, is_required: true },
          { name: 'Bob Signer', email: 'bob@example.com', signing_order: 2, is_required: true },
        ],
      },
      'https://gsign01.vercel.app',
      '127.0.0.1',
    );

    const rec1 = createdReq.recipients[0];
    const rec2 = createdReq.recipients[1];
    expect(rec1.signing_token).toBeTruthy();
    expect(rec2.signing_token).toBeTruthy();

    // Invalid token rejected
    await expect(signingService.getPortalByToken('invalid-nonexistent-token-123456')).rejects.toThrow(
      NotFoundException,
    );

    // Recipient 2 blocked by sequential order
    const portal2Before = await signingService.getPortalByToken(rec2.signing_token);
    expect(portal2Before.portal_status).toBe('WAITING_PREDECESSOR');
    await expect(signingService.requestOtp(rec2.signing_token, '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    );

    // Recipient 1 cannot sign before OTP verification
    await expect(
      signingService.submitSignature(rec1.signing_token, {
        signature_data_url: 'data:image/png;base64,AAA',
        consent_accepted: true,
        consent_text: 'I agree to sign electronically.',
      }),
    ).rejects.toThrow(ForbiddenException);

    // Request OTP (and test cooldown)
    await redis.del(`signing:otp:cooldown:${rec1.id}`);
    const otpResp = await signingService.requestOtp(rec1.signing_token, '127.0.0.1');
    expect(otpResp.expires_in_seconds).toBe(600);
    await expect(signingService.requestOtp(rec1.signing_token, '127.0.0.1')).rejects.toThrow(
      BadRequestException,
    );

    // Expired OTP fails
    await setKnownOtpForRecipient(rec1.id, '111222', true);
    await expect(signingService.verifyOtp(rec1.signing_token, '111222')).rejects.toThrow(
      BadRequestException,
    );

    // Attempt limit check (5 wrong attempts)
    await setKnownOtpForRecipient(rec1.id, '654321', false);
    for (let i = 0; i < 5; i += 1) {
      await expect(signingService.verifyOtp(rec1.signing_token, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    }
    await expect(signingService.verifyOtp(rec1.signing_token, '654321')).rejects.toThrow(
      BadRequestException,
    );

    // Valid OTP verification
    await setKnownOtpForRecipient(rec1.id, '654321', false);
    const verified1 = await signingService.verifyOtp(rec1.signing_token, '654321', '127.0.0.1');
    expect(verified1.verified).toBe(true);

    // Concurrent signature submissions for rec1: only 1 succeeds, other throws ConflictException
    const [rA, rB] = await Promise.allSettled([
      signingService.submitSignature(
        rec1.signing_token,
        {
          signature_data_url: 'data:image/png;base64,SIG1',
          consent_accepted: true,
          consent_text: 'I consent to electronic execution.',
        },
        '127.0.0.1',
        'JestTest',
      ),
      signingService.submitSignature(
        rec1.signing_token,
        {
          signature_data_url: 'data:image/png;base64,SIG1_DUP',
          consent_accepted: true,
          consent_text: 'I consent to electronic execution.',
        },
        '127.0.0.1',
        'JestTest',
      ),
    ]);
    const fulfilled = [rA, rB].filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = [rA, rB].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(fulfilled[0].value.agreement_completed).toBe(false);
    expect(fulfilled[0].value.agreement_status).toBe('Partially signed');

    // Token replay after signing shows ALREADY_SIGNED and rejects resubmission
    const portal1After = await signingService.getPortalByToken(rec1.signing_token);
    expect(portal1After.portal_status).toBe('ALREADY_SIGNED');

    // Now Recipient 2 is unlocked
    const portal2Now = await signingService.getPortalByToken(rec2.signing_token);
    expect(portal2Now.portal_status).toBe('OTP_REQUIRED');

    await setKnownOtpForRecipient(rec2.id, '987654', false);
    await signingService.verifyOtp(rec2.signing_token, '987654', '127.0.0.1');

    const finalSign = await signingService.submitSignature(
      rec2.signing_token,
      {
        signature_data_url: 'data:image/png;base64,SIG2',
        consent_accepted: true,
        consent_text: 'I consent to electronic execution.',
      },
      '127.0.0.1',
      'JestTest',
    );
    expect(finalSign.agreement_completed).toBe(true);
    expect(finalSign.agreement_status).toBe('Completed');

    // Verify Tenant B cannot see Tenant A's signing requests (RLS isolation)
    const tenantBView = await signingService.listRequestsForAgreement(tenantBId, draft.uuid);
    expect(tenantBView.requests.length).toBe(0);
    expect(tenantBView.recipients.length).toBe(0);

    // Verify audit & agreement_events integrity
    const eventsAndAudit = await db.executeWithTenantContext(tenantAId, async (client) => {
      const ev = await client.query(
        `SELECT title, event_type FROM agreement_events WHERE agreement_id = $1::uuid ORDER BY created_at ASC`,
        [draft.uuid],
      );
      const aud = await client.query(
        `SELECT action FROM audit_logs WHERE tenant_id = $1::uuid AND target_id = $2::varchar ORDER BY created_at ASC`,
        [tenantAId, draft.uuid],
      );
      return { events: ev.rows, audits: aud.rows };
    });
    expect(eventsAndAudit.events.some((e) => e.title === 'Agreement Completed')).toBe(true);
    expect(eventsAndAudit.audits.some((a) => a.action === 'RECIPIENT_SIGNED')).toBe(true);
    expect(eventsAndAudit.audits.some((a) => a.action === 'AGREEMENT_COMPLETED')).toBe(true);
  });

  it('Blocks signing on rejected and revoked signing requests', async () => {
    const draft = await agreementsService.createAgreement(tenantAId, userA, {
      recipient_name: 'Reject Signer',
      recipient_email: 'reject@example.com',
      template_type: 'MSA',
      department: 'Sales',
      fee_amount: 1000,
      period: '12 months',
      content: 'MSA content.',
      sign_method: 'basic_drawn',
      initial_status: 'Draft',
    });
    createdAgreementUuids.push(draft.uuid);

    const req1 = await signingService.createSigningRequest(
      tenantAId,
      userA,
      {
        agreement_id: draft.uuid,
        sequential: true,
        recipients: [{ name: 'Reject Signer', email: 'reject@example.com' }],
      },
      'https://gsign01.vercel.app',
    );
    const token1 = req1.recipients[0].signing_token;

    // Revoking invalidates token
    await signingService.revokeSigningRequest(tenantAId, userA, req1.signing_request.id);
    const portalRevoked = await signingService.getPortalByToken(token1);
    expect(portalRevoked.portal_status).toBe('REVOKED');
    await expect(signingService.requestOtp(token1)).rejects.toThrow(BadRequestException);

    // Create new request and reject it
    const req2 = await signingService.createSigningRequest(
      tenantAId,
      userA,
      {
        agreement_id: draft.uuid,
        sequential: true,
        recipients: [{ name: 'Reject Signer', email: 'reject@example.com' }],
      },
      'https://gsign01.vercel.app',
    );
    const rec2 = req2.recipients[0];
    await setKnownOtpForRecipient(rec2.id, '555666', false);
    await signingService.verifyOtp(rec2.signing_token, '555666');

    const rej = await signingService.rejectSigning(rec2.signing_token, { reason: 'Disagree with clause 4' });
    expect(rej.rejected).toBe(true);
    expect(rej.agreement_status).toBe('Rejected');

    await expect(
      signingService.submitSignature(rec2.signing_token, {
        signature_data_url: 'data:image/png;base64,AFTER_REJECT',
        consent_accepted: true,
        consent_text: 'Consent',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
