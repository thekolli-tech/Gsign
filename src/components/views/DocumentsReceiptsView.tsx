import React, { useEffect, useState } from 'react';
import { 
  Plus, 
  Printer, 
  ShieldCheck,
  FileText,
  Download,
  Upload,
  Award,
  History,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

export const DocumentsReceiptsView: React.FC = () => {
  const { receipts, acknowledgePayment, addToast } = useApp();

  const [activeTab, setActiveTab] = useState<'documents' | 'receipts'>('documents');
  const [documents, setDocuments] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [selectedDocLogs, setSelectedDocLogs] = useState<{ title: string; logs: any[] } | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const loadDocumentsAndCertificates = async () => {
    setLoadingDocs(true);
    try {
      const [docsRes, certsRes] = await Promise.all([
        api.getDocuments(),
        api.getCertificates(),
      ]);
      setDocuments(docsRes);
      setCertificates(certsRes);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    loadDocumentsAndCertificates();
  }, []);

  const handleUploadStandalone = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingDocs(true);
    try {
      await api.uploadDocument(file, { title: file.name });
      addToast('Document Uploaded', `${file.name} stored securely with SHA-256 hash.`, 'success');
      await loadDocumentsAndCertificates();
    } catch (err: any) {
      addToast('Upload Failed', err.message || 'Could not upload document', 'error');
    } finally {
      setLoadingDocs(false);
      e.target.value = '';
    }
  };

  const handleVerifyIntegrity = async (docId: string, versionId?: string) => {
    try {
      const res = await api.verifyDocumentIntegrity(docId, versionId);
      addToast(
        res.verified ? 'Integrity Verified' : 'Integrity Mismatch',
        `SHA-256 ${res.verified ? 'verified' : 'mismatch'}: ${res.actual_sha256.slice(0, 16)}...`,
        res.verified ? 'success' : 'error',
      );
    } catch (err: any) {
      addToast('Verification Error', err.message || 'Could not verify integrity', 'error');
    }
  };

  const handleViewAccessLogs = async (doc: any) => {
    const logs = await api.getDocumentAuditLogs(doc.id);
    setSelectedDocLogs({ title: doc.title, logs });
  };

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

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('documents')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'documents'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Documents & Certificates
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('receipts')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'receipts'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Payment Receipts
            </button>
          </div>

          {activeTab === 'documents' ? (
            <label className="cursor-pointer flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle">
              <Upload size={14} />
              <span>Upload document</span>
              <input type="file" className="hidden" disabled={loadingDocs} onChange={handleUploadStandalone} />
            </label>
          ) : (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
            >
              <Plus size={14} />
              <span>Acknowledge payment</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'documents' && (
        <div className="space-y-6">
          {/* Completion Certificates / Signing Receipts */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award size={16} className="text-brand-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Signing Completion Certificates
                </h3>
              </div>
              <span className="text-xs text-slate-500">{certificates.length} issued</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] bg-slate-50/60 dark:bg-slate-900/40">
                    <th className="py-3 px-6 font-medium">Certificate #</th>
                    <th className="py-3 px-6 font-medium">Agreement</th>
                    <th className="py-3 px-6 font-medium">Recipient</th>
                    <th className="py-3 px-6 font-medium">Final PDF SHA-256</th>
                    <th className="py-3 px-6 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {certificates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-6 text-center text-slate-500">
                        No completion certificates issued yet. Certificates are generated automatically when all parties sign an agreement.
                      </td>
                    </tr>
                  ) : (
                    certificates.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-white">{c.certificate_number}</td>
                        <td className="py-3.5 px-6 text-slate-700 dark:text-slate-300">{c.agreement_number} · {c.template_type}</td>
                        <td className="py-3.5 px-6 text-slate-600 dark:text-slate-400">{c.recipient_name}</td>
                        <td className="py-3.5 px-6 font-mono text-[11px] text-slate-500">{c.final_pdf_sha256.slice(0, 16)}...</td>
                        <td className="py-3.5 px-6">
                          <a
                            href={api.getDocumentDownloadUrl(c.document_id, c.document_version_id)}
                            className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                          >
                            <Download size={12} />
                            <span>Download Certificate</span>
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stored Documents & Immutable Version Vault */}
          <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-brand-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Private Document Vault & Version History
                </h3>
              </div>
              <span className="text-xs text-slate-500">{documents.length} document(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] bg-slate-50/60 dark:bg-slate-900/40">
                    <th className="py-3 px-6 font-medium">Document</th>
                    <th className="py-3 px-6 font-medium">Kind</th>
                    <th className="py-3 px-6 font-medium">Version</th>
                    <th className="py-3 px-6 font-medium">SHA-256</th>
                    <th className="py-3 px-6 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-6 text-center text-slate-500">
                        {loadingDocs ? 'Loading documents...' : 'No documents stored yet.'}
                      </td>
                    </tr>
                  ) : (
                    documents.map((doc) => {
                      const latest = doc.versions?.[0];
                      return (
                        <tr key={doc.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-3.5 px-6 font-semibold text-slate-900 dark:text-white">{doc.title}</td>
                          <td className="py-3.5 px-6 uppercase text-[11px] text-slate-500">{doc.doc_kind}</td>
                          <td className="py-3.5 px-6 text-slate-700 dark:text-slate-300">v{doc.current_version}</td>
                          <td className="py-3.5 px-6 font-mono text-[11px] text-slate-500">
                            {latest ? `${latest.sha256_hash.slice(0, 16)}...` : '—'}
                          </td>
                          <td className="py-3.5 px-6">
                            {latest && (
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleVerifyIntegrity(doc.id, latest.id)}
                                  className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                                >
                                  <ShieldCheck size={12} />
                                  <span>Verify</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleViewAccessLogs(doc)}
                                  className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:underline font-medium"
                                >
                                  <History size={12} />
                                  <span>Logs</span>
                                </button>
                                <a
                                  href={api.getDocumentDownloadUrl(doc.id, latest.id)}
                                  className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                                >
                                  <Download size={12} />
                                  <span>Download</span>
                                </a>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedDocLogs && (
            <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Access Audit Logs — {selectedDocLogs.title}
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedDocLogs(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  Close
                </button>
              </div>
              <div className="space-y-1.5 text-xs">
                {selectedDocLogs.logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800/60">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{log.action} · {log.actor_email}</span>
                    <span className="font-mono text-[11px] text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Left Table, Right Voucher Card matching screenshots 7 & 21 */}
      {activeTab === 'receipts' && (
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
      )}

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
