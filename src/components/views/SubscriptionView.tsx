import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Check,
  CreditCard,
  FileText,
  Users,
  HardDrive,
  RefreshCw,
  AlertCircle,
  Receipt,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

interface PlanRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  monthly_price: number | string;
  annual_price: number | string;
  max_agreements_per_month: number;
  max_users: number;
  features?: string[];
}

interface CurrentSubscription {
  has_subscription: boolean;
  status: string;
  billing_cycle?: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_period_end?: string | null;
  plan_name?: string;
  plan_slug?: string;
  message?: string;
}

interface SubscriptionUsage {
  is_platform_owner?: boolean;
  exempt_from_quotas?: boolean;
  has_subscription: boolean;
  plan_name?: string;
  plan_slug?: string;
  status?: string;
  billing_cycle?: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  grace_period_end?: string | null;
  period_start?: string;
  period_end?: string;
  agreements_created?: number;
  agreements_completed?: number;
  max_agreements_per_month?: number;
  remaining_agreements?: number | null;
  active_users?: number;
  pending_invitations?: number;
  max_users?: number;
  remaining_users?: number | null;
  storage_bytes_used?: number;
  storage_allowance_bytes?: number | null;
  message?: string;
}

interface InvoiceRecord {
  id: string;
  invoice_number: string;
  amount: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  status: string;
  created_at: string;
}

interface PaymentHistoryRecord {
  id: string;
  amount: number | string;
  currency: string;
  provider: string;
  provider_transaction_id?: string | null;
  status: string;
  payment_method?: string | null;
  verified_at?: string | null;
  created_at: string;
  is_simulated?: boolean;
  plan_name?: string | null;
  invoice_number?: string | null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatInr(value: number | string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '₹0';
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const SubscriptionView: React.FC = () => {
  const { addToast } = useApp();
  const billingSectionRef = useRef<HTMLDivElement | null>(null);

  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [currentSub, setCurrentSub] = useState<CurrentSubscription | null>(null);
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryRecord[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<'invoices' | 'payments'>('invoices');
  const [nowMs] = useState(() => Date.now());

  const loadSubscriptionData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBillingError(null);
    try {
      const [plansRes, currentRes, usageRes] = await Promise.all([
        api.getSubscriptionPlans(),
        api.getCurrentSubscription(),
        api.getSubscriptionUsage(),
      ]);
      setPlans(Array.isArray(plansRes) ? plansRes : []);
      setCurrentSub(currentRes);
      setUsage(usageRes);

      try {
        const [invRes, histRes] = await Promise.all([
          api.getInvoices(),
          api.getPaymentHistory(1, 20),
        ]);
        setInvoices(Array.isArray(invRes) ? invRes : []);
        setPaymentHistory(Array.isArray(histRes?.items) ? histRes.items : []);
      } catch (billErr: any) {
        setBillingError(billErr?.message || 'Unable to load billing history.');
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load subscription details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscriptionData();
  }, [loadSubscriptionData]);

  const handlePlanRequest = (plan: PlanRecord) => {
    if (currentSub?.has_subscription && currentSub.plan_slug === plan.slug) {
      return;
    }
    addToast(
      'Plan Change Request',
      `Upgrades or transitions to ${plan.name} require authorized billing processing by GSIGN Platform Administration.`,
      'info',
    );
  };

  const scrollToBilling = () => {
    billingSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const activePlanName = currentSub?.has_subscription
    ? currentSub.plan_name
    : usage?.has_subscription
    ? usage.plan_name
    : null;
  const activeStatus = currentSub?.status || usage?.status || null;
  const billingCycle = currentSub?.billing_cycle || usage?.billing_cycle || null;
  const rawPeriodEnd = currentSub?.current_period_end || usage?.current_period_end || null;
  const rawGraceEnd = currentSub?.grace_period_end || usage?.grace_period_end || null;
  const periodStart = formatDate(currentSub?.current_period_start || usage?.current_period_start);
  const periodEnd = formatDate(rawPeriodEnd);
  const graceEnd = formatDate(rawGraceEnd);

  const periodEndValid = rawPeriodEnd ? new Date(rawPeriodEnd).getTime() >= nowMs : true;
  const graceEndValid = rawGraceEnd ? new Date(rawGraceEnd).getTime() > nowMs : false;

  const isEntitled = Boolean(
    usage?.exempt_from_quotas ||
      (activeStatus === 'ACTIVE' && (periodEndValid || graceEndValid)) ||
      (activeStatus === 'PAST_DUE' && graceEndValid) ||
      (activeStatus === 'CANCELLED' && rawPeriodEnd !== null && new Date(rawPeriodEnd).getTime() > nowMs),
  );

  const inactiveNotice =
    !isEntitled && activeStatus
      ? activeStatus === 'EXPIRED'
        ? 'Your subscription has expired. Workspace entitlements are inactive until renewed.'
        : activeStatus === 'SUSPENDED'
        ? 'Your workspace subscription has been suspended by platform administration.'
        : activeStatus === 'CANCELLED'
        ? 'Your subscription was cancelled and its pre-paid billing period has concluded.'
        : activeStatus === 'PAST_DUE'
        ? 'Your subscription payment is overdue and the grace period has lapsed.'
        : activeStatus === 'PENDING' || activeStatus === 'PAYMENT_PENDING'
        ? 'Your subscription is awaiting payment verification and is not yet active.'
        : `Subscription status is '${activeStatus}'. Active paid entitlement is required.`
      : null;

  const docsCount = usage?.agreements_created ?? 0;
  const docsMax = usage?.max_agreements_per_month ?? 0;
  const docsUnlimited = docsMax === -1;
  const docsPct = !docsUnlimited && docsMax > 0 ? Math.min(100, Math.round((docsCount / docsMax) * 100)) : 0;

  const activeUsers = usage?.active_users ?? 0;
  const pendingInvites = usage?.pending_invitations ?? 0;
  const usersCount = activeUsers + pendingInvites;
  const usersMax = usage?.max_users ?? 0;
  const usersUnlimited = usersMax === -1;
  const usersPct = !usersUnlimited && usersMax > 0 ? Math.min(100, Math.round((usersCount / usersMax) * 100)) : 0;

  const storageBytes = usage?.storage_bytes_used ?? 0;
  const storageAllowance = usage?.storage_allowance_bytes ?? null;
  const storagePct =
    storageAllowance && storageAllowance > 0
      ? Math.min(100, Math.round((storageBytes / storageAllowance) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Subscription
            </h2>
            {!loading && activeStatus && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${
                  activeStatus === 'ACTIVE' && isEntitled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                    : activeStatus === 'EXEMPT'
                    ? 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:border-brand-800'
                    : isEntitled
                    ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                    : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                }`}
              >
                {activeStatus}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {loading
              ? 'Loading subscription details...'
              : usage?.exempt_from_quotas
              ? 'Platform Owner · exempt from workspace quotas'
              : activePlanName
              ? `${activePlanName}${billingCycle ? ` · ${billingCycle} billing` : ''}${
                  activeStatus === 'CANCELLED' && isEntitled && periodEnd
                    ? ` · Cancelled (access active until ${periodEnd})`
                    : activeStatus === 'PAST_DUE' && isEntitled && graceEnd
                    ? ` · Past due (grace period ends ${graceEnd})`
                    : periodStart && periodEnd
                    ? ` · Period: ${periodStart} – ${periodEnd}`
                    : periodEnd
                    ? ` · Period ends ${periodEnd}`
                    : ''
                }`
              : 'No active subscription record found'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadSubscriptionData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            onClick={scrollToBilling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle"
          >
            <CreditCard size={13} />
            <span>Billing History</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
          <span className="flex items-center gap-2">
            <AlertCircle size={15} />
            {error}
          </span>
          <button
            onClick={loadSubscriptionData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 font-medium"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {/* Available Plan Tiers */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-52 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
            />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          No subscription plans are currently available.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p) => {
              const isCurrent = Boolean(
                currentSub?.has_subscription && currentSub.plan_slug === p.slug,
              );
              const isCustomZero = p.slug === 'enterprise' && Number(p.monthly_price) === 0;
              const docsLabel =
                p.max_agreements_per_month === -1
                  ? 'Unlimited docs'
                  : `${p.max_agreements_per_month} docs/mo`;
              const usersLabel =
                p.max_users === -1 ? 'Unlimited users' : `${p.max_users} users`;
              const featureList = Array.isArray(p.features) ? p.features : [];

              return (
                <div
                  key={p.id}
                  onClick={() => handlePlanRequest(p)}
                  className={`p-5 rounded-xl transition-all flex flex-col justify-between ${
                    isCurrent
                      ? 'bg-white dark:bg-slate-900 border-2 border-brand-600 dark:border-brand-500 shadow-card'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-card cursor-pointer'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        {p.name}
                      </span>
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
                          Current
                        </span>
                      )}
                    </div>

                    <div className="mt-3">
                      <span className="text-xl font-bold text-slate-900 dark:text-white">
                        {isCustomZero ? 'Custom' : `${formatInr(p.monthly_price)}/mo`}
                      </span>
                      {!isCustomZero && Number(p.annual_price) > 0 && (
                        <span className="ml-1.5 text-[11px] text-slate-400">
                          ({formatInr(p.annual_price)}/yr)
                        </span>
                      )}
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {docsLabel} · {usersLabel}
                      </p>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      {featureList.map((d, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-400"
                        >
                          <Check
                            size={12}
                            className="text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5"
                          />
                          <span>{d}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {!isCurrent && (
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] font-medium text-brand-600 dark:text-brand-400">
                      Requires authorized billing activation
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Info size={12} />
            Plan changes and activations are processed exclusively through authorized billing verification or GSIGN Platform Administration.
          </p>
        </div>
      )}

      {/* Usage Progress Metrics Card */}
      <div className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Active Plan Consumption
          </h3>
          {usage?.period_start && usage?.period_end && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              UTC Cycle: {String(usage.period_start).slice(0, 10)} – {String(usage.period_end).slice(0, 10)}
            </span>
          )}
        </div>

        {loading ? (
          <div className="py-6 text-xs text-slate-500 dark:text-slate-400">
            Loading live workspace usage...
          </div>
        ) : usage?.exempt_from_quotas ? (
          <div className="py-4 text-xs text-slate-600 dark:text-slate-300">
            {usage.message || 'Platform Owner is exempt from tenant subscription and quota restrictions.'}
          </div>
        ) : !usage?.has_subscription ? (
          <div className="py-4 text-xs text-slate-600 dark:text-slate-300">
            No active subscription found for this workspace. Contact your administrator or Platform Owner to activate a plan.
          </div>
        ) : !isEntitled ? (
          <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 space-y-1">
            <div className="font-semibold">Subscription Inactive ({activeStatus})</div>
            <div>{inactiveNotice}</div>
          </div>
        ) : (
          <div className="space-y-5 max-w-xl">
            {/* Documents */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
                <span className="font-medium flex items-center gap-1.5">
                  <FileText size={13} className="text-slate-400" />
                  Documents · {docsCount} / {docsUnlimited ? 'Unlimited' : docsMax}
                </span>
                <span className="font-mono text-slate-500">
                  {docsUnlimited ? 'Unlimited' : `${docsPct}%`}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-all"
                  style={{ width: `${docsUnlimited ? 100 : docsPct}%` }}
                />
              </div>
            </div>

            {/* Users */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
                <span className="font-medium flex items-center gap-1.5">
                  <Users size={13} className="text-slate-400" />
                  Users · {usersCount} / {usersUnlimited ? 'Unlimited' : usersMax}
                  {pendingInvites > 0 && (
                    <span className="text-[11px] text-slate-400">
                      ({activeUsers} active + {pendingInvites} pending)
                    </span>
                  )}
                </span>
                <span className="font-mono text-slate-500">
                  {usersUnlimited ? 'Unlimited' : `${usersPct}%`}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-all"
                  style={{ width: `${usersUnlimited ? 100 : usersPct}%` }}
                />
              </div>
            </div>

            {/* Storage */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-700 dark:text-slate-300">
                <span className="font-medium flex items-center gap-1.5">
                  <HardDrive size={13} className="text-slate-400" />
                  Storage · {formatBytes(storageBytes)}
                  {storageAllowance ? ` / ${formatBytes(storageAllowance)}` : ' (no plan cap)'}
                </span>
                <span className="font-mono text-slate-500">
                  {storageAllowance ? `${storagePct}%` : 'Tracked'}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-brand-600 rounded-full transition-all"
                  style={{ width: `${storageAllowance ? storagePct : storageBytes > 0 ? 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Billing & Invoice History */}
      <div
        ref={billingSectionRef}
        className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden"
      >
        <div className="p-5 sm:px-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt size={15} className="text-brand-600 dark:text-brand-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Billing & Invoice History
            </h3>
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
            <button
              onClick={() => setHistoryTab('invoices')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                historyTab === 'invoices'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Invoices ({invoices.length})
            </button>
            <button
              onClick={() => setHistoryTab('payments')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                historyTab === 'payments'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Payments ({paymentHistory.length})
            </button>
          </div>
        </div>

        {billingError ? (
          <div className="p-6 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between">
            <span>{billingError}</span>
            <button
              onClick={loadSubscriptionData}
              className="px-2.5 py-1 rounded border border-rose-200 dark:border-rose-800 font-medium"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
            Loading billing history...
          </div>
        ) : historyTab === 'invoices' ? (
          invoices.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
              No invoices have been issued for this workspace yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                    <th className="py-3 px-6">Invoice</th>
                    <th className="py-3 px-6">Date</th>
                    <th className="py-3 px-6">Amount</th>
                    <th className="py-3 px-6">Tax</th>
                    <th className="py-3 px-6">Total</th>
                    <th className="py-3 px-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-6 font-mono font-medium text-slate-900 dark:text-white">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3 px-6 text-slate-500 dark:text-slate-400">
                        {formatDate(inv.created_at) || '—'}
                      </td>
                      <td className="py-3 px-6 font-mono text-slate-700 dark:text-slate-300">
                        {formatInr(inv.amount)}
                      </td>
                      <td className="py-3 px-6 font-mono text-slate-500 dark:text-slate-400">
                        {formatInr(inv.tax_amount)}
                      </td>
                      <td className="py-3 px-6 font-mono font-semibold text-slate-900 dark:text-white">
                        {formatInr(inv.total_amount)}
                      </td>
                      <td className="py-3 px-6">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : paymentHistory.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
            No payment transactions recorded for this workspace yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                  <th className="py-3 px-6">Date</th>
                  <th className="py-3 px-6">Plan / Invoice</th>
                  <th className="py-3 px-6">Amount</th>
                  <th className="py-3 px-6">Method</th>
                  <th className="py-3 px-6">Reference</th>
                  <th className="py-3 px-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {paymentHistory.map((tx) => {
                  const isSim = Boolean(tx.is_simulated || tx.provider === 'SIMULATED');
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-6 text-slate-500 dark:text-slate-400">
                        {formatDate(tx.created_at) || '—'}
                      </td>
                      <td className="py-3 px-6 text-slate-800 dark:text-slate-200">
                        <div className="font-medium">{tx.plan_name || 'Subscription'}</div>
                        {tx.invoice_number && (
                          <div className="text-[11px] font-mono text-slate-400">
                            {tx.invoice_number}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-6 font-mono font-semibold text-slate-900 dark:text-white">
                        {tx.currency === 'INR' ? formatInr(tx.amount) : `${tx.currency} ${tx.amount}`}
                      </td>
                      <td className="py-3 px-6 text-slate-600 dark:text-slate-300">
                        <span>{tx.payment_method || tx.provider}</span>
                        {isSim && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                            Simulated
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-6 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {tx.provider_transaction_id || '—'}
                      </td>
                      <td className="py-3 px-6">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
