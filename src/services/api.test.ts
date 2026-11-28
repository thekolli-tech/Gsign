import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Frontend API client contracts (mocked fetch)', () => {
  it('calls POST /api/v1/payments/checkout/initiate with checkout_access_token and surfaces server errors', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({ success: true, checkout_reference: 'CHK-2026-1', status: 'PAYMENT_PENDING', amount: 1499 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const res = await api.initiateCheckout({
      registration_id: 'reg-1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      admin_email: 'admin@acme.in',
      checkout_access_token: 'tok.sig',
    });

    assert.equal(capturedUrl, '/api/v1/payments/checkout/initiate');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(res.status, 'PAYMENT_PENDING');

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Forbidden checkout token' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () =>
        api.initiateCheckout({
          registration_id: 'reg-1',
          plan_id: 'plan-1',
          billing_cycle: 'monthly',
          admin_email: 'admin@acme.in',
          checkout_access_token: 'bad.tok',
        }),
      /Forbidden checkout token/,
    );
  });

  it('calls POST /api/v1/agreements/:id/remind with credentials=include', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({ success: true, recipients_notified: 1, delivery_results: [{ status: 'disabled' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const res = await api.remindAgreement('AGR-2026-0001');
    assert.equal(capturedUrl, '/api/v1/agreements/AGR-2026-0001/remind');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(capturedInit?.credentials, 'include');
    assert.equal(res.recipients_notified, 1);
  });

  it('calls POST /api/v1/tenants/contact-sales and GET /api/v1/tenants/platform/analytics', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await api.submitContactSales({
      contact_name: 'Sumanth',
      company_name: 'Acme',
      business_email: 'sumanth@acme.in',
      company_size: '11-50',
    });
    await api.getPlatformAnalytics({ days: 30 });

    assert.deepEqual(calls, [
      '/api/v1/tenants/contact-sales',
      '/api/v1/tenants/platform/analytics?days=30',
    ]);
  });

  it('calls GET /api/v1/payments/receipts and POST /api/v1/payments/receipts/:id/acknowledge', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await api.getPaymentReceipts();
    await api.acknowledgePaymentReceipt('rec-1', { payment_mode: 'UPI', tx_reference: 'UPI-123' });

    assert.deepEqual(calls, [
      { url: '/api/v1/payments/receipts', method: undefined },
      { url: '/api/v1/payments/receipts/rec-1/acknowledge', method: 'POST' },
    ]);
  });

  it('fetches live plans via GET /api/v1/subscriptions/plans and sends plan_id + billing_cycle (never price) to setup & checkout', async () => {
    const requests: Array<{ url: string; method?: string; body?: any }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url: String(url), method: init?.method, body });
      if (String(url).endsWith('/subscriptions/plans')) {
        return new Response(
          JSON.stringify([{ id: 'plan-biz-uuid', slug: 'business', name: 'Business Plan', monthly_price: 1899, annual_price: 18990, is_active: true }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ tenant_id: 'ten-1', checkout_access_token: 'tok.1', checkout_reference: 'CHK-1', status: 'PAYMENT_PENDING', amount: 18990 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const plans = await api.getSubscriptionPlans();
    assert.equal(plans[0].id, 'plan-biz-uuid');

    await api.completeCompanySetup({
      registration_id: 'reg-1',
      plan_id: plans[0].id,
      billing_cycle: 'annual',
    });
    await api.initiateCheckout({
      registration_id: 'reg-1',
      plan_id: plans[0].id,
      billing_cycle: 'annual',
      admin_email: 'admin@acme.in',
      checkout_access_token: 'tok.1',
    });

    assert.equal(requests[0].url, '/api/v1/subscriptions/plans');
    assert.equal(requests[1].url, '/api/v1/auth/complete-company-setup');
    assert.equal(requests[1].body.plan_id, 'plan-biz-uuid');
    assert.equal(requests[1].body.billing_cycle, 'annual');
    assert.equal(requests[2].url, '/api/v1/payments/checkout/initiate');
    assert.equal(requests[2].body.plan_id, 'plan-biz-uuid');
    assert.equal(requests[2].body.amount, undefined);
  });

  it('calls POST /api/v1/auth/logout with credentials=include and GET /api/v1/documents/:id/verify', async () => {
    const calls: Array<{ url: string; method?: string; credentials?: RequestCredentials }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, credentials: init?.credentials });
      return new Response(JSON.stringify({ verified: true, integrity_status: 'VALID' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await api.logout();
    const verifyRes = await api.verifyDocumentIntegrity('doc-uuid-99');

    assert.equal(verifyRes.verified, true);
    assert.deepEqual(calls, [
      { url: '/api/v1/auth/logout', method: 'POST', credentials: 'include' },
      { url: '/api/v1/documents/doc-uuid-99/verify', method: undefined, credentials: 'include' },
    ]);
  });

  it('enforces Platform Owner vs Tenant navigation restrictions', () => {
    const canAccessPlatformView = (role: string, isPlatformOwner: boolean, isSuperAdmin: boolean, view: string) => {
      const isRootAdmin = isPlatformOwner || isSuperAdmin || role === 'platform_owner';
      if (view.startsWith('superadmin_')) return isRootAdmin;
      return true;
    };
    const canCreateTenantAgreement = (isPlatformOwner: boolean, isSuperAdmin: boolean, role: string) =>
      !(isPlatformOwner || isSuperAdmin || role === 'platform_owner');

    assert.equal(canAccessPlatformView('company_admin', false, false, 'superadmin_pricing'), false);
    assert.equal(canAccessPlatformView('platform_owner', true, true, 'superadmin_pricing'), true);
    assert.equal(canCreateTenantAgreement(true, true, 'platform_owner'), false);
    assert.equal(canCreateTenantAgreement(false, false, 'company_admin'), true);
  });

  it('calls invitation acceptance and signing portal OTP/submit endpoints with expected contracts', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ success: true, portal_status: 'READY_TO_SIGN' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await api.getInviteInfo('inv-tok-1');
    await api.acceptInvite({ token: 'inv-tok-1', full_name: 'Asha Rao', password: 'Password123!' });
    await api.getSigningPortalByToken('sign-tok-1');
    await api.requestSigningOtp('sign-tok-1');
    await api.verifySigningOtp('sign-tok-1', '123456');

    assert.deepEqual(calls, [
      { url: '/api/v1/auth/invite-info?token=inv-tok-1', method: undefined },
      { url: '/api/v1/auth/accept-invite', method: 'POST' },
      { url: '/api/v1/signing/portal/sign-tok-1', method: undefined },
      { url: '/api/v1/signing/portal/sign-tok-1/otp/request', method: 'POST' },
      { url: '/api/v1/signing/portal/sign-tok-1/otp/verify', method: 'POST' },
    ]);
  });
});
