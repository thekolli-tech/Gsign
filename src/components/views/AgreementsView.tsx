import React, { useState } from 'react';
import { 
  Search, 
  Download, 
  Plus, 
  Eye,
  PenTool
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AgreementStatus } from '../../types';

export const AgreementsView: React.FC = () => {
  const { 
    agreements, 
    setSelectedAgreementId, 
    setActiveView, 
    setNewAgreementModalOpen,
    setRecipientModalOpen,
    setSigningAgreement,
    addToast
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [deptFilter, setDeptFilter] = useState<string>('All');

  const filteredAgreements = agreements.filter(ag => {
    const matchesSearch = 
      ag.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ag.recipientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ag.templateType.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'All' || ag.status === statusFilter;
    const matchesType = typeFilter === 'All' || ag.templateType === typeFilter;
    const matchesDept = deptFilter === 'All' || ag.department === deptFilter;

    return matchesSearch && matchesStatus && matchesType && matchesDept;
  });

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
        return <span>{status}</span>;
    }
  };

  const handleExportCSV = () => {
    const csvContent = 
      "data:text/csv;charset=utf-8," + 
      ["Number,Party,Type,Status,Department,FeeAmount,Period,DocumentHash"]
        .concat(filteredAgreements.map(a => `${a.id},"${a.recipientName}","${a.templateType}",${a.status},${a.department},${a.feeAmount},"${a.period}",${a.documentHash}`))
        .join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `GSIGN_Agreements_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('Export Complete', 'Agreements exported as CSV.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Top action row with Export & New agreement */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Agreements
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            All agreements across departments
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle"
          >
            <Download size={13} />
            <span>Export</span>
          </button>

          <button
            onClick={() => setNewAgreementModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
          >
            <Plus size={14} />
            <span>+ New agreement</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar matching Screenshot Pages 5 & 19 */}
      <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center gap-2.5 shadow-card">
        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search number, party"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-brand-600 text-slate-800 dark:text-slate-100"
          />
        </div>

        {/* Status filter button */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter agreements by status"
          className="px-2.5 py-1.5 text-xs font-normal rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:border-brand-600 cursor-pointer"
        >
          <option value="All">Status</option>
          <option value="Completed">Completed</option>
          <option value="Awaiting OTP">Awaiting OTP</option>
          <option value="Awaiting signature">Awaiting signature</option>
          <option value="Expired">Expired</option>
          <option value="Rejected">Rejected</option>
          <option value="Cancelled">Cancelled</option>
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          aria-label="Filter agreements by document type"
          className="px-2.5 py-1.5 text-xs font-normal rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:border-brand-600 cursor-pointer"
        >
          <option value="All">Type</option>
          <option value="Offer Letter">Offer Letter</option>
          <option value="NDA">NDA</option>
          <option value="Vendor Agreement">Vendor Agreement</option>
          <option value="Franchise Agreement">Franchise Agreement</option>
          <option value="Service Contract">Service Contract</option>
        </select>

        {/* Department filter */}
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          aria-label="Filter agreements by department"
          className="px-2.5 py-1.5 text-xs font-normal rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:border-brand-600 cursor-pointer"
        >
          <option value="All">Department</option>
          <option value="HR">HR</option>
          <option value="Legal">Legal</option>
          <option value="Ops">Ops</option>
          <option value="Sales">Sales</option>
        </select>
      </div>

      {/* Agreements Table */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-3 px-6 font-medium">Number</th>
                <th className="py-3 px-6 font-medium">Party</th>
                <th className="py-3 px-6 font-medium">Type</th>
                <th className="py-3 px-6 font-medium">Status</th>
                <th className="py-3 px-6 font-medium">Department</th>
                <th className="py-3 px-6 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
              {filteredAgreements.map(ag => (
                <tr
                  key={ag.id}
                  onClick={() => {
                    setSelectedAgreementId(ag.id);
                    setActiveView('agreement_detail');
                  }}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
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
                  <td className="py-3.5 px-6 text-slate-600 dark:text-slate-300">
                    {ag.department}
                  </td>
                  <td className="py-3.5 px-6 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {ag.status !== 'Completed' && (
                        <button
                          onClick={() => {
                            setSigningAgreement(ag);
                            setRecipientModalOpen(true);
                          }}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/40 border border-brand-200 dark:border-brand-800/50 flex items-center gap-1 transition-colors"
                        >
                          <PenTool size={11} />
                          Sign
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSelectedAgreementId(ag.id);
                          setActiveView('agreement_detail');
                        }}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        title="View Details"
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

        {filteredAgreements.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-xs">
            No agreements match your criteria.
          </div>
        )}
      </div>
    </div>
  );
};
