import React, { useState } from 'react';
import { 
  Plus, 
  Printer, 
  ShieldCheck, 
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const DocumentsReceiptsView: React.FC = () => {
  const { receipts, acknowledgePayment, addToast } = useApp();

  const [selectedReceiptId, setSelectedReceiptId] = useState<string>('RCT-0091');
  const [modalOpen, setModalOpen] = useState(false);
  const [ackPayer, setAckPayer] = useState('Meera Iyer');
  const [ackRef, setAckRef] = useState('UPI-202611259981');
  const [ackMode, setAckMode] = useState<'UPI' | 'Bank transfer'>('UPI');

  const selectedReceipt = receipts.find(r => r.id === selectedReceiptId) || receipts[0];

  const handleAcknowledgeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    acknowledgePayment('RCT-PENDING', ackRef);
    setModalOpen(false);
    setSelectedReceiptId('RCT-0092');
  };

  const handlePrintReceipt = () => {
    window.print();
    addToast('Print Triggered', 'Receipt voucher sent to printer queue.', 'info');
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar matching pages 7 & 21 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Documents & Receipts
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Receipts are issued only after confirmed payment
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
        >
          <Plus size={14} />
          <span>Acknowledge payment</span>
        </button>
      </div>

      {/* Main Grid: Left Table, Right Voucher Card matching screenshots 7 & 21 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Receipts Table ~ 7 cols */}
        <div className="lg:col-span-7">
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                    <th className="py-3 px-6 font-medium">Receipt</th>
                    <th className="py-3 px-6 font-medium">Payer</th>
                    <th className="py-3 px-6 font-medium">Amount</th>
                    <th className="py-3 px-6 font-medium">Mode</th>
                    <th className="py-3 px-6 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
                  {receipts.map((r, idx) => (
                    <tr
                      key={r.id || idx}
                      onClick={() => setSelectedReceiptId(r.id)}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${
                        selectedReceiptId === r.id ? 'bg-slate-50 dark:bg-slate-800/60' : ''
                      }`}
                    >
                      <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-white">
                        {r.id === 'RCT-PENDING' ? '—' : r.id}
                      </td>
                      <td className="py-3.5 px-6 text-slate-700 dark:text-slate-200">
                        {r.payer}
                      </td>
                      <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-white">
                        ₹{r.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-6 text-slate-500 dark:text-slate-400">
                        {r.mode}
                      </td>
                      <td className="py-3.5 px-6">
                        {r.status === 'Issued' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                            Issued
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                            Payment not confirmed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Receipt Voucher Card matching pages 7 & 21 ~ 5 cols */}
        <div className="lg:col-span-5">
          <div className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Receipt {selectedReceipt.id === 'RCT-PENDING' ? 'Pending' : selectedReceipt.id}
                </h3>
              </div>
              <button
                onClick={handlePrintReceipt}
                title="Print Voucher"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <Printer size={15} />
              </button>
            </div>

            {/* Receipt Details matching screenshot layout */}
            <div className="space-y-3 text-xs leading-relaxed">
              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">Payer:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{selectedReceipt.payer}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">Amount:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  ₹{selectedReceipt.amount.toLocaleString('en-IN')}
                </span>
              </div>

              <div className="flex flex-col py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">In words:</span>
                <span className="text-slate-700 dark:text-slate-300 italic mt-0.5">
                  {selectedReceipt.amountInWords}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">Date:</span>
                <span className="text-slate-700 dark:text-slate-300 font-mono">{selectedReceipt.date}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">Mode:</span>
                <span className="text-slate-700 dark:text-slate-300">
                  {selectedReceipt.mode} · Ref: [{selectedReceipt.txRef}]
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500 dark:text-slate-400">Purpose:</span>
                <span className="text-slate-700 dark:text-slate-300">{selectedReceipt.purpose}</span>
              </div>

              <div className="flex justify-between py-1">
                <span className="text-slate-500 dark:text-slate-400">Acknowledged by:</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {selectedReceipt.acknowledgedBy}
                </span>
              </div>
            </div>

            {/* Verification Stamp / Seal */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <ShieldCheck size={14} className="text-emerald-500" />
                <span className="text-[11px] font-medium">Verified Payment Token</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                GSIGN-AUTH-88910
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Acknowledge Payment Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Acknowledge Payment
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleAcknowledgeSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Select Pending Payer
                </label>
                <select
                  value={ackPayer}
                  onChange={e => setAckPayer(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                >
                  <option value="Meera Iyer">Meera Iyer (₹30,000 · Advisory Retainer)</option>
                  <option value="Dev Patel">Dev Patel (₹85,000 · Service Contract)</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Payment Mode
                </label>
                <select
                  value={ackMode}
                  onChange={e => setAckMode(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                >
                  <option value="UPI">UPI</option>
                  <option value="Bank transfer">Bank transfer / NEFT</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Transaction Reference (UTR / UPI Ref)
                </label>
                <input
                  type="text"
                  required
                  value={ackRef}
                  onChange={e => setAckRef(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 font-mono outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 font-medium shadow-subtle"
                >
                  Confirm & Issue Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
