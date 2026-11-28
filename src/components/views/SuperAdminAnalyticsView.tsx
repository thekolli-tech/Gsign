import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Users,
  FileSignature,
  IndianRupee,
  HardDrive,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Layers,
} from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

export interface PlatformAnalyticsData {
  range: { from: string; to: string; days: number };
  tenants: { total: number; active: number; suspended: number; archived: number };
  users: { total: number; active: number };
  agreements: {
    total: number;
    draft: number;
    pending: number;
    completed: number;
    rejected: number;
    expired: number;
    cancelled: number;
  };
  subscriptionsByPlan: Array<{
    plan_id: string;
    plan_name: string;
    plan_slug: string;
    active_count: number;
  }>;
  revenue: {
    currency: 'INR';
    collected_actual_inr: number;
    collected_actual_count: number;
    simulated_inr: number;
    simulated_count: number;
    has_actual_payments: boolean;
  };
  storage: {
    total_bytes: number;
    total_objects: number;
    s3_bytes: number;
    s3_objects: number;
    local_private_bytes: number;
    local_private_objects: number;
  };
  trends: {
    agreements: Array<{ date: string; created_count: number; completed_count: number }>;
    tenants: Array<{ date: string; new_tenants: number }>;
  };
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[idx]}`;
}

export const SuperAdminAnalyticsView: React.FC = () => {
  const { addToast } = useApp();
  const [data, setData] = useState<PlatformAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presetDays, setPresetDays] = useState<number>(30);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const loadAnalytics = useCallback(
    async (opts?: { from?: string; to?: string; days?: number }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getPlatformAnalytics(
          opts?.from || opts?.to
            ? { from: opts.from || undefined, to: opts.to || undefined }
            : { days: opts?.days ?? presetDays },
        );
        setData(res);
      } catch (err: any) {
        const msg = err.message || 'Could not load platform analytics.';
        setError(msg);
        addToast('Analytics Error', msg, 'error');
      } finally {
        setLoading(false);
      }
    },
    [presetDays, addToast],
  );

  useEffect(() => {
    loadAnalytics({ days: presetDays });
  }, [presetDays]);

  const handleCustomFilter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromDate && !toDate) {
      loadAnalytics({ days: presetDays });
      return;
    }
    loadAnalytics({ from: fromDate, to: toDate });
  };

  const maxAgreementDay = Math.max(
    1,
    ...(data?.trends.agreements.map((d) => d.created_count) ?? [0]),
  );
  const maxTenantDay = Math.max(
    1,
    ...(data?.trends.tenants.map((d) => d.new_tenants) ?? [0]),
  );

  return (
    <div className="space-y-6">
      {/* Header & Date Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Platform Usage Analytics
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Platform Owner cross-tenant operational metrics, storage, and verified payment totals
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setPresetDays(d);
                }}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  !fromDate && !toDate && presetDays === d
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <form onSubmit={handleCustomFilter} className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
            >
              Apply
            </button>
          </form>

          <button
            type="button"
            onClick={() => loadAnalytics({ from: fromDate, to: toDate, days: presetDays })}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => loadAnalytics({ from: fromDate, to: toDate, days: presetDays })}
            className="font-semibold underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
            />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Registered Tenants</span>
                <Building2 size={15} className="text-brand-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {data.tenants.total}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {data.tenants.active} active · {data.tenants.suspended} suspended · {data.tenants.archived} archived
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Registered Users</span>
                <Users size={15} className="text-indigo-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {data.users.total}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {data.users.active} active accounts
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Agreements ({data.range.days}d)</span>
                <FileSignature size={15} className="text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {data.agreements.total}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {data.agreements.completed} completed · {data.agreements.pending} pending
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Collected Revenue</span>
                <IndianRupee size={15} className="text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                ₹{data.revenue.collected_actual_inr.toLocaleString('en-IN')}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {data.revenue.has_actual_payments
                  ? `${data.revenue.collected_actual_count} verified payment(s)`
                  : 'No live gateway payments recorded'}
                {data.revenue.simulated_count > 0 && (
                  <span className="block text-amber-600 dark:text-amber-400">
                    Simulated (excluded): ₹{data.revenue.simulated_inr.toLocaleString('en-IN')} ({data.revenue.simulated_count})
                  </span>
                )}
              </div>
            </div>

            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Vault Storage</span>
                <HardDrive size={15} className="text-slate-600 dark:text-slate-300" />
              </div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {formatBytes(data.storage.total_bytes)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {data.storage.total_objects} objects · R2/S3: {formatBytes(data.storage.s3_bytes)}
              </div>
            </div>
          </div>

          {/* Agreement Status Breakdown & Active Subscriptions by Plan */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Agreement Status Breakdown
                </h3>
                <span className="text-xs text-slate-400">{data.agreements.total} in range</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                {[
                  { label: 'Draft', val: data.agreements.draft },
                  { label: 'Pending', val: data.agreements.pending },
                  { label: 'Completed', val: data.agreements.completed },
                  { label: 'Rejected', val: data.agreements.rejected },
                  { label: 'Expired', val: data.agreements.expired },
                  { label: 'Cancelled', val: data.agreements.cancelled },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                  >
                    <div className="text-slate-500 dark:text-slate-400">{item.label}</div>
                    <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                      {item.val}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={15} className="text-brand-600" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Active Subscriptions by Plan
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">Counts only (not collected revenue)</span>
              </div>
              {data.subscriptionsByPlan.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  No subscription plans found.
                </p>
              ) : (
                <div className="space-y-3 text-xs">
                  {data.subscriptionsByPlan.map((plan) => (
                    <div
                      key={plan.plan_id}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {plan.plan_name}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        {plan.active_count} active
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Trend Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-brand-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Agreement Creation Trend
                </h3>
              </div>
              {data.trends.agreements.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  No agreement activity recorded in the selected date range.
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  {data.trends.agreements.map((pt) => (
                    <div key={pt.date} className="flex items-center gap-3">
                      <span className="w-24 font-mono text-[11px] text-slate-500">{pt.date}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-brand-600 rounded-full"
                          style={{ width: `${Math.round((pt.created_count / maxAgreementDay) * 100)}%` }}
                        />
                      </div>
                      <span className="w-24 text-right text-slate-700 dark:text-slate-300 font-medium">
                        {pt.created_count} ({pt.completed_count} done)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Tenant Growth Trend
                </h3>
              </div>
              {data.trends.tenants.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  No new tenant registrations recorded in the selected date range.
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  {data.trends.tenants.map((pt) => (
                    <div key={pt.date} className="flex items-center gap-3">
                      <span className="w-24 font-mono text-[11px] text-slate-500">{pt.date}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${Math.round((pt.new_tenants / maxTenantDay) * 100)}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-slate-700 dark:text-slate-300 font-medium">
                        +{pt.new_tenants}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
