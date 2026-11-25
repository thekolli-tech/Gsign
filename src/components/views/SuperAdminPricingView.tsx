import React, { useState } from 'react';
import { Save } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PricingPlan } from '../../types';

export const SuperAdminPricingView: React.FC = () => {
  const { pricingPlans, setPricingPlans, addToast } = useApp();
  const [plans, setPlans] = useState<PricingPlan[]>(pricingPlans);

  const handleFieldChange = (id: string, field: keyof PricingPlan, val: any) => {
    setPlans(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, [field]: val };
      }
      return p;
    }));
  };

  const handleSave = () => {
    setPricingPlans(plans);
    addToast('Pricing Saved', 'Pricing matrix updated.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching pages 12 & 26 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Plans & Pricing
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Change prices, limits and add-ons without code
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
        >
          <Save size={13} />
          <span>Save</span>
        </button>
      </div>

      {/* Pricing Matrix Table matching Screenshot Pages 12 & 26 */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-3 px-6 font-medium">Plan</th>
                <th className="py-3 px-6 font-medium">Price / month</th>
                <th className="py-3 px-6 font-medium">Documents</th>
                <th className="py-3 px-6 font-medium">Users</th>
                <th className="py-3 px-6 font-medium">Overage rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
              {plans.map(p => (
                <tr
                  key={p.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-white">
                    {p.name}
                  </td>
                  <td className="py-3.5 px-6">
                    <input
                      type="text"
                      value={p.priceMonthly}
                      onChange={e => handleFieldChange(p.id, 'priceMonthly', e.target.value)}
                      className="w-32 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono font-medium outline-none focus:border-brand-600"
                    />
                  </td>
                  <td className="py-3.5 px-6">
                    <input
                      type="text"
                      value={p.documentsLimit}
                      onChange={e => handleFieldChange(p.id, 'documentsLimit', e.target.value)}
                      className="w-20 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono outline-none focus:border-brand-600"
                    />
                  </td>
                  <td className="py-3.5 px-6">
                    <input
                      type="text"
                      value={p.usersLimit}
                      onChange={e => handleFieldChange(p.id, 'usersLimit', e.target.value)}
                      className="w-16 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono outline-none focus:border-brand-600"
                    />
                  </td>
                  <td className="py-3.5 px-6 text-slate-600 dark:text-slate-400">
                    {p.overageRule}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footnote matching screenshot pages 12 & 26 */}
        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          OTP, Aadhaar eSign, SMS and storage are billed as separate add-ons.
        </div>
      </div>
    </div>
  );
};
