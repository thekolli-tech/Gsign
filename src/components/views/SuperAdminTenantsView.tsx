import React, { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Tenant } from '../../types';

export const SuperAdminTenantsView: React.FC = () => {
  const { tenants, setTenants, addToast } = useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [plan, setPlan] = useState<Tenant['plan']>('Business');
  const [durationMonths, setDurationMonths] = useState(1);
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemoveTenant = async (tenant: Tenant) => {
    if (!window.confirm(`Remove tenant "${tenant.company}" and revoke all its active sessions?`)) {
      return;
    }
    setRemovingId(tenant.id);
    try {
      await api.deleteTenant(tenant.id);
      setTenants(prev => prev.filter(t => t.id !== tenant.id));
      addToast('Tenant Removed', `${tenant.company} has been removed and sessions revoked.`, 'success');
    } catch (err: any) {
      addToast('Removal Failed', err.message || 'Could not remove tenant', 'error');
    } finally {
      setRemovingId(null);
    }
  };

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

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !adminEmail || adminPassword.length < 8) {
      addToast('Validation Error', 'Company name, admin email, and password (min 8 chars) are required.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createTenant({
        company_name: company.trim(),
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
        plan_slug: plan.toLowerCase(),
        duration_months: durationMonths,
        domain: domain.trim() || undefined,
      });

      const newTenant: Tenant = {
        id: created.id,
        company: created.name,
        plan,
        status: 'Active',
        docsThisMonth: 0,
        domain: created.slug || domain || '—',
        adminEmail: created.admin_email || adminEmail,
      };

      setTenants(prev => [newTenant, ...prev]);
      setCompany('');
      setDomain('');
      setAdminEmail('');
      setAdminPassword('');
      setDurationMonths(1);
      setModalOpen(false);
      addToast('Tenant Provisioned', `Company workspace created for ${created.name}`, 'success');
    } catch (err: any) {
      addToast('Provisioning Failed', err.message || 'Could not create tenant', 'error');
    } finally {
      setSubmitting(false);
    }
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
                <th className="py-3 px-6 font-medium text-right">Actions</th>
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
                  <td className="py-3.5 px-6 text-right">
                    <button
                      type="button"
                      disabled={removingId === t.id}
                      onClick={() => handleRemoveTenant(t)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={12} />
                      <span>{removingId === t.id ? 'Removing...' : 'Remove'}</span>
                    </button>
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

              <div className="grid grid-cols-2 gap-3">
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
                    Access Duration
                  </label>
                  <select
                    value={durationMonths}
                    onChange={e => setDurationMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                  >
                    <option value={1}>1 Month</option>
                    <option value={3}>3 Months</option>
                    <option value={6}>6 Months</option>
                    <option value={12}>1 Year</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Admin Email *
                </label>
                <input
                  type="email"
                  required
                  placeholder="admin@apexlogistics.in"
                  value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Admin Password (min 8 chars) *
                </label>
                <div className="relative">
                  <input
                    type={showAdminPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Choose initial password"
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(prev => !prev)}
                    aria-label={showAdminPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showAdminPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
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
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 font-medium shadow-subtle"
                >
                  {submitting ? 'Provisioning...' : 'Save Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
