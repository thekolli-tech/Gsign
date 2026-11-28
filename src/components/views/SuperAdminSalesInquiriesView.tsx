import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Inbox, AlertCircle, Save } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

interface SalesInquiry {
  id: string;
  contact_name: string;
  company_name: string;
  business_email: string;
  phone_number?: string | null;
  company_size: string;
  requested_plan: string;
  monthly_agreements?: string | null;
  message?: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'closed';
  assigned_to_email?: string | null;
  internal_notes?: string;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS: Array<{ value: SalesInquiry['status']; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'converted', label: 'Converted' },
  { value: 'closed', label: 'Closed' },
];

export const SuperAdminSalesInquiriesView: React.FC = () => {
  const { addToast } = useApp();
  const [items, setItems] = useState<SalesInquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SalesInquiry | null>(null);
  const [editStatus, setEditStatus] = useState<SalesInquiry['status']>('new');
  const [editAssignee, setEditAssignee] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const hasSelectedRef = React.useRef(false);
  hasSelectedRef.current = Boolean(selected);

  const loadInquiries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPlatformSalesInquiries({
        page,
        limit: 15,
        status: statusFilter,
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      const list = Array.isArray(res?.items) ? res.items : [];
      setItems(list);
      setTotal(Number(res?.total || 0));
      if (list.length > 0 && !hasSelectedRef.current) {
        const first = list[0];
        setSelected(first);
        setEditStatus(first.status);
        setEditAssignee(first.assigned_to_email || '');
        setEditNotes(first.internal_notes || '');
      }
    } catch (err: any) {
      const msg = err.message || 'Could not load sales inquiries.';
      setError(msg);
      addToast('Load Failed', msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, fromDate, toDate, addToast]);

  useEffect(() => {
    void loadInquiries();
  }, [loadInquiries]);

  const handleSelect = (inq: SalesInquiry) => {
    setSelected(inq);
    setEditStatus(inq.status);
    setEditAssignee(inq.assigned_to_email || '');
    setEditNotes(inq.internal_notes || '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    try {
      const updated = await api.updatePlatformSalesInquiry(selected.id, {
        status: editStatus,
        assigned_to_email: editAssignee.trim() || undefined,
        internal_notes: editNotes,
      });
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setSelected(updated);
      addToast('Inquiry Updated', `Status set to ${updated.status}.`, 'success');
    } catch (err: any) {
      addToast('Update Failed', err.message || 'Could not update inquiry.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Enterprise Sales Inquiries
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Platform Owner lead pipeline with audit-logged status, assignment, and confidential notes
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="From date"
            value={fromDate}
            onChange={(e) => {
              setPage(1);
              setFromDate(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
          />
          <input
            type="date"
            aria-label="To date"
            value={toDate}
            onChange={(e) => {
              setPage(1);
              setToDate(e.target.value);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={loadInquiries}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
              <Inbox size={15} className="text-brand-600" />
              <span>Inquiries ({total})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-slate-500">Page {page}</span>
              <button
                type="button"
                disabled={page * 15 >= total}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] bg-slate-50/60 dark:bg-slate-900/40">
                  <th className="py-3 px-4 font-medium">Company</th>
                  <th className="py-3 px-4 font-medium">Contact</th>
                  <th className="py-3 px-4 font-medium">Plan</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      {loading ? 'Loading inquiries...' : 'No enterprise sales inquiries match the current filters.'}
                    </td>
                  </tr>
                ) : (
                  items.map((inq) => (
                    <tr
                      key={inq.id}
                      onClick={() => handleSelect(inq)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                        selected?.id === inq.id ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                        {inq.company_name}
                        <span className="block text-[11px] font-normal text-slate-400">
                          {inq.company_size}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {inq.contact_name}
                        <span className="block text-[11px] text-slate-400">{inq.business_email}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {inq.requested_plan}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize">
                          {inq.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5">
          {!selected ? (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card text-center text-xs text-slate-400">
              Select an inquiry to inspect details, assign an owner, or update internal notes.
            </div>
          ) : (
            <form
              onSubmit={handleSave}
              className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4 text-xs"
            >
              <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {selected.company_name}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {selected.contact_name} · {selected.business_email}
                  {selected.phone_number ? ` · ${selected.phone_number}` : ''}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block">Requested Plan</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {selected.requested_plan}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block">Monthly Agreements</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {selected.monthly_agreements || '—'}
                  </span>
                </div>
              </div>

              {selected.message && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[11px] text-slate-400 block mb-1">Prospect Message</span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{selected.message}</p>
                </div>
              )}

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Inquiry Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as SalesInquiry['status'])}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Assigned Platform Owner / Admin Email
                </label>
                <input
                  type="email"
                  value={editAssignee}
                  onChange={(e) => setEditAssignee(e.target.value)}
                  placeholder="sales@genemax.in"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Confidential Internal Notes
                </label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal qualification notes (never exposed publicly)..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Save size={13} />
                <span>{saving ? 'Saving...' : 'Save Administrative Update'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
