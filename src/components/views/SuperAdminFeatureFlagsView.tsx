import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

interface TenantFlagsRow {
  id: string;
  name: string;
  slug: string;
  plan_name: string;
  flags: Record<string, boolean>;
}

const FLAG_LABELS: Array<{ key: string; label: string }> = [
  { key: 'custom_branding', label: 'Custom Branding' },
  { key: 'custom_domain', label: 'Custom Domain' },
  { key: 'templates_library', label: 'Templates Library' },
  { key: 'otp_signing', label: 'OTP Signing' },
  { key: 'api_access', label: 'API Access' },
  { key: 'aadhaar_esign', label: 'Aadhaar eSign' },
];

export const SuperAdminFeatureFlagsView: React.FC = () => {
  const { addToast } = useApp();
  const [rows, setRows] = useState<TenantFlagsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadFlags = async () => {
    setLoading(true);
    try {
      const data = await api.getPlatformFeatureFlags();
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('Load Failed', err.message || 'Could not load feature flags.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlags();
  }, []);

  const handleToggle = async (tenant: TenantFlagsRow, flagKey: string) => {
    const nextValue = !tenant.flags[flagKey];
    const nextFlags = { ...tenant.flags, [flagKey]: nextValue };
    setSavingKey(`${tenant.id}:${flagKey}`);
    try {
      await api.updateTenantFeatureFlags(tenant.id, nextFlags);
      setRows((prev) =>
        prev.map((r) => (r.id === tenant.id ? { ...r, flags: nextFlags } : r)),
      );
      addToast(
        'Feature Flag Updated',
        `${tenant.name}: ${flagKey} ${nextValue ? 'enabled' : 'disabled'}.`,
        'success',
      );
    } catch (err: any) {
      addToast('Update Failed', err.message || 'Could not update feature flag.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Feature Flags
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Toggle capabilities per tenant workspace; changes persist in PostgreSQL
          </p>
        </div>
        <button
          type="button"
          onClick={loadFlags}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-3 px-5 font-medium">Tenant</th>
                <th className="py-3 px-5 font-medium">Plan</th>
                {FLAG_LABELS.map((f) => (
                  <th key={f.key} className="py-3 px-4 font-medium text-center">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={2 + FLAG_LABELS.length} className="py-8 px-5 text-center text-slate-400">
                    Loading tenant feature flags...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={2 + FLAG_LABELS.length} className="py-8 px-5 text-center text-slate-400">
                    No active tenants found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-3.5 px-5 font-semibold text-slate-900 dark:text-white">
                      {row.name}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 dark:text-slate-300">
                      {row.plan_name}
                    </td>
                    {FLAG_LABELS.map((f) => {
                      const enabled = Boolean(row.flags[f.key]);
                      const busy = savingKey === `${row.id}:${f.key}`;
                      return (
                        <td key={f.key} className="py-3.5 px-4 text-center">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggle(row, f.key)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                              enabled
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/60'
                                : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                            }`}
                          >
                            {busy ? '...' : enabled ? 'On' : 'Off'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
