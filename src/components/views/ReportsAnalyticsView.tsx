import React from 'react';
import { 
  Clock, 
  CheckCircle2, 
  BarChart3, 
  ShieldCheck
} from 'lucide-react';

export const ReportsAnalyticsView: React.FC = () => {
  const metrics = [
    { label: 'Avg Sign Turnaround', value: '1 hr 14 min', change: '-28% from last month', icon: <Clock size={15} className="text-brand-600" /> },
    { label: 'Verification Rate', value: '98.4%', change: '+2.1% OTP success', icon: <CheckCircle2 size={15} className="text-emerald-600" /> },
    { label: 'Total Volume', value: '110 docs', change: 'Current billing period', icon: <BarChart3 size={15} className="text-slate-600" /> },
    { label: 'Compliance Health', value: '100% SHA-256', change: 'Zero tamper anomalies', icon: <ShieldCheck size={15} className="text-emerald-600" /> },
  ];

  const deptData = [
    { name: 'HR Department', count: 48, pct: 44, color: 'bg-brand-600' },
    { name: 'Legal & Risk', count: 28, pct: 25, color: 'bg-slate-700 dark:bg-slate-500' },
    { name: 'Operations', count: 21, pct: 19, color: 'bg-emerald-600' },
    { name: 'Sales & Franchise', count: 13, pct: 12, color: 'bg-amber-600' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Reports & Analytics
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Turnaround time, compliance & signature velocity metrics
        </p>
      </div>

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

      {/* Department Breakdown & Velocity Chart Simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Department Distribution ~ 6 cols */}
        <div className="lg:col-span-6 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Agreements by Department
            </h3>
            <span className="text-xs text-slate-400">Monthly Share</span>
          </div>

          <div className="space-y-3.5">
            {deptData.map(d => (
              <div key={d.name} className="space-y-1 text-xs">
                <div className="flex justify-between font-normal text-slate-700 dark:text-slate-300">
                  <span>{d.name}</span>
                  <span className="font-mono text-slate-500">{d.count} docs ({d.pct}%)</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className={`h-full rounded-full ${d.color}`} style={{ width: `${d.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Signature Turnaround Visualizer ~ 6 cols */}
        <div className="lg:col-span-6 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
              Signature Funnel
            </h3>
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-medium">92% Completion</span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center pt-1">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">Sent</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block">100%</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">Opened</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block">97%</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">OTP OK</span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-1 block">95%</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 block">Signed</span>
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">92%</span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border border-slate-100 dark:border-slate-800">
            Average time-to-sign across mobile signers is 1 hour 14 minutes. 89% of agreements execute within 24 hours of issuance.
          </div>
        </div>
      </div>
    </div>
  );
};
