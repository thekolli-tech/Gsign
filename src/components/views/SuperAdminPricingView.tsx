import React, { useEffect, useState, useCallback } from 'react';
import { Save, RefreshCw, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

interface ManagedPlan {
  id: string;
  name: string;
  slug: string;
  description: string;
  monthly_price: string;
  annual_price: string;
  max_agreements_per_month: string;
  max_users: string;
  featuresText: string;
  is_active: boolean;
}

export const SuperAdminPricingView: React.FC = () => {
  const { addToast } = useApp();
  const [plans, setPlans] = useState<ManagedPlan[]>([]);
  const [originalPlans, setOriginalPlans] = useState<Record<string, ManagedPlan>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ManagedPlan[] | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.getManageableSubscriptionPlans();
      const mapped: ManagedPlan[] = rows.map((r: any) => ({
        id: r.id,
        name: String(r.name ?? ''),
        slug: String(r.slug ?? ''),
        description: String(r.description ?? ''),
        monthly_price: String(r.monthly_price ?? 0),
        annual_price: String(r.annual_price ?? 0),
        max_agreements_per_month: String(r.max_agreements_per_month ?? 0),
        max_users: String(r.max_users ?? 0),
        featuresText: Array.isArray(r.features) ? r.features.join(', ') : '',
        is_active: Boolean(r.is_active),
      }));
      setPlans(mapped);
      const map: Record<string, ManagedPlan> = {};
      mapped.forEach((p) => {
        map[p.id] = { ...p };
      });
      setOriginalPlans(map);
    } catch (err: any) {
      setError(err?.message || 'Unable to load subscription plans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleFieldChange = (id: string, field: keyof ManagedPlan, val: any) => {
    setPlans((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: val } : p)),
    );
  };

  const handleSave = async () => {
    setError(null);
    const modified = plans.filter((p) => {
      const orig = originalPlans[p.id];
      if (!orig) return false;
      return (
        p.name !== orig.name ||
        p.description !== orig.description ||
        p.monthly_price !== orig.monthly_price ||
        p.annual_price !== orig.annual_price ||
        p.max_agreements_per_month !== orig.max_agreements_per_month ||
        p.max_users !== orig.max_users ||
        p.featuresText !== orig.featuresText ||
        p.is_active !== orig.is_active
      );
    });

    if (modified.length === 0) {
      addToast('No Changes', 'No plan fields were modified.', 'info');
      return;
    }

    // Validate before sending
    for (const p of modified) {
      if (!p.name.trim()) {
        setError('Plan name cannot be empty.');
        return;
      }
      const monthly = Number(p.monthly_price);
      const annual = Number(p.annual_price);
      const maxDocs = Number(p.max_agreements_per_month);
      const maxUsers = Number(p.max_users);
      if (!Number.isFinite(monthly) || monthly < 0 || !Number.isFinite(annual) || annual < 0) {
        setError(`Invalid price for ${p.name}: prices must be 0 or greater.`);
        return;
      }
      if (!Number.isInteger(maxDocs) || (maxDocs !== -1 && maxDocs < 0)) {
        setError(`Invalid document limit for ${p.name}: use -1 for unlimited or a non-negative integer.`);
        return;
      }
      if (!Number.isInteger(maxUsers) || (maxUsers !== -1 && maxUsers < 0)) {
        setError(`Invalid user limit for ${p.name}: use -1 for unlimited or a non-negative integer.`);
        return;
      }
    }

    setPendingConfirm(modified);
  };

  const handleConfirmSave = async () => {
    if (!pendingConfirm || pendingConfirm.length === 0) return;
    setSaving(true);
    try {
      for (const p of pendingConfirm) {
        await api.updateSubscriptionPlan(p.id, {
          name: p.name.trim(),
          description: p.description.trim(),
          monthly_price: Number(p.monthly_price),
          annual_price: Number(p.annual_price),
          max_agreements_per_month: Number(p.max_agreements_per_month),
          max_users: Number(p.max_users),
          features: p.featuresText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          is_active: p.is_active,
        });
      }
      addToast('Pricing Saved', `Updated ${pendingConfirm.length} subscription plan(s).`, 'success');
      setPendingConfirm(null);
      await loadPlans();
    } catch (err: any) {
      setError(err?.message || 'Failed to save pricing changes.');
      addToast('Save Failed', err?.message || 'Failed to save pricing changes.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Plans & Pricing
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Manage persisted subscription tiers, prices, and quotas (use -1 for unlimited)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadPlans}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Reload</span>
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle disabled:opacity-50"
          >
            <Save size={13} />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
        <strong>Notice:</strong> Updating a plan&apos;s prices or quota limits immediately affects existing active subscribers on that tier. Per-subscription entitlement snapshotting is not yet active.
      </div>

      {pendingConfirm && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800 text-xs text-slate-800 dark:text-slate-200">
          <div>
            Confirm saving live pricing/limit changes to{' '}
            <strong>{pendingConfirm.map((p) => p.name).join(', ')}</strong>? Existing subscribers on these plans will be affected immediately.
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setPendingConfirm(null)}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Confirm & Save'}
            </button>
          </div>
        </div>
      )}

      {/* Pricing Matrix Table */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-xs text-slate-500 dark:text-slate-400">
            Loading persisted subscription plans...
          </div>
        ) : plans.length === 0 ? (
          <div className="p-8 text-xs text-slate-500 dark:text-slate-400">
            No subscription plans found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                  <th className="py-3 px-4 font-medium">Plan & Slug</th>
                  <th className="py-3 px-4 font-medium">Monthly (₹)</th>
                  <th className="py-3 px-4 font-medium">Annual (₹)</th>
                  <th className="py-3 px-4 font-medium">Docs / Mo</th>
                  <th className="py-3 px-4 font-medium">Users</th>
                  <th className="py-3 px-4 font-medium">Features (comma-separated)</th>
                  <th className="py-3 px-4 font-medium">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
                {plans.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 space-y-1">
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => handleFieldChange(p.id, 'name', e.target.value)}
                        className="w-36 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-semibold outline-none focus:border-brand-600"
                      />
                      <div className="text-[10px] font-mono text-slate-400">slug: {p.slug}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={p.monthly_price}
                        onChange={(e) => handleFieldChange(p.id, 'monthly_price', e.target.value)}
                        className="w-24 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono font-medium outline-none focus:border-brand-600"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={p.annual_price}
                        onChange={(e) => handleFieldChange(p.id, 'annual_price', e.target.value)}
                        className="w-24 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono font-medium outline-none focus:border-brand-600"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <input
                        type="number"
                        min={-1}
                        step="1"
                        value={p.max_agreements_per_month}
                        onChange={(e) =>
                          handleFieldChange(p.id, 'max_agreements_per_month', e.target.value)
                        }
                        className="w-20 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono outline-none focus:border-brand-600"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <input
                        type="number"
                        min={-1}
                        step="1"
                        value={p.max_users}
                        onChange={(e) => handleFieldChange(p.id, 'max_users', e.target.value)}
                        className="w-16 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-white font-mono outline-none focus:border-brand-600"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <input
                        type="text"
                        value={p.featuresText}
                        onChange={(e) => handleFieldChange(p.id, 'featuresText', e.target.value)}
                        className="w-64 px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-700 dark:text-slate-300 outline-none focus:border-brand-600"
                      />
                    </td>
                    <td className="py-3.5 px-4">
                      <input
                        type="checkbox"
                        checked={p.is_active}
                        onChange={(e) => handleFieldChange(p.id, 'is_active', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          Changes are persisted to PostgreSQL and audit-logged. Plan IDs and slugs are immutable.
        </div>
      </div>
    </div>
  );
};
