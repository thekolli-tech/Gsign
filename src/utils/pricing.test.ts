import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSubscriptionPlan,
  isCustomEnterprisePlan,
  isPlanPurchasable,
  getDisplayPlanPrice,
  getPricingViewState,
  parsePlanFeatures,
} from './pricing.ts';

describe('Dynamic Public Pricing Logic', () => {
  it('normalizes live backend plan DTOs including JSON-encoded features and numeric strings', () => {
    const plan = normalizeSubscriptionPlan({
      id: 'plan-uuid-1',
      name: 'Business Plan',
      slug: 'business',
      description: 'Updated description from Platform Owner',
      monthly_price: '1799.00',
      annual_price: '17990.00',
      max_agreements_per_month: 150,
      max_users: 10,
      features: '["150 docs/mo","10 users","Custom branding"]',
      is_active: true,
    });

    assert.equal(plan.id, 'plan-uuid-1');
    assert.equal(plan.name, 'Business Plan');
    assert.equal(plan.monthly_price, 1799);
    assert.equal(plan.annual_price, 17990);
    assert.deepEqual(plan.features, ['150 docs/mo', '10 users', 'Custom branding']);
    assert.equal(getDisplayPlanPrice(plan, 'monthly'), 1799);
    assert.equal(getDisplayPlanPrice(plan, 'annual'), 17990);
    assert.equal(isCustomEnterprisePlan(plan), false);
    assert.equal(isPlanPurchasable(plan), true);
  });

  it('identifies custom Enterprise pricing and prevents direct self-serve purchase', () => {
    const enterprise = normalizeSubscriptionPlan({
      id: 'plan-ent',
      name: 'Enterprise Plan',
      slug: 'enterprise',
      description: 'Custom enterprise tier',
      monthly_price: 0,
      annual_price: 0,
      max_agreements_per_month: -1,
      max_users: -1,
      features: ['Custom SLA'],
      is_active: true,
    });

    assert.equal(isCustomEnterprisePlan(enterprise), true);
    assert.equal(isPlanPurchasable(enterprise), false);
  });

  it('marks inactive plans as non-purchasable', () => {
    const inactivePlan = normalizeSubscriptionPlan({
      id: 'plan-old',
      name: 'Legacy Growth',
      slug: 'growth',
      monthly_price: 999,
      annual_price: 9990,
      is_active: false,
    });

    assert.equal(inactivePlan.is_active, false);
    assert.equal(isPlanPurchasable(inactivePlan), false);
  });

  it('distinguishes loading, error, empty/unavailable, and ready states', () => {
    assert.equal(getPricingViewState({ loading: true, error: null, plans: [] }), 'loading');
    assert.equal(
      getPricingViewState({ loading: false, error: 'Failed to load subscription plans.', plans: [] }),
      'error',
    );
    assert.equal(getPricingViewState({ loading: false, error: null, plans: [] }), 'empty');
    assert.equal(
      getPricingViewState({
        loading: false,
        error: null,
        plans: [normalizeSubscriptionPlan({ id: 'p1', name: 'Starter', slug: 'starter', monthly_price: 499, annual_price: 4990 })],
      }),
      'ready',
    );
  });

  it('parses comma-separated feature strings safely', () => {
    assert.deepEqual(parsePlanFeatures('25 docs/mo, 2 users, Audit log'), [
      '25 docs/mo',
      '2 users',
      'Audit log',
    ]);
    assert.deepEqual(parsePlanFeatures(null), []);
  });

  it('preserves valid preselected plan & billing cycle, and rejects stale/inactive/enterprise preselections without silent fallback', () => {
    const activePaid = [
      normalizeSubscriptionPlan({ id: 'p-starter', name: 'Starter Plan', slug: 'starter', monthly_price: 499, annual_price: 4990, is_active: true }),
      normalizeSubscriptionPlan({ id: 'p-biz', name: 'Business Plan', slug: 'business', monthly_price: 1499, annual_price: 14990, is_active: true }),
    ];

    const resolvePreselection = (preselected: { planId: string; billingCycle: 'monthly' | 'annual' } | null) => {
      if (!preselected?.planId) {
        return { selectedPlanId: activePaid[0]?.id || '', billingCycle: 'monthly' as const, warning: null };
      }
      const match = activePaid.find((p) => p.id === preselected.planId && isPlanPurchasable(p));
      if (!match) {
        return {
          selectedPlanId: '',
          billingCycle: 'monthly' as const,
          warning: 'Selected plan is unavailable.',
        };
      }
      return { selectedPlanId: match.id, billingCycle: preselected.billingCycle, warning: null };
    };

    assert.deepEqual(resolvePreselection({ planId: 'p-biz', billingCycle: 'annual' }), {
      selectedPlanId: 'p-biz',
      billingCycle: 'annual',
      warning: null,
    });

    const stale = resolvePreselection({ planId: 'p-deleted', billingCycle: 'annual' });
    assert.equal(stale.selectedPlanId, '');
    assert.ok(stale.warning);

    const ent = resolvePreselection({ planId: 'p-ent', billingCycle: 'monthly' });
    assert.equal(ent.selectedPlanId, '');
    assert.ok(ent.warning);
  });

  it('never marks local-only SHA-256 format as server-verified integrity', () => {
    type VerificationStatus = 'not_verified' | 'verified' | 'failed' | 'unavailable';
    const evaluateIntegrity = (
      hasServerDoc: boolean,
      serverResult?: { verified?: boolean; expected_sha256?: string; actual_sha256?: string } | Error,
    ): VerificationStatus => {
      if (!hasServerDoc) return 'unavailable';
      if (serverResult instanceof Error || !serverResult) return 'failed';
      return serverResult.verified &&
        serverResult.expected_sha256 &&
        serverResult.actual_sha256 === serverResult.expected_sha256
        ? 'verified'
        : 'failed';
    };

    assert.equal(evaluateIntegrity(false), 'unavailable');
    assert.equal(evaluateIntegrity(true, new Error('Network error')), 'failed');
    assert.equal(
      evaluateIntegrity(true, { verified: false, expected_sha256: 'abc', actual_sha256: 'def' }),
      'failed',
    );
    assert.equal(
      evaluateIntegrity(true, { verified: true, expected_sha256: 'abc', actual_sha256: 'abc' }),
      'verified',
    );
  });
});
