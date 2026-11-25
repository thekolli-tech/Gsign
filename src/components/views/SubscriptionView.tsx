import React, { useState } from 'react';
import { 
  Check, 
  CreditCard, 
  FileText,
  Users,
  HardDrive
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const SubscriptionView: React.FC = () => {
  const { addToast } = useApp();
  const [selectedPlan, setSelectedPlan] = useState<'Starter' | 'Business' | 'Professional' | 'Enterprise'>('Business');

  const plans = [
    {
      id: 'Starter',
      name: 'Starter',
      price: '₹499/mo',
      features: '25 docs · 2 users',
      details: ['Basic electronic signing', 'Standard templates', 'Email audit trail']
    },
    {
      id: 'Business',
      name: 'Business',
      price: '₹1,499/mo',
      features: '100 docs · 5 users · branding',
      details: ['Custom branding & logo', 'OTP authentication', 'Receipt voucher generator', 'Priority processing'],
      isCurrent: true,
    },
    {
      id: 'Professional',
      name: 'Professional',
      price: '₹2,999/mo',
      features: '300 docs · 15 users',
      details: ['Custom domain & SSL', 'Advanced template logic', 'Department segregation', 'API webhook events']
    },
    {
      id: 'Enterprise',
      name: 'Enterprise',
      price: 'Custom',
      features: 'Custom domain · integrations',
      details: ['Unlimited documents', 'Aadhaar eSign & DSC ready', 'White-labeling', 'Dedicated SLA']
    }
  ];

  // Progress numbers matching exact wireframe:
  // Documents: 62 / 100
  // Users: 4 / 5
  // Storage GB: 3 / 10
  const docsCount = 62;
  const docsMax = 100;
  const usersCount = 4;
  const usersMax = 5;
  const storageCount = 3;
  const storageMax = 10;

  const handleSelectPlan = (planId: typeof selectedPlan) => {
    setSelectedPlan(planId);
    if (planId !== 'Business') {
      addToast('Plan Selected', `Requested billing transition to ${planId} tier.`, 'info');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching pages 10 & 24 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Subscription
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Business plan · renews 24 Dec 2026
          </p>
        </div>

        <button
          onClick={() => addToast('Invoices', 'Viewing GST invoices ledger.', 'info')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle"
        >
          <CreditCard size={13} />
          <span>Billing History</span>
        </button>
      </div>

      {/* 4 Plan Tier Cards matching Screenshot Pages 10 & 24 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map(p => {
          const isActive = selectedPlan === p.id;
          return (
            <div
              key={p.id}
              onClick={() => handleSelectPlan(p.id as any)}
              className={`p-5 rounded-xl cursor-pointer transition-all ${
                isActive
                  ? 'bg-white dark:bg-slate-900 border-2 border-brand-600 dark:border-brand-500 shadow-card'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-card'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  {p.name}
                </span>
                {isActive && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
                    Current
                  </span>
                )}
              </div>

              <div className="mt-3">
                <span className="text-xl font-bold text-slate-900 dark:text-white">
                  {p.price}
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {p.features}
                </p>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                {p.details.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                    <Check size={12} className="text-brand-600 dark:text-brand-400 flex-shrink-0" />
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Usage Progress Metrics Card matching Pages 10 & 24 */}
      <div className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Active Plan Consumption
        </h3>

        <div className="space-y-5 max-w-xl">
          {/* Documents · 62 / 100 */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
              <span className="font-medium flex items-center gap-1.5">
                <FileText size={13} className="text-slate-400" />
                Documents · {docsCount} / {docsMax}
              </span>
              <span className="font-mono text-slate-500">62%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div 
                className="h-full bg-brand-600 rounded-full"
                style={{ width: `${(docsCount / docsMax) * 100}%` }}
              />
            </div>
          </div>

          {/* Users · 4 / 5 */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
              <span className="font-medium flex items-center gap-1.5">
                <Users size={13} className="text-slate-400" />
                Users · {usersCount} / {usersMax}
              </span>
              <span className="font-mono text-slate-500">80%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div 
                className="h-full bg-brand-600 rounded-full"
                style={{ width: `${(usersCount / usersMax) * 100}%` }}
              />
            </div>
          </div>

          {/* Storage GB · 3 / 10 */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
              <span className="font-medium flex items-center gap-1.5">
                <HardDrive size={13} className="text-slate-400" />
                Storage GB · {storageCount} / {storageMax}
              </span>
              <span className="font-mono text-slate-500">30%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div 
                className="h-full bg-brand-600 rounded-full"
                style={{ width: `${(storageCount / storageMax) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
