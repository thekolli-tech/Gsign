import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { createCheckoutAccessToken } from './checkout-token.util';
import { InitiateCheckoutDto } from './dto/checkout.dto';
import { ManualPendingPaymentAdapter, SimulatedDevPaymentAdapter } from './payment-provider.adapter';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AuthService } from '../auth/auth.service';
import { CompleteCompanySetupDto } from '../auth/dto/complete-company-setup.dto';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';

describe('PaymentsService & SubscriptionsService — P4 Security Reconciliation (Mocked DB)', () => {
  const regId = '11111111-1111-4111-8111-111111111111';
  const otherRegId = '99999999-9999-4999-8999-999999999999';
  const planId = '22222222-2222-4222-8222-222222222222';
  const tenantId = '33333333-3333-4333-8333-333333333333';
  const validToken = createCheckoutAccessToken(regId, 'admin@acme.in');

  function createService(queryImpl: jest.Mock) {
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query: queryImpl })),
    } as any;
    const redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    } as any;
    return { service: new PaymentsService(db, redis), db, query: queryImpl };
  }

  it('rejects missing, invalid, expired, or cross-registration checkout access tokens', async () => {
    const expiredToken = createCheckoutAccessToken(regId, 'admin@acme.in', -10);
    const wrongRegToken = createCheckoutAccessToken(otherRegId, 'admin@acme.in');

    await expect(
      createService(jest.fn()).service.initiateRegistrationCheckout({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'monthly',
        admin_email: 'admin@acme.in',
        checkout_access_token: 'tampered.token',
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      createService(jest.fn()).service.initiateRegistrationCheckout({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'monthly',
        admin_email: 'admin@acme.in',
        checkout_access_token: expiredToken,
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      createService(jest.fn()).service.initiateRegistrationCheckout({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'monthly',
        admin_email: 'admin@acme.in',
        checkout_access_token: wrongRegToken,
      }),
    ).rejects.toThrow(ForbiddenException);

    // Checkout reference enumeration resistance: valid token for otherRegId cannot read regId's checkout
    const enumQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'pay-1', registration_id: regId, checkout_reference: 'CHK-2026-SECRET', admin_email: 'admin@acme.in', business_email: 'biz@acme.in' }],
    });
    await expect(
      createService(enumQuery).service.getCheckoutStatus({
        checkout_reference: 'CHK-2026-SECRET',
        admin_email: 'admin@acme.in',
        checkout_access_token: wrongRegToken,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects invalid registration, inactive plan, and unauthorized registration access', async () => {
    const missingReg = jest.fn().mockResolvedValueOnce({ rows: [] });
    await expect(
      createService(missingReg).service.initiateRegistrationCheckout({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'monthly',
        admin_email: 'admin@acme.in',
        checkout_access_token: validToken,
      }),
    ).rejects.toThrow(NotFoundException);

    const inactivePlan = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: regId, admin_email: 'admin@acme.in', business_email: 'biz@acme.in', status: 'PAYMENT_PENDING', tenant_id: tenantId }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: planId, name: 'Legacy', slug: 'legacy', monthly_price: 499, annual_price: 4990, is_active: false }],
      });
    await expect(
      createService(inactivePlan).service.initiateRegistrationCheckout({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'monthly',
        admin_email: 'admin@acme.in',
        checkout_access_token: validToken,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('strips frontend-supplied prices via ValidationPipe and calculates amount strictly server-side in PAYMENT_PENDING state', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const dto = await pipe.transform(
      {
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'annual',
        admin_email: 'admin@acme.in',
        checkout_access_token: validToken,
        amount: 1,
        price: 0,
      },
      { type: 'body', metatype: InitiateCheckoutDto },
    );
    expect((dto as any).amount).toBeUndefined();
    expect((dto as any).price).toBeUndefined();

    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: regId, admin_email: 'admin@acme.in', business_email: 'biz@acme.in', status: 'PAYMENT_PENDING', tenant_id: tenantId }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: planId, name: 'Business Plan', slug: 'business', monthly_price: 1499, annual_price: 14990, is_active: true }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sub-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'pay-1', checkout_reference: 'CHK-2026-1234', status: 'PAYMENT_PENDING', amount: '14990.00', currency: 'INR', provider: 'SIMULATED' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await createService(query).service.initiateRegistrationCheckout(dto);
    expect(res.status).toBe('PAYMENT_PENDING');
    expect(res.subscription_status).toBe('PAYMENT_PENDING');
    expect(res.amount).toBe(14990);
    expect(query.mock.calls.some((c) => String(c[0]).includes("status = 'ACTIVE'"))).toBe(false);
  });

  it('prevents duplicate checkout records on idempotent replay', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: regId, admin_email: 'admin@acme.in', business_email: 'biz@acme.in', status: 'PAYMENT_PENDING', tenant_id: tenantId }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: planId, name: 'Starter Plan', slug: 'starter', monthly_price: 499, annual_price: 4990, is_active: true }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'pay-existing',
            checkout_reference: 'CHK-2026-EXISTING',
            status: 'PAYMENT_PENDING',
            amount: '499.00',
            currency: 'INR',
            provider: 'SIMULATED',
            metadata: { billing_cycle: 'monthly', plan_name: 'Starter Plan', mode: 'simulated_dev' },
          },
        ],
      });

    const res = await createService(query).service.initiateRegistrationCheckout({
      registration_id: regId,
      plan_id: planId,
      billing_cycle: 'monthly',
      admin_email: 'admin@acme.in',
      checkout_access_token: validToken,
      idempotency_key: 'idem-key-1',
    });

    expect(res.idempotent_replay).toBe(true);
    expect(res.checkout_reference).toBe('CHK-2026-EXISTING');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('validates payment state transitions and blocks invalid transitions', async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'pay-1', registration_id: regId, status: 'PAYMENT_COMPLETED', tenant_id: tenantId, admin_email: 'admin@acme.in', business_email: 'biz@acme.in' }],
    });
    await expect(
      createService(query).service.transitionCheckoutState('CHK-1', {
        admin_email: 'admin@acme.in',
        checkout_access_token: validToken,
        status: 'PAYMENT_CANCELLED',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('handles signed webhook confirmation with FOR UPDATE, duplicate replay, and amount/currency mismatch', async () => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret';
    const payload = {
      checkout_reference: 'CHK-2026-999',
      provider_transaction_id: 'gw_tx_1',
      amount: 1499,
      currency: 'INR',
      status: 'PAYMENT_COMPLETED' as const,
    };
    const raw = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 'test-webhook-secret').update(raw).digest('hex');

    await expect(
      createService(jest.fn()).service.handleVerifiedWebhook(payload, raw, 'bad-sig'),
    ).rejects.toThrow(UnauthorizedException);

    const mismatchQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'pay-1', tenant_id: tenantId, amount: '1499.00', currency: 'INR', status: 'PAYMENT_PENDING', metadata: {} }],
    });
    await expect(
      createService(mismatchQuery).service.handleVerifiedWebhook(
        { ...payload, amount: 1 },
        JSON.stringify({ ...payload, amount: 1 }),
        crypto.createHmac('sha256', 'test-webhook-secret').update(JSON.stringify({ ...payload, amount: 1 })).digest('hex'),
      ),
    ).rejects.toThrow(/mismatch/);

    const replayQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'pay-1', tenant_id: tenantId, amount: '1499.00', currency: 'INR', status: 'PAYMENT_COMPLETED', metadata: {} }],
    });
    const replayRes = await createService(replayQuery).service.handleVerifiedWebhook(payload, raw, sig);
    expect(replayRes.already_completed).toBe(true);

    // Provider transaction ID replay across a different checkout_reference -> ConflictException
    const txReplayQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'pay-2', tenant_id: tenantId, amount: '1499.00', currency: 'INR', status: 'PAYMENT_PENDING', metadata: {} }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'pay-1' }] });
    await expect(
      createService(txReplayQuery).service.handleVerifiedWebhook(payload, raw, sig),
    ).rejects.toThrow(/already been applied/);

    // Concurrent race caught by PostgreSQL unique index violation (23505) -> ConflictException
    const uniqueViolationQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'pay-3', tenant_id: tenantId, amount: '1499.00', currency: 'INR', status: 'PAYMENT_PENDING', metadata: {} }],
      })
      .mockResolvedValueOnce({ rows: [] }) // txReplayRes passed race
      .mockResolvedValueOnce({ rows: [{ company_name: 'Acme', recipient_email: 'admin@acme.in', recipient_name: 'Admin' }] })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    await expect(
      createService(uniqueViolationQuery).service.handleVerifiedWebhook(payload, raw, sig),
    ).rejects.toThrow(/already been applied/);

    const activateQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'pay-1',
            tenant_id: tenantId,
            subscription_id: 'sub-1',
            registration_id: regId,
            amount: '1499.00',
            currency: 'INR',
            status: 'PAYMENT_PENDING',
            metadata: { billing_cycle: 'monthly' },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // txReplayRes (no duplicate provider_transaction_id)
      .mockResolvedValueOnce({ rows: [{ company_name: 'Acme', recipient_email: 'admin@acme.in', recipient_name: 'Admin' }] }) // contactRes
      .mockResolvedValue({ rows: [] });
    const actRes = await createService(activateQuery).service.handleVerifiedWebhook(payload, raw, sig);
    expect(actRes.status).toBe('PAYMENT_COMPLETED');
    expect(actRes.already_completed).toBe(false);
    expect(activateQuery.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(activateQuery.mock.calls.some((c) => String(c[0]).includes('PAYMENT_WEBHOOK_COMPLETED'))).toBe(true);
  });

  it('enforces idempotency, registration sync, and audit trail in manual activation without faking gateway payment', async () => {
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
      .mockResolvedValueOnce({ rows: [] }) // SELECT existingSub FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'sub-1' }] }) // upsert tenant_subscriptions
      .mockResolvedValueOnce({ rows: [] }) // update tenants
      .mockResolvedValueOnce({ rows: [{ id: regId }] }) // update company_registrations
      .mockResolvedValueOnce({ rows: [{ checkout_reference: 'CHK-2026-1' }] }) // annotate payments metadata
      .mockResolvedValueOnce({ rows: [] }) // insert audit_logs
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const release = jest.fn();
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: tenantId, name: 'Acme' }] })
        .mockResolvedValueOnce({ rows: [{ id: planId, name: 'Starter Plan', monthly_price: 499 }] }),
      getPool: jest.fn(() => ({ connect: jest.fn().mockResolvedValue({ query: clientQuery, release }) })),
    } as any;

    const subSvc = new SubscriptionsService(db);
    const res = await subSvc.activateManual(
      { id: 'owner-1', email: 'owner@gsign.in', isPlatformOwner: true, role: 'PLATFORM_OWNER' },
      { tenant_id: tenantId, plan_id: planId, billing_cycle: 'monthly', reason: 'Verified NEFT transfer' },
    );

    expect(res.status).toBe('ACTIVE');
    expect(res.already_active).toBe(false);
    // Ensure unpaid checkout was NOT marked PAYMENT_COMPLETED
    expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('PAYMENT_COMPLETED'))).toBe(false);
    expect(clientQuery.mock.calls.some((c) => String(c[0]).includes('SUBSCRIPTION_MANUAL_ACTIVATION'))).toBe(true);

    // Duplicate manual activation returns idempotent already_active: true
    const dupClientQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SET LOCAL
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'sub-1',
            plan_id: planId,
            billing_cycle: 'monthly',
            status: 'ACTIVE',
            current_period_end: new Date(Date.now() + 86400000).toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const dbDup = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: tenantId, name: 'Acme' }] })
        .mockResolvedValueOnce({ rows: [{ id: planId, name: 'Starter Plan', monthly_price: 499 }] }),
      getPool: jest.fn(() => ({ connect: jest.fn().mockResolvedValue({ query: dupClientQuery, release: jest.fn() }) })),
    } as any;
    const dupRes = await new SubscriptionsService(dbDup).activateManual(
      { id: 'owner-1', email: 'owner@gsign.in', isPlatformOwner: true, role: 'PLATFORM_OWNER' },
      { tenant_id: tenantId, plan_id: planId, billing_cycle: 'monthly', reason: 'Duplicate click' },
    );
    expect(dupRes.already_active).toBe(true);
  });

  it('separates simulated dev adapter from production manual-pending adapter', async () => {
    const dev = new SimulatedDevPaymentAdapter();
    const prod = new ManualPendingPaymentAdapter();
    expect(dev.isSimulated).toBe(true);
    expect(prod.isSimulated).toBe(false);
    const devInit = await dev.createCheckoutSession({ checkoutReference: 'CHK-1' });
    const prodInit = await prod.createCheckoutSession({ checkoutReference: 'CHK-1' });
    expect(devInit.mode).toBe('simulated_dev');
    expect(prodInit.mode).toBe('manual_pending');
  });

  it('rejects enterprise, inactive, and unknown plans in completeCompanySetup before provisioning tenant or subscription', async () => {
    const connectSpy = jest.fn();
    const makeAuthService = (queryMock: jest.Mock) =>
      new AuthService(
        { query: queryMock, getPool: () => ({ connect: connectSpy }) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

    // 1. Enterprise plan rejected before connect()
    const entQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: regId, status: 'EMAIL_VERIFIED' }] })
      .mockResolvedValueOnce({ rows: [{ id: planId, name: 'Enterprise Plan', slug: 'enterprise' }] });
    await expect(
      makeAuthService(entQuery).completeCompanySetup({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'monthly',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(connectSpy).not.toHaveBeenCalled();

    // 2. Inactive or unknown plan rejected before connect()
    const missingPlanQuery = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: regId, status: 'EMAIL_VERIFIED' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      makeAuthService(missingPlanQuery).completeCompanySetup({
        registration_id: regId,
        plan_id: planId,
        billing_cycle: 'annual',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid billing_cycle on CompleteCompanySetupDto and InitiateCheckoutDto via ValidationPipe', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(
      pipe.transform(
        { registration_id: regId, plan_id: planId, billing_cycle: 'weekly' },
        { type: 'body', metatype: CompleteCompanySetupDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      pipe.transform(
        {
          registration_id: regId,
          plan_id: planId,
          billing_cycle: 'lifetime',
          admin_email: 'admin@acme.in',
          checkout_access_token: validToken,
        },
        { type: 'body', metatype: InitiateCheckoutDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deduplicates repeated checkout initiation with same idempotency_key and rejects non-Platform-Owner guard access', async () => {
    const idempQuery = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: regId, admin_email: 'admin@acme.in', business_email: 'biz@acme.in', status: 'PAYMENT_PENDING', tenant_id: tenantId }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: planId, name: 'Business Plan', slug: 'business', monthly_price: 1499, annual_price: 14990, is_active: true }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'pay-existing',
          checkout_reference: 'CHK-IDEMP-1',
          status: 'PAYMENT_PENDING',
          amount: 14990,
          currency: 'INR',
          provider: 'SIMULATED',
        }],
      });

    const { service } = createService(idempQuery);
    const res = await service.initiateRegistrationCheckout({
      registration_id: regId,
      plan_id: planId,
      billing_cycle: 'annual',
      admin_email: 'admin@acme.in',
      checkout_access_token: validToken,
      idempotency_key: 'idem-key-1',
    });

    expect(res.checkout_reference).toBe('CHK-IDEMP-1');
    expect(Number(res.amount)).toBe(14990);
    expect(idempQuery.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO payments'))).toBe(false);

    // Non-Platform-Owner employee rejected by PlatformOwnerGuard
    const guard = new PlatformOwnerGuard();
    const ctx: any = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'emp-1', isPlatformOwner: false, role: 'Company Staff' } }),
      }),
    };
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
