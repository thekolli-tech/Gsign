import React, { useEffect, useState } from 'react';
import { ShieldAlert, Plus, XCircle } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

export const SuperAdminSupportView: React.FC = () => {
  const { tenants, addToast } = useApp();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await api.getSupportAccessSessions();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('Load Failed', err.message || 'Could not load support access sessions.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    if (!tenantId && tenants.length > 0) {
      setTenantId(tenants[0].id);
    }
  }, [tenants]);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !reason.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.grantSupportAccess({
        tenant_id: tenantId,
        reason: reason.trim(),
        duration_minutes: durationMinutes,
      });
      setReason('');
      await loadSessions();
      addToast('Support Access Granted', 'Time-boxed support session recorded in audit logs.', 'success');
    } catch (err: any) {
      addToast('Grant Failed', err.message || 'Could not grant support access.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeSupportAccess(id);
      await loadSessions();
      addToast('Session Revoked', 'Support access session terminated immediately.', 'info');
    } catch (err: any) {
      addToast('Revoke Failed', err.message || 'Could not revoke session.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Support Access
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          All support sessions are time-boxed, explicitly authorized, and recorded in immutable audit logs
        </p>
      </div>

      {/* Grant Time-Boxed Support Session */}
      <form
        onSubmit={handleGrant}
        className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card grid grid-cols-1 md:grid-cols-12 gap-3 items-end text-xs"
      >
        <div className="md:col-span-3">
          <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
            Target Tenant
          </label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 outline-none"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.company}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-5">
          <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
            Audit Reason (Required)
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Ticket #1042 — troubleshoot template sync"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
          />
        </div>

        <div className="md:col-span-2">
          <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
            Duration
          </label>
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 outline-none"
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={submitting || !tenantId}
            className="w-full px-3.5 py-2 rounded-lg text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 font-medium flex items-center justify-center gap-1.5"
          >
            <Plus size={13} />
            <span>{submitting ? 'Logging...' : 'Grant Access'}</span>
          </button>
        </div>
      </form>

      {/* Sessions Table */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-3 px-5 font-medium">Tenant</th>
                <th className="py-3 px-5 font-medium">Operator</th>
                <th className="py-3 px-5 font-medium">Reason</th>
                <th className="py-3 px-5 font-medium">Status</th>
                <th className="py-3 px-5 font-medium">Expires</th>
                <th className="py-3 px-5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 px-5 text-center text-slate-400">
                    Loading support sessions...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-5 text-center text-slate-400">
                    <div className="inline-flex items-center gap-1.5">
                      <ShieldAlert size={14} className="text-emerald-500" />
                      <span>Zero active or historical support sessions recorded.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3.5 px-5 font-semibold text-slate-900 dark:text-white">
                      {s.tenant_name}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 dark:text-slate-300">
                      {s.granted_by_email}
                    </td>
                    <td className="py-3.5 px-5 text-slate-600 dark:text-slate-300">
                      {s.reason}
                    </td>
                    <td className="py-3.5 px-5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          s.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/60'
                            : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 font-mono text-slate-500 dark:text-slate-400">
                      {new Date(s.expires_at).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      {s.status === 'Active' ? (
                        <button
                          type="button"
                          onClick={() => handleRevoke(s.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-rose-600 border border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-800/60"
                        >
                          <XCircle size={12} />
                          <span>Revoke</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
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
