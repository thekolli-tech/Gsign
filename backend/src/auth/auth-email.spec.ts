import { BadRequestException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import {
  cleanupSyntheticFixtures,
  createSyntheticTenantWithAdmin,
  verifySafeIntegrationTarget,
} from '../database/test-db-guard';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

describe('AuthService Email Workflows (Registration, Employee Invite, Password Reset OTP)', () => {
  let db: DatabaseService;
  let redis: RedisService;
  let adminClient: Client | null = null;
  let authService: AuthService;
  let tenantAId: string;
  let adminUser: any;

  const createdRegIds: string[] = [];
  const createdInviteEmails: string[] = [];
  const originalFetch = global.fetch;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;

  beforeAll(async () => {
    const { adminDbUrl } = await verifySafeIntegrationTarget();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '../.env'],
        }),
        DatabaseModule,
        RedisModule,
      ],
      providers: [AuthService, CryptoService, MfaService, SessionService],
    }).compile();

    db = module.get(DatabaseService);
    redis = module.get(RedisService);
    authService = module.get(AuthService);
    await db.onModuleInit();

    adminClient = new Client({ connectionString: adminDbUrl });
    await adminClient.connect();

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fxA = await createSyntheticTenantWithAdmin(adminClient, runId, 'email-a');
    tenantAId = fxA.tenantId;
    adminUser = fxA.user;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.RESEND_API_KEY = originalResendKey;
    process.env.EMAIL_FROM = originalEmailFrom;
  });

  afterAll(async () => {
    try {
      await cleanupSyntheticFixtures(adminClient, {
        registrationIds: createdRegIds,
        inviteEmails: createdInviteEmails,
        tenantIds: [tenantAId],
        userIds: [adminUser?.id],
      });
    } finally {
      if (adminClient) await adminClient.end().catch(() => {});
      if (db) await db.onModuleDestroy().catch(() => {});
      if (redis) await redis.onModuleDestroy().catch(() => {});
    }
  });

  it('Dispatches company registration verification email, employee invitation email, and password reset OTP using EMAIL_FROM', async () => {
    process.env.RESEND_API_KEY = 're_test_dummy_key';
    process.env.EMAIL_FROM = 'GSIGN Security <noreply@gsign.in>';

    const sentCalls: Array<{ to: string[]; from: string; subject: string; html: string }> = [];
    global.fetch = jest.fn(async (_url: any, init: any) => {
      sentCalls.push(JSON.parse(init.body));
      return { ok: true, status: 200 } as any;
    }) as any;

    // 1. Company registration verification email
    const ts = Date.now();
    const regEmail = `reg-email-${ts}@example.com`;
    const regRes: any = await authService.registerCompany({
      company_name: `Email Test Corp ${ts}`,
      display_name: `EmailTest ${ts}`,
      business_email: regEmail,
      business_phone: '+91 98765 00001',
      country: 'India',
      state: 'Karnataka',
      city: 'Bengaluru',
      address: '100 MG Road',
      admin_full_name: 'Reg Tester',
      admin_email: regEmail,
      password: 'StrongPassword@2026!',
      terms_accepted: true,
    } as any);
    createdRegIds.push(regRes.registration_id);
    expect(regRes.email_delivery.sent).toBe(true);
    expect(regRes.verification_token).toBeTruthy();

    // Verify single-use email verification token
    await authService.verifyEmail(regRes.verification_token);
    await expect(authService.verifyEmail(regRes.verification_token)).rejects.toThrow(
      BadRequestException,
    );

    // 2. Employee invitation email + single-use acceptance creating tenant membership & role
    const inviteEmail = `invitee-${ts}@example.com`;
    createdInviteEmails.push(inviteEmail);
    const invRes: any = await authService.inviteMember(adminUser, {
      email: inviteEmail,
      role_name: 'Legal Reviewer',
      department: 'Legal',
    } as any);
    expect(invRes.email_delivery.sent).toBe(true);
    expect(invRes.invitation_token).toBeTruthy();

    const acceptRes = await authService.acceptInvite({
      token: invRes.invitation_token,
      full_name: 'Invited Legal Reviewer',
      password: 'InvitePassword@2026!',
    } as any);
    expect(acceptRes.success).toBe(true);

    // Replay of single-use invitation token must fail
    await expect(
      authService.acceptInvite({
        token: invRes.invitation_token,
        full_name: 'Invited Legal Reviewer',
        password: 'InvitePassword@2026!',
      } as any),
    ).rejects.toThrow(BadRequestException);

    // Verify tenant_memberships & role created
    const membership = await db.executeWithTenantContext(tenantAId, async (client) => {
      const res = await client.query(
        `SELECT r.name AS role_name, tm.department, tm.status
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         JOIN roles r ON r.id = tm.role_id
         WHERE u.email = $1 AND tm.tenant_id = $2::uuid`,
        [inviteEmail, tenantAId],
      );
      return res.rows[0];
    });
    expect(membership.role_name).toBe('Legal Reviewer');
    expect(membership.department).toBe('Legal');
    expect(membership.status).toBe('Active');

    // 3. Password reset OTP email
    await authService.requestPasswordResetOtp(inviteEmail);
    await redis.del(`pwd_reset_otp:${inviteEmail}`);

    // Verify all 3 emails used the configured EMAIL_FROM sender
    expect(sentCalls.length).toBe(3);
    expect(sentCalls.every((c) => c.from === 'GSIGN Security <noreply@gsign.in>')).toBe(true);
    expect(sentCalls[0].to).toEqual([regEmail]);
    expect(sentCalls[1].to).toEqual([inviteEmail]);
    expect(sentCalls[2].to).toEqual([inviteEmail]);
  });

  it('Handles Resend email delivery failures gracefully without losing DB tokens', async () => {
    process.env.RESEND_API_KEY = 're_test_dummy_key';
    process.env.EMAIL_FROM = 'GSIGN Security <noreply@gsign.in>';

    global.fetch = jest.fn(async () => ({ ok: false, status: 502 })) as any;

    const ts = Date.now();
    const failEmail = `fail-invite-${ts}@example.com`;
    createdInviteEmails.push(failEmail);
    const invRes: any = await authService.inviteMember(adminUser, {
      email: failEmail,
      role_name: 'HR Manager',
      department: 'HR',
    } as any);

    expect(invRes.success).toBe(true);
    expect(invRes.email_delivery.sent).toBe(false);
    expect(invRes.email_delivery.error).toContain('HTTP 502');
    expect(invRes.invitation_token).toBeTruthy();
  });
});
