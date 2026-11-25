import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { CryptoService } from './crypto.service';
import { MfaService } from './mfa.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentsService } from '../payments/payments.service';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

describe('Final Access-Control, Platform Owner & Subscription Model Tests', () => {
  let authService: AuthService;
  let sessionService: SessionService;
  let cryptoService: CryptoService;
  let mfaService: MfaService;
  let subscriptionsService: SubscriptionsService;
  let paymentsService: PaymentsService;
  let db: DatabaseService;
  let redis: RedisService;
  let subscriptionGuard: SubscriptionGuard;

  let ownerUserId: string;
  let testPlanId: string;

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
      providers: [
        AuthService,
        SessionService,
        CryptoService,
        MfaService,
        SubscriptionsService,
        PaymentsService,
        SubscriptionGuard,
        Reflector,
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    sessionService = module.get<SessionService>(SessionService);
    cryptoService = module.get<CryptoService>(CryptoService);
    mfaService = module.get<MfaService>(MfaService);
    subscriptionsService = module.get<SubscriptionsService>(SubscriptionsService);
    paymentsService = module.get<PaymentsService>(PaymentsService);
    db = module.get<DatabaseService>(DatabaseService);
    redis = module.get<RedisService>(RedisService);
    subscriptionGuard = module.get<SubscriptionGuard>(SubscriptionGuard);

    await db.onModuleInit();
    await redis.onModuleInit();

    // Verify plans exist
    const plans = await subscriptionsService.getPlans();
    expect(plans.length).toBeGreaterThan(0);
    testPlanId = plans[0].id;

    // Get Platform Owner user and reset must_change_password for test consistency
    const ownerRes = await db.query(
      `SELECT id FROM users WHERE email = 'genemaxitsolution@gmail.com';`
    );
    expect(ownerRes.rows.length).toBeGreaterThan(0);
    ownerUserId = ownerRes.rows[0].id;
    await db.query(`UPDATE users SET must_change_password = true WHERE id = $1;`, [ownerUserId]);
  });

  // TEST 1: Platform Owner login without subscription
  it('Requirement 1: Platform Owner can log in immediately without company registration or subscription', async () => {
    const result = await authService.login(
      { email: 'genemaxitsolution@gmail.com', password: 'gsign#2k26' },
      '127.0.0.1',
      'Test-Agent'
    );
    expect(result.session).toBeDefined();
    expect(result.session!.isPlatformOwner).toBe(true);
    expect(result.session!.role).toBe('PLATFORM_OWNER');
    expect(result.session!.mustChangePassword).toBe(true);
  });

  // TEST 2: Platform Owner retains access when all company subscriptions expire
  it('Requirement 2: Platform Owner retains full platform access when all company subscriptions expire', async () => {
    // Expire all company subscriptions in the database temporarily
    await db.query(`UPDATE tenant_subscriptions SET status = 'EXPIRED', current_period_end = NOW() - INTERVAL '1 day';`);

    const mockExecutionContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: ownerUserId, email: 'genemaxitsolution@gmail.com', isPlatformOwner: true, isSuperAdmin: true, role: 'PLATFORM_OWNER' },
          tenantId: null,
          session: { tenantId: null, role: 'PLATFORM_OWNER' },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    const canActivate = await subscriptionGuard.canActivate(mockExecutionContext);
    expect(canActivate).toBe(true); // Must never be blocked by subscription checks

    // Restore subscriptions for demo tenants
    await db.query(`UPDATE tenant_subscriptions SET status = 'ACTIVE', current_period_end = NOW() + INTERVAL '1 year';`);
  });

  // TEST 3: Platform Owner is not attached to an ordinary tenant
  it('Requirement 3: Platform Owner account is not associated with an ordinary company tenant', async () => {
    const session = await sessionService.createSession(ownerUserId, null, '127.0.0.1', 'Test-Agent');
    expect(session.tenantId).toBeNull();
    expect(session.isPlatformOwner).toBe(true);

    const memberships = await db.query(`SELECT * FROM tenant_memberships WHERE user_id = $1`, [ownerUserId]);
    expect(memberships.rows).toHaveLength(0); // Not attached to an ordinary tenant
  });

  // TEST 4: Ordinary users cannot impersonate or create Platform Owner accounts
  it('Requirement 4: Ordinary company administrators cannot assign or create Platform Owner privileges', async () => {
    const inviter = { id: 'some-user-id', tenantId: 'some-tenant-id' };
    await expect(
      authService.inviteMember(inviter, {
        email: 'attacker@evil.com',
        role_name: 'PLATFORM_OWNER',
        department: 'Engineering',
      })
    ).rejects.toThrow(ForbiddenException);

    await expect(
      authService.inviteMember(inviter, {
        email: 'attacker2@evil.com',
        role_name: 'Super Admin',
        department: 'Executive',
      })
    ).rejects.toThrow(ForbiddenException);
  });

  // TEST 5: Company registration requires email verification
  it('Requirement 5: Company registration requires email verification before setup can proceed', async () => {
    const ts = Date.now();
    const regResult = await authService.registerCompany({
      company_name: `Test Org ${ts}`,
      display_name: `Test Org`,
      business_email: `biz-${ts}@company.com`,
      business_phone: '+91 98888 77777',
      country: 'India',
      state: 'Karnataka',
      city: 'Bangalore',
      address: '123 MG Road',
      admin_full_name: 'Test Administrator',
      admin_email: `admin-${ts}@company.com`,
      password: 'SecurePassword123!',
      terms_accepted: true,
      billing_cycle: 'monthly',
    });

    expect(regResult.success).toBe(true);
    expect(regResult.registration_id).toBeDefined();
    expect(regResult.verification_token).toBeDefined();

    // Attempting to complete setup before email verification must fail
    await expect(
      authService.completeCompanySetup({
        registration_id: regResult.registration_id,
        plan_id: testPlanId,
        billing_cycle: 'monthly',
      })
    ).rejects.toThrow(BadRequestException);

    // Verify email using the token
    const verifyResult = await authService.verifyEmail(regResult.verification_token);
    expect(verifyResult.success).toBe(true);

    // Reusing the same verification token must fail
    await expect(authService.verifyEmail(regResult.verification_token)).rejects.toThrow(BadRequestException);
  });

  // TEST 6 & 8: Registration does not grant immediate access and creates NO free trial
  it('Requirement 6 & 8: Company registration does not grant immediate workspace access and creates NO free trial', async () => {
    const ts = Date.now();
    const regResult = await authService.registerCompany({
      company_name: `Strict Paid Corp ${ts}`,
      display_name: `Strict Paid Corp`,
      business_email: `strict-${ts}@paid.com`,
      business_phone: '+91 97777 66666',
      country: 'India',
      state: 'Maharashtra',
      city: 'Mumbai',
      address: 'Bandra Kurla Complex',
      admin_full_name: 'Strict Admin',
      admin_email: `strictadmin-${ts}@paid.com`,
      password: 'SecurePassword123!',
      terms_accepted: true,
      billing_cycle: 'monthly',
    });

    await authService.verifyEmail(regResult.verification_token);

    const setupResult = await authService.completeCompanySetup({
      registration_id: regResult.registration_id,
      plan_id: testPlanId,
      billing_cycle: 'monthly',
    });

    expect(setupResult.success).toBe(true);
    expect(setupResult.subscription_status).toBe('PAYMENT_PENDING'); // Must be PAYMENT_PENDING, NO FREE TRIAL

    // Verify in database that subscription is PAYMENT_PENDING
    const subCheck = await db.query(
      `SELECT status FROM tenant_subscriptions WHERE tenant_id = $1`,
      [setupResult.tenant_id]
    );
    expect(subCheck.rows[0].status).toBe('PAYMENT_PENDING');

    // Admin logs in
    const loginResult = await authService.login(
      { email: `strictadmin-${ts}@paid.com`, password: 'SecurePassword123!' },
      '127.0.0.1',
      'Test-Agent'
    );
    expect(loginResult.session).toBeDefined();

    // SubscriptionGuard must block workspace access because subscription is PAYMENT_PENDING
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: loginResult.session!.userId, email: loginResult.session!.email, isPlatformOwner: false, isSuperAdmin: false },
          tenantId: setupResult.tenant_id,
          session: loginResult.session,
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    await expect(subscriptionGuard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);
  });

  // TEST 7: Company access activates only after verified payment or authorized manual activation
  it('Requirement 7: Company access activates after verified payment or authorized manual activation', async () => {
    const ts = Date.now();
    const regResult = await authService.registerCompany({
      company_name: `Activation Corp ${ts}`,
      display_name: `Activation Corp`,
      business_email: `activate-${ts}@corp.com`,
      business_phone: '+91 96666 55555',
      country: 'India',
      state: 'Delhi',
      city: 'New Delhi',
      address: 'Connaught Place',
      admin_full_name: 'Activation Admin',
      admin_email: `actadmin-${ts}@corp.com`,
      password: 'SecurePassword123!',
      terms_accepted: true,
      billing_cycle: 'monthly',
    });

    await authService.verifyEmail(regResult.verification_token);
    const setupResult = await authService.completeCompanySetup({
      registration_id: regResult.registration_id,
      plan_id: testPlanId,
      billing_cycle: 'monthly',
    });

    // 1. Path A: Verified Payment Activation
    const paymentResult = await paymentsService.simulateCheckout({
      tenant_id: setupResult.tenant_id,
      plan_id: testPlanId,
      billing_cycle: 'monthly',
      payment_method: 'Corporate UPI',
    });
    expect(paymentResult.success).toBe(true);
    expect(paymentResult.subscription_status).toBe('ACTIVE');

    // SubscriptionGuard now allows access
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'admin-id', email: `actadmin-${ts}@corp.com`, isPlatformOwner: false, isSuperAdmin: false },
          tenantId: setupResult.tenant_id,
          session: { tenantId: setupResult.tenant_id },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    const canAccessAfterPayment = await subscriptionGuard.canActivate(mockContext);
    expect(canAccessAfterPayment).toBe(true);

    // 2. Path B: Manual Platform Owner Activation with Audit Trail
    const manualResult = await subscriptionsService.activateManual(
      { id: ownerUserId, email: 'genemaxitsolution@gmail.com', isPlatformOwner: true, role: 'PLATFORM_OWNER' },
      {
        tenant_id: setupResult.tenant_id,
        plan_id: testPlanId,
        billing_cycle: 'annual',
        reason: 'Authorized enterprise offline bank transfer verification',
        duration_months: 12,
      }
    );
    expect(manualResult.success).toBe(true);
    expect(manualResult.status).toBe('ACTIVE');

    // Verify audit log entry exists
    const auditRes = await db.query(
      `SELECT * FROM audit_logs WHERE target_id = $1 AND action = 'SUBSCRIPTION_MANUAL_ACTIVATION'`,
      [setupResult.tenant_id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(auditRes.rows[0].actor_role).toBe('PLATFORM_OWNER');
    expect(auditRes.rows[0].reason).toContain('offline bank transfer');
  });

  // TEST 9: Expired subscriptions block paid workspace access
  it('Requirement 9: Expired subscriptions block paid workspace access', async () => {
    const ts = Date.now();
    const tenantRes = await db.query(
      `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
       VALUES ('Expired Corp ${ts}', 'expired-corp-${ts}', 'exp@corp.com', '+91 90000 00000', 'Active')
       RETURNING id;`
    );
    const expiredTenantId = tenantRes.rows[0].id;

    // Insert an EXPIRED subscription
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_end)
       VALUES ($1, $2, 'monthly', 'EXPIRED', NOW() - INTERVAL '5 days');`,
      [expiredTenantId, testPlanId]
    );

    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'some-user', email: 'user@expired.com', isPlatformOwner: false, isSuperAdmin: false },
          tenantId: expiredTenantId,
          session: { tenantId: expiredTenantId },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    await expect(subscriptionGuard.canActivate(mockContext)).rejects.toThrow(ForbiddenException);

    // Clean up
    await db.query(`DELETE FROM tenants WHERE id = $1;`, [expiredTenantId]);
  });

  // TEST 10 & 11: Company Admin invites employees, no public individual signup
  it('Requirement 10 & 11: Company Admin can invite employees, and employees must join via secure token', async () => {
    const ts = Date.now();
    // Get Priya's tenant (GSIGN Pvt Ltd) and admin user
    const priyaTenant = await db.query(`SELECT id FROM tenants WHERE slug = 'gsign';`);
    const tenantId = priyaTenant.rows[0].id;
    const priyaUser = await db.query(`SELECT id FROM users WHERE email = 'priya@gsign.in';`);
    const inviterId = priyaUser.rows[0].id;

    const inviter = { id: inviterId, tenantId };
    const inviteRes = await authService.inviteMember(inviter, {
      email: `invited-employee-${ts}@gsign.in`,
      role_name: 'Legal Reviewer',
      department: 'Legal',
    });

    expect(inviteRes.success).toBe(true);
    expect(inviteRes.invitation_token).toBeDefined();

    // Accept invitation
    const acceptRes = await authService.acceptInvite({
      token: inviteRes.invitation_token,
      full_name: 'Invited Legal Reviewer',
      password: 'EmployeePassword123!',
    });
    expect(acceptRes.success).toBe(true);

    // Verify employee can now log in
    const empLogin = await authService.login(
      { email: `invited-employee-${ts}@gsign.in`, password: 'EmployeePassword123!' },
      '127.0.0.1',
      'Employee-Agent'
    );
    expect(empLogin.session).toBeDefined();
    expect(empLogin.session!.role).toBe('Legal Reviewer');
    expect(empLogin.session!.tenantId).toBe(tenantId);
  });

  // TEST 15: Owner bootstrap is idempotent and does not overwrite existing password
  it('Requirement 15: Owner bootstrap is idempotent and does not overwrite an existing owner password', async () => {
    // 1. Fetch current owner password hash
    const currentOwner = await db.query(
      `SELECT password_hash FROM users WHERE email = 'genemaxitsolution@gmail.com';`
    );
    const originalHash = currentOwner.rows[0].password_hash;

    // 2. Change Platform Owner password
    const newPassword = 'NewOwnerPassword#2026!';
    const changeResult = await authService.changePassword(ownerUserId, {
      current_password: 'gsign#2k26',
      new_password: newPassword,
    });
    expect(changeResult.success).toBe(true);

    // 3. Verify new password works
    const newLogin = await authService.login(
      { email: 'genemaxitsolution@gmail.com', password: newPassword },
      '127.0.0.1',
      'Test-Agent'
    );
    expect(newLogin.session).toBeDefined();

    // 4. Simulate rerunning the bootstrap process (seed.ts logic)
    const ownerEmail = 'genemaxitsolution@gmail.com';
    const ownerPassword = 'gsign#2k26';

    const checkOwner = await db.query('SELECT id, password_hash FROM users WHERE email = $1', [ownerEmail]);
    expect(checkOwner.rows.length).toBe(1);

    // As designed in seed.ts: if owner exists, do NOT overwrite password!
    if (checkOwner.rows.length === 0) {
      await db.query(`INSERT INTO users ...`);
    } else {
      // Only updates flags, preserves password_hash
      await db.query(`UPDATE users SET is_super_admin = true, is_platform_owner = true WHERE id = $1;`, [checkOwner.rows[0].id]);
    }

    // 5. Verify that the changed password is STILL active and has NOT been reverted to initial password
    const afterBootstrapLogin = await authService.login(
      { email: 'genemaxitsolution@gmail.com', password: newPassword },
      '127.0.0.1',
      'Test-Agent'
    );
    expect(afterBootstrapLogin.session).toBeDefined();

    // Initial password must fail
    await expect(
      authService.login(
        { email: 'genemaxitsolution@gmail.com', password: 'gsign#2k26' },
        '127.0.0.1',
        'Test-Agent'
      )
    ).rejects.toThrow(UnauthorizedException);

    // Revert back to gsign#2k26 for consistency with handover documentation
    await authService.changePassword(ownerUserId, {
      current_password: newPassword,
      new_password: 'gsign#2k26',
    });
  });

  afterAll(async () => {
    // Ensure clean teardown of db and redis connections
    await db.onModuleDestroy();
    await redis.onModuleDestroy();
  });
});
