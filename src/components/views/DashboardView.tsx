import React from 'react';
import { 
  ArrowUpRight, 
  Eye, 
  PenTool, 
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AgreementStatus } from '../../types';

export const DashboardView: React.FC = () => {
  const { 
    agreements, 
    setSelectedAgreementId, 
    setActiveView, 
    setRecipientModalOpen, 
    setSigningAgreement,
  } = useApp();

  // Real-time stat counts from live workspace agreements
  const statCards = [
    { label: 'Draft', count: agreements.filter(a => a.status === 'Draft').length },
    { label: 'Sent', count: agreements.filter(a => a.status !== 'Draft').length },
    {
      label: 'Pending signature',
      count: agreements.filter(a =>
        ['Awaiting OTP', 'Awaiting signature', 'Partially signed', 'Finalizing'].includes(a.status)
      ).length,
    },
    { label: 'Completed', count: agreements.filter(a => a.status === 'Completed').length },
    {
      label: 'Expired/Rejected',
      count: agreements.filter(a => ['Expired', 'Rejected', 'Cancelled'].includes(a.status)).length,
    },
  ];

  const getStatusBadge = (status: AgreementStatus) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            Completed
          </span>
        );
      case 'Awaiting OTP':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            Awaiting OTP
          </span>
        );
      case 'Awaiting signature':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            Awaiting signature
          </span>
        );
      case 'Expired':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            Expired
          </span>
        );
      case 'Rejected':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
            Rejected
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {status}
          </span>
        );
    }
  };

  const handleRowClick = (agId: string) => {
    setSelectedAgreementId(agId);
    setActiveView('agreement_detail');
  };

  const handleSignDirect = (e: React.MouseEvent, ag: any) => {
    e.stopPropagation();
    setSigningAgreement(ag);
    setRecipientModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 5 Clean Stat Cards matching UI Wireframe Pages 1 & 15 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map((card, idx) => (
          <div
            key={idx}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card"
          >
            <div className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {card.label}
            </div>
            <div className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {card.count}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Agreements Section matching Pages 1 & 15 */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Recent agreements
          </h3>
          <button
            onClick={() => setActiveView('agreements')}
            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-1"
          >
            <span>View all</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        {/* Table matching screenshots */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/60">
                <th className="py-3 px-6 font-medium">Agreement</th>
                <th className="py-3 px-6 font-medium">Recipient</th>
                <th className="py-3 px-6 font-medium">Template</th>
                <th className="py-3 px-6 font-medium">Status</th>
                <th className="py-3 px-6 font-medium">Updated</th>
                <th className="py-3 px-6 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-normal">
              {agreements.slice(0, 5).map(ag => (
                <tr
                  key={ag.id}
                  onClick={() => handleRowClick(ag.id)}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                >
                  <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400">
                    {ag.id}
                  </td>
                  <td className="py-3.5 px-6 text-slate-700 dark:text-slate-200">
                    {ag.recipientName}
                  </td>
                  <td className="py-3.5 px-6 text-slate-600 dark:text-slate-300">
                    {ag.templateType}
                  </td>
                  <td className="py-3.5 px-6">
                    {getStatusBadge(ag.status)}
                  </td>
                  <td className="py-3.5 px-6 text-slate-500 dark:text-slate-400">
                    {ag.updatedAt}
                  </td>
                  <td className="py-3.5 px-6 text-right">
                    <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                      {ag.status !== 'Completed' && (
                        <button
                          onClick={e => handleSignDirect(e, ag)}
                          title="Open Signing Portal"
                          className="px-2 py-1 rounded text-[11px] font-medium bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 border border-brand-200 dark:border-brand-800/60 flex items-center gap-1 transition-colors"
                        >
                          <PenTool size={11} />
                          Sign
                        </button>
                      )}
                      <button
                        onClick={() => handleRowClick(ag.id)}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        title="View Audit & Document"
                      >
                        <Eye size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
