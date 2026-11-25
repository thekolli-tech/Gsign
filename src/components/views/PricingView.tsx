import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import gsignLogo from '../../assets/gsign_logo.png';

export const PricingView: React.FC = () => {
  const { branding, setActiveView } = useApp();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const plans = [
    {
      name: 'Starter Plan',
      slug: 'starter',
      description: 'Ideal for small businesses and boutique law practices',
      monthlyPrice: 1499,
      annualPrice: 14990,
      agreements: '50 agreements / month',
      users: 'Up to 3 team members',
      features: [
        '50 electronic agreements/mo',
        'Up to 3 team seats',
        'Standard document templates',
        'Cryptographic SHA-256 hash seals',
        'Email verification & audit logs',
        'Standard business hours support',
      ],
      popular: false,
    },
    {
      name: 'Growth Plan',
      slug: 'growth',
      description: 'For growing enterprises requiring custom branding and high volume',
      monthlyPrice: 3999,
      annualPrice: 39990,
      agreements: '250 agreements / month',
      users: 'Up to 10 team members',
      features: [
        '250 electronic agreements/mo',
        'Up to 10 team seats',
        'Custom brand logos and styling',
        'SMS OTP recipient authentication',
        'Automated payment acknowledgement receipts',
        'Role-based permissions & departments',
        'Priority enterprise email support',
      ],
      popular: true,
    },
    {
      name: 'Enterprise Plan',
      slug: 'enterprise',
      description: 'Full-scale agreement management with unlimited volume and dedicated account team',
      monthlyPrice: 9999,
      annualPrice: 99990,
      agreements: 'Unlimited agreements',
      users: 'Unlimited team members',
      features: [
        'Unlimited electronic agreements',
        'Unlimited team members & admins',
        'Dedicated enterprise account manager',
        'Custom domain & SSO SAML/OIDC integration',
        'Full REST API & webhook dispatch',
        '99.9% uptime SLA guarantee',
        '24/7 priority emergency support',
      ],
      popular: false,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 transition-colors duration-200">
      {/* Top Header */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <img
            src={branding.logoUrl || gsignLogo}
            alt="GSIGN"
            className="h-8 w-auto max-w-[160px] object-contain cursor-pointer"
            onClick={() => setActiveView('signin')}
          />
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
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
            onClick={() => setActiveView('register_company')}
            className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors shadow-subtle"
          >
            Register Company
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto py-12 px-4 space-y-8 flex-1">
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

          {/* Billing Switcher */}
          <div className="flex justify-center items-center gap-3 pt-3">
            <span className={`text-xs font-medium ${billingCycle === 'monthly' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
              Monthly Billing
            </span>
            <button
              type="button"
              onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
              className="w-12 h-6 bg-slate-200 dark:bg-slate-700 rounded-full relative p-0.5 transition-colors"
            >
              <div className={`w-5 h-5 rounded-full bg-white dark:bg-brand-500 shadow-md transition-transform ${billingCycle === 'annual' ? 'translate-x-6' : ''}`} />
            </button>
            <span className={`text-xs font-medium ${billingCycle === 'annual' ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
              Annual Billing <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold px-1.5 py-0.5 rounded">Save 17%</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          {plans.map((plan) => {
            const price = billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
            return (
              <div
                key={plan.slug}
                className={`rounded-2xl p-6 flex flex-col justify-between space-y-6 bg-white dark:bg-slate-900 border transition-all ${
                  plan.popular
                    ? 'border-brand-600 ring-2 ring-brand-600/20 shadow-lg relative'
                    : 'border-slate-200 dark:border-slate-800 shadow-card hover:border-slate-300'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider bg-brand-600 text-white px-3 py-0.5 rounded-full">
                    Most Popular
                  </span>
                )}

                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {plan.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[32px]">
                      {plan.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                        ₹{price.toLocaleString('en-IN')}
                      </span>
                      <span className="text-xs text-slate-400">/{billingCycle === 'annual' ? 'year' : 'month'}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {billingCycle === 'annual' ? 'Billed annually' : 'Billed monthly'}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Features included:
                    </div>
                    {plan.features.map((feat, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-slate-600 dark:text-slate-400">
                        <span className="text-brand-600 dark:text-brand-400 font-bold">✓</span>
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => setActiveView('register_company')}
                    className={`w-full py-2.5 rounded-lg font-medium text-xs transition-colors shadow-subtle ${
                      plan.popular
                        ? 'bg-brand-600 hover:bg-brand-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-200'
                    }`}
                  >
                    Register Company on {plan.name.replace(' Plan', '')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

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
