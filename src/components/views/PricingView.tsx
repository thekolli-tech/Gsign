import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  PublicSubscriptionPlan,
  normalizeSubscriptionPlan,
  isCustomEnterprisePlan,
  isPlanPurchasable,
  getDisplayPlanPrice,
  getPricingViewState,
} from '../../utils/pricing';
import gsignLogo from '../../assets/gsign_logo.png';

export const PricingView: React.FC = () => {
  const { branding, setActiveView, setPreselectedPlan } = useApp();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [plans, setPlans] = useState<PublicSubscriptionPlan[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.getSubscriptionPlans();
      const normalized = Array.isArray(rows) ? rows.map(normalizeSubscriptionPlan) : [];
      setPlans(normalized);
    } catch (err: any) {
      setPlans([]);
      setError(err?.message || 'Unable to load subscription plans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const viewState = getPricingViewState({ loading, error, plans });

  const handleSelectPlan = (plan: PublicSubscriptionPlan) => {
    if (isCustomEnterprisePlan(plan)) {
      setPreselectedPlan(null);
      setActiveView('contact_sales');
      return;
    }
    if (!isPlanPurchasable(plan)) {
      return;
    }
    setPreselectedPlan({ planId: plan.id, billingCycle });
    setActiveView('register_company');
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 transition-colors duration-200">
      {/* Top Header */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <img
            src={branding.logoUrl || gsignLogo}
            alt="GSIGN"
            className="h-8 w-auto max-w-[160px] object-contain cursor-pointer"
            onClick={() => setActiveView('landing')}
          />
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveView('landing')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Home
          </button>
          <button
            onClick={() => setActiveView('signin')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Sign in
          </button>
          <button
            onClick={() => setActiveView('contact_sales')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Contact Sales
          </button>
          <button
            onClick={() => {
              setPreselectedPlan(null);
              setActiveView('register_company');
            }}
            className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors shadow-subtle"
          >
            Register Company
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl w-full mx-auto py-12 px-4 space-y-8 flex-1">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <div className="inline-block px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800 text-xs font-semibold">
            Enterprise Transparent Pricing
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Simple, Transparent Subscription Plans
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            GSIGN is a strictly paid enterprise subscription platform. Every company operates in a dedicated, cryptographically isolated tenant.
          </p>

          {/* Billing Switcher & Refresh */}
          <div className="flex justify-center items-center gap-3 pt-3">
            <span className={`text-xs font-medium ${billingCycle === 'monthly' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
              Monthly Billing
            </span>
            <button
              type="button"
              onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
              className="w-12 h-6 bg-slate-200 dark:bg-slate-700 rounded-full relative p-0.5 transition-colors"
              aria-label="Toggle billing cycle"
            >
              <div className={`w-5 h-5 rounded-full bg-white dark:bg-brand-500 shadow-md transition-transform ${billingCycle === 'annual' ? 'translate-x-6' : ''}`} />
            </button>
            <span className={`text-xs font-medium ${billingCycle === 'annual' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
              Annual Billing <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold px-1.5 py-0.5 rounded">Save 17%</span>
            </span>
            <button
              type="button"
              onClick={() => void loadPlans()}
              disabled={loading}
              title="Refresh live pricing"
              className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Loading State */}
        {viewState === 'loading' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-4">
            {[1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card animate-pulse space-y-4"
              >
                <div className="h-5 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-8 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-8 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="space-y-2 pt-2">
                  <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded" />
                  <div className="h-3 w-5/6 bg-slate-100 dark:bg-slate-800 rounded" />
                  <div className="h-3 w-4/6 bg-slate-100 dark:bg-slate-800 rounded" />
                </div>
                <div className="h-9 w-full bg-slate-200 dark:bg-slate-800 rounded-lg mt-4" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {viewState === 'error' && (
          <div className="max-w-lg mx-auto rounded-2xl p-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-center space-y-3">
            <div className="flex justify-center text-red-600 dark:text-red-400">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
              Unable to Load Subscription Pricing
            </h2>
            <p className="text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
            <div className="pt-1 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => void loadPlans()}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setActiveView('contact_sales')}
                className="px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium"
              >
                Contact Sales
              </button>
            </div>
          </div>
        )}

        {/* Unavailable / Empty State */}
        {viewState === 'empty' && (
          <div className="max-w-lg mx-auto rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3 shadow-card">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Subscription Plans Currently Unavailable
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              No active self-serve subscription tiers are currently published. Please contact GSIGN Sales for enterprise onboarding.
            </p>
            <div className="pt-1 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setActiveView('contact_sales')}
                className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium transition-colors"
              >
                Contact Sales
              </button>
              <button
                type="button"
                onClick={() => void loadPlans()}
                className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium"
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {/* Pricing Cards */}
        {viewState === 'ready' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-4">
            {plans.map((plan) => {
              const isCustom = isCustomEnterprisePlan(plan);
              const isInactive = plan.is_active === false;
              const isPopular = !isInactive && plan.slug === 'business';
              const price = getDisplayPlanPrice(plan, billingCycle);
              const quotaLines = [
                plan.max_agreements_per_month === -1
                  ? 'Unlimited documents / month'
                  : `${plan.max_agreements_per_month} documents / month`,
                plan.max_users === -1
                  ? 'Unlimited team members'
                  : `Up to ${plan.max_users} team members`,
              ];
              const featureList = plan.features.length > 0 ? plan.features : quotaLines;

              return (
                <div
                  key={plan.id || plan.slug}
                  className={`rounded-2xl p-6 flex flex-col justify-between space-y-6 bg-white dark:bg-slate-900 border transition-all relative ${
                    isInactive
                      ? 'border-slate-200 dark:border-slate-800 opacity-75'
                      : isPopular
                        ? 'border-brand-600 ring-2 ring-brand-600/20 shadow-lg'
                        : 'border-slate-200 dark:border-slate-800 shadow-card hover:border-slate-300'
                  }`}
                >
                  {isPopular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider bg-brand-600 text-white px-3 py-0.5 rounded-full">
                      Most Popular
                    </span>
                  )}
                  {isInactive && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider bg-slate-600 text-white px-3 py-0.5 rounded-full">
                      Unavailable
                    </span>
                  )}

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        {plan.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[32px]">
                        {plan.description || 'Enterprise e-signature subscription tier'}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                      {isCustom ? (
                        <>
                          <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                              Custom
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Tailored enterprise pricing
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                              ₹{price.toLocaleString('en-IN')}
                            </span>
                            <span className="text-xs text-slate-400">/{billingCycle === 'annual' ? 'year' : 'month'}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {billingCycle === 'annual' ? 'Billed annually' : 'Billed monthly'}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <div className="font-semibold text-slate-700 dark:text-slate-300">
                        Features included:
                      </div>
                      {featureList.map((feat, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-slate-600 dark:text-slate-400">
                          <span className="text-brand-600 dark:text-brand-400 font-bold">✓</span>
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      disabled={isInactive}
                      onClick={() => handleSelectPlan(plan)}
                      className={`w-full py-2.5 rounded-lg font-medium text-xs transition-colors shadow-subtle disabled:opacity-50 disabled:cursor-not-allowed ${
                        isPopular && !isInactive
                          ? 'bg-brand-600 hover:bg-brand-700 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-200'
                      }`}
                    >
                      {isInactive
                        ? 'Currently Unavailable'
                        : isCustom
                          ? 'Contact Sales'
                          : `Register Company on ${plan.name}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Note on Free Trial policy */}
        <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
          <strong>Enterprise Subscription Policy:</strong> GSIGN does not offer free trials or ad-supported tiers. Paid workspace access is provisioned upon verified checkout payment or authorized manual activation by the Platform Owner.
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-3 text-[11px] text-slate-400 border-t border-slate-200 dark:border-slate-800">
        Powered by Genemax IT Solution Private Limited • GSIGN Enterprise Agreement & Signature Platform
      </div>
    </div>
  );
};
