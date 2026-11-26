import React, { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

const DEPT_COLORS = [
  'bg-brand-600',
  'bg-slate-700 dark:bg-slate-500',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-indigo-600',
];

export const ReportsAnalyticsView: React.FC = () => {
  const { agreements } = useApp();
  const [documentsCount, setDocumentsCount] = useState(0);
  const [certificatesCount, setCertificatesCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.getDocuments(), api.getCertificates()])
      .then(([docs, certs]) => {
        if (!active) return;
        setDocumentsCount(docs.length);
        setCertificatesCount(certs.length);
        setLoadError(null);
      })
      .catch((err: any) => {
        if (!active) return;
        setLoadError(err.message || 'Could not load document metrics.');
      });
    return () => {
      active = false;
    };
  }, [agreements.length]);

  const stats = useMemo(() => {
    const total = agreements.length;
    const drafts = agreements.filter((a) => a.status === 'Draft').length;
    const dispatched = agreements.filter((a) => a.status !== 'Draft').length;
    const otpOrBeyond = agreements.filter((a) =>
      ['Awaiting signature', 'Partially signed', 'Finalizing', 'Completed'].includes(a.status),
    ).length;
    const completed = agreements.filter((a) => a.status === 'Completed').length;

    const completedWithDates = agreements.filter(
      (a) => a.status === 'Completed' && a.createdAt && a.updatedAt,
    );
    let avgTurnaround = '—';
    if (completedWithDates.length > 0) {
      const totalMins = completedWithDates.reduce((acc, a) => {
        const diffMs = Math.max(
          0,
          new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return acc + diffMs / 60000;
      }, 0);
      const avgMins = Math.round(totalMins / completedWithDates.length);
      if (avgMins < 60) {
        avgTurnaround = `${avgMins} min`;
      } else {
        const hrs = Math.floor(avgMins / 60);
        const mins = avgMins % 60;
        avgTurnaround = mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
      }
    }

    const completionRate =
      dispatched > 0 ? Math.round((completed / dispatched) * 100) : 0;
    const otpRate =
      dispatched > 0 ? Math.round((otpOrBeyond / dispatched) * 100) : 0;
    const sentPct = total > 0 ? Math.round((dispatched / total) * 100) : 0;

    const deptMap = new Map<string, number>();
    for (const ag of agreements) {
      const dept = ag.department || 'General';
      deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
    }
    const deptData = Array.from(deptMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], idx) => ({
        name,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
        color: DEPT_COLORS[idx % DEPT_COLORS.length],
      }));

    return {
      total,
      drafts,
      dispatched,
      otpOrBeyond,
      completed,
      avgTurnaround,
      completionRate,
      otpRate,
      sentPct,
      deptData,
    };
  }, [agreements]);

  const metrics = [
    {
      label: 'Avg Sign Turnaround',
      value: stats.avgTurnaround,
      change:
        stats.completed > 0
          ? `Across ${stats.completed} completed`
          : 'No completed agreements yet',
      icon: <Clock size={15} className="text-brand-600" />,
    },
    {
      label: 'Verification Rate',
      value: `${stats.otpRate}%`,
      change: `${stats.otpOrBeyond} of ${stats.dispatched} dispatched`,
      icon: <CheckCircle2 size={15} className="text-emerald-600" />,
    },
    {
      label: 'Total Volume',
      value: `${stats.total} docs`,
      change: `${stats.drafts} drafts · ${stats.completed} completed`,
      icon: <BarChart3 size={15} className="text-slate-600" />,
    },
    {
      label: 'Compliance Health',
      value: documentsCount > 0 ? 'SHA-256 Active' : '0 stored docs',
      change: `${documentsCount} vaulted · ${certificatesCount} certificates`,
      icon: <ShieldCheck size={15} className="text-emerald-600" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Reports & Analytics
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Live turnaround time, compliance & signature velocity metrics
        </p>
      </div>

      {loadError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
          {loadError}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, idx) => (
          <div
            key={idx}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card"
          >
            <div className="flex items-center justify-between text-slate-500 text-xs">
              <span className="font-normal">{m.label}</span>
              <div className="p-1 rounded bg-slate-50 dark:bg-slate-800">
                {m.icon}
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">
                {m.value}
              </span>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                {m.change}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Department Breakdown & Live Signature Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Agreements by Department
            </h3>
            <span className="text-xs text-slate-400">Live Share</span>
          </div>

          {stats.deptData.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
              No agreements created in this workspace yet.
            </p>
          ) : (
            <div className="space-y-3.5">
              {stats.deptData.map((d) => (
                <div key={d.name} className="space-y-1 text-xs">
                  <div className="flex justify-between font-normal text-slate-700 dark:text-slate-300">
                    <span>{d.name}</span>
                    <span className="font-mono text-slate-500">
                      {d.count} docs ({d.pct}%)
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${d.color}`}
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Signature Funnel
            </h3>
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-medium">
              {stats.completionRate}% Completion
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center pt-1">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">Total</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block">
                {stats.total}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">Dispatched</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block">
                {stats.sentPct}%
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">OTP OK</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block">
                {stats.otpRate}%
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">Signed</span>
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
                {stats.completionRate}%
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border border-slate-100 dark:border-slate-800">
            {stats.total === 0
              ? 'Create and dispatch agreements to track live turnaround and completion velocity.'
              : `${stats.completed} of ${stats.dispatched} dispatched agreements completed. Average turnaround: ${stats.avgTurnaround}.`}
          </div>
        </div>
      </div>
    </div>
  );
};
