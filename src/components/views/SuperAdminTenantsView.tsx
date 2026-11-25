import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Tenant } from '../../types';

export const SuperAdminTenantsView: React.FC = () => {
  const { tenants, setTenants, addToast } = useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [plan, setPlan] = useState<Tenant['plan']>('Business');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

  const getStatusBadge = (status: Tenant['status']) => {
    switch (status) {
      case 'Active':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            Active
          </span>
        );
      case 'Trial':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            Trial
          </span>
        );
      case 'Payment failed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
            Payment failed
          </span>
        );
    }
  };

  const handleAddTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    const newTenant: Tenant = {
      id: `ten-${Date.now()}`,
      company,
      plan,
      status: 'Active',
      docsThisMonth: 0,
      domain: domain || '—',
      adminEmail: adminEmail || `admin@${company.toLowerCase().replace(/\s+/g, '')}.com`
    };

    setTenants(prev => [...prev, newTenant]);
    setCompany('');
    setDomain('');
    setAdminEmail('');
    setModalOpen(false);
    addToast('Tenant Provisioned', `Company account created for ${company}`, 'success');
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching pages 11 & 25 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Tenants
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            All customer companies
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
        >
          <Plus size={14} />
          <span>+ Add tenant</span>
        </button>
      </div>

      {/* Tenants Table matching Screenshot */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-3 px-6 font-medium">Company</th>
                <th className="py-3 px-6 font-medium">Plan</th>
                <th className="py-3 px-6 font-medium">Status</th>
                <th className="py-3 px-6 font-medium">Docs this month</th>
                <th className="py-3 px-6 font-medium">Domain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
              {tenants.map(t => (
                <tr
                  key={t.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-white">
                    {t.company}
                  </td>
                  <td className="py-3.5 px-6 text-slate-700 dark:text-slate-300">
                    {t.plan}
                  </td>
                  <td className="py-3.5 px-6">
                    {getStatusBadge(t.status)}
                  </td>
                  <td className="py-3.5 px-6 font-mono text-slate-800 dark:text-slate-200">
                    {t.docsThisMonth}
                  </td>
                  <td className="py-3.5 px-6 font-mono text-slate-500 dark:text-slate-400">
                    {t.domain}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Tenant Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Provision New Tenant
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleAddTenant} className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Logistics"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Subscription Tier
                </label>
                <select
                  value={plan}
                  onChange={e => setPlan(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                >
                  <option value="Starter">Starter (25 docs/mo)</option>
                  <option value="Business">Business (100 docs/mo)</option>
                  <option value="Professional">Professional (300 docs/mo)</option>
                  <option value="Enterprise">Enterprise (Custom)</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Admin Email
                </label>
                <input
                  type="email"
                  placeholder="admin@apexlogistics.in"
                  value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Custom Domain (Optional)
                </label>
                <input
                  type="text"
                  placeholder="sign.apexlogistics.in"
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 font-medium shadow-subtle"
                >
                  Save Tenant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
