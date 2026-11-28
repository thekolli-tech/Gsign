import React, { useEffect, useMemo, useState } from 'react';
import { 
  Plus, 
  Printer, 
  ShieldCheck,
  FileText,
  Download,
  Upload,
  Award,
  History,
  Search,
  Eye,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import {
  buildManagedDocumentRows,
  DocumentSortBy,
  filterAndSortDocuments,
} from '../../utils/documentManagement';

export const DocumentsReceiptsView: React.FC = () => {
  const {
    agreements,
    receipts,
    setReceipts,
    acknowledgePayment,
    setSelectedAgreementId,
    setActiveView,
    addToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'documents' | 'receipts'>('documents');
  const [documents, setDocuments] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [selectedDocLogs, setSelectedDocLogs] = useState<{ title: string; logs: any[] } | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<DocumentSortBy>('updated_desc');
  const [page, setPage] = useState(1);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  const managedRows = useMemo(
    () => buildManagedDocumentRows(documents, agreements),
    [documents, agreements],
  );

  const categoryOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of managedRows) {
      if (row.category) unique.add(row.category);
    }
    return Array.from(unique).sort();
  }, [managedRows]);

  const paginatedDocs = useMemo(
    () =>
      filterAndSortDocuments(managedRows, {
        search: searchQuery,
        status: statusFilter,
        category: categoryFilter,
        dateFrom,
        dateTo,
        sortBy,
        page,
        pageSize: 8,
      }),
    [managedRows, searchQuery, statusFilter, categoryFilter, dateFrom, dateTo, sortBy, page],
  );

  const loadDocumentsAndCertificates = async () => {
    setLoadingDocs(true);
    setDocsError(null);
    try {
      const [docsRes, certsRes] = await Promise.all([
        api.getDocuments(),
        api.getCertificates(),
      ]);
      setDocuments(docsRes);
      setCertificates(certsRes);
    } catch (err: any) {
      const msg = err.message || 'Could not load documents and certificates.';
      setDocsError(msg);
      addToast('Load Failed', msg, 'error');
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
    try {
      const logs = await api.getDocumentAuditLogs(doc.id);
      setSelectedDocLogs({ title: doc.title, logs });
    } catch (err: any) {
      addToast('Audit Log Error', err.message || 'Could not fetch access logs', 'error');
    }
  };

  const handleBlobDownload = async (documentId: string, versionId?: string, fileName?: string) => {
    try {
      await api.downloadDocumentBlob(documentId, versionId, fileName);
      addToast('Download Started', `${fileName || 'Document'} downloaded securely.`, 'success');
    } catch (err: any) {
      addToast('Download Failed', err.message || 'Could not download document', 'error');
    }
  };

  const pendingReceipts = receipts.filter((r) => r.status !== 'Issued');
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'acknowledge' | 'create'>('acknowledge');
  const [ackReceiptId, setAckReceiptId] = useState<string>('');
  const [ackRef, setAckRef] = useState('');
  const [ackMode, setAckMode] = useState<'UPI' | 'Bank transfer' | 'Credit Card'>('UPI');
  const [newPayerName, setNewPayerName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newPurpose, setNewPurpose] = useState('');
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  const selectedReceipt = receipts.find(r => r.id === selectedReceiptId) || receipts[0];

  const openReceiptModal = () => {
    if (pendingReceipts.length > 0) {
      setModalMode('acknowledge');
      setAckReceiptId(pendingReceipts[0].uuid || pendingReceipts[0].id);
    } else {
      setModalMode('create');
    }
    setAckRef('');
    setModalOpen(true);
  };

  const handleAcknowledgeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingReceipt) return;
    setSubmittingReceipt(true);
    try {
      if (modalMode === 'acknowledge') {
        if (!ackReceiptId || !ackRef.trim()) return;
        const updated = await acknowledgePayment(ackReceiptId, ackRef.trim(), ackMode);
        if (updated) {
          setSelectedReceiptId(updated.id);
          setModalOpen(false);
        }
      } else {
        const parsedAmount = Number(newAmount);
        if (!newPayerName.trim() || !newPurpose.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          addToast('Validation Error', 'Payer name, purpose, and a positive amount are required.', 'error');
          return;
        }
        const created = await api.createPaymentReceipt({
          payer_name: newPayerName.trim(),
          amount: parsedAmount,
          purpose: newPurpose.trim(),
          payment_mode: ackRef.trim() ? ackMode : undefined,
          tx_reference: ackRef.trim() || undefined,
          issue_immediately: Boolean(ackRef.trim()),
        });
        setReceipts(prev => [created, ...prev]);
        setSelectedReceiptId(created.id);
        setNewPayerName('');
        setNewAmount('');
        setNewPurpose('');
        setAckRef('');
        setModalOpen(false);
        addToast(
          created.status === 'Issued' ? 'Receipt Issued' : 'Pending Receipt Recorded',
          `${created.id} saved to database.`,
          'success',
        );
      }
    } catch (err: any) {
      addToast('Receipt Error', err.message || 'Could not process receipt.', 'error');
    } finally {
      setSubmittingReceipt(false);
    }
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
              onClick={openReceiptModal}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
            >
              <Plus size={14} />
              <span>{pendingReceipts.length > 0 ? 'Acknowledge payment' : 'Record receipt'}</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'documents' && (
        <div className="space-y-6">
          {docsError && (
            <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
              <span>{docsError}</span>
              <button
                type="button"
                onClick={loadDocumentsAndCertificates}
                className="font-semibold underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
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
                          <button
                            type="button"
                            onClick={() => handleBlobDownload(c.document_id, c.document_version_id, c.file_name)}
                            className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                          >
                            <Download size={12} />
                            <span>Download Certificate</span>
                          </button>
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
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-brand-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Private Document Vault & Version History
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                {paginatedDocs.totalItems} of {managedRows.length} document(s)
              </span>
            </div>

            {/* Search, Filter & Sort Toolbar */}
            <div className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center text-xs">
              <div className="md:col-span-4 relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search agreement, recipient, or ref..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400"
                />
              </div>

              <div className="md:col-span-2">
                <select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  <option value="all">All Statuses</option>
                  <option value="Signed">Signed Only</option>
                  <option value="Unsigned">Unsigned Only</option>
                  <option value="Completed">Completed</option>
                  <option value="Partially signed">Partially signed</option>
                  <option value="Awaiting signature">Awaiting signature</option>
                  <option value="Awaiting OTP">Awaiting OTP</option>
                  <option value="Draft">Draft</option>
                  <option value="Rejected">Rejected</option>
                  <option value="Expired">Expired</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  <option value="all">All Categories</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  aria-label="Sort documents"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as DocumentSortBy);
                    setPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  <option value="updated_desc">Modified (Newest)</option>
                  <option value="updated_asc">Modified (Oldest)</option>
                  <option value="created_desc">Created (Newest)</option>
                  <option value="created_asc">Created (Oldest)</option>
                  <option value="signed_desc">Signed Date (Newest)</option>
                  <option value="signed_asc">Signed Date (Oldest)</option>
                </select>
              </div>

              <div className="md:col-span-2 flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="From date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px]"
                />
                {(searchQuery || statusFilter !== 'all' || categoryFilter !== 'all' || dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setCategoryFilter('all');
                      setDateFrom('');
                      setDateTo('');
                      setPage(1);
                    }}
                    className="shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] bg-slate-50/60 dark:bg-slate-900/40">
                    <th className="py-3 px-6 font-medium">Document & Reference</th>
                    <th className="py-3 px-6 font-medium">Recipient</th>
                    <th className="py-3 px-6 font-medium">Status</th>
                    <th className="py-3 px-6 font-medium">Versions & Activity</th>
                    <th className="py-3 px-6 font-medium">SHA-256</th>
                    <th className="py-3 px-6 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {loadingDocs ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-6 text-center text-slate-500">
                        Loading documents...
                      </td>
                    </tr>
                  ) : paginatedDocs.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 px-6 text-center text-slate-500">
                        {managedRows.length === 0
                          ? 'No documents stored yet.'
                          : 'No documents match your active search or filter criteria.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedDocs.items.map((row) => {
                      const { doc, agreement } = row;
                      const latest = doc.versions?.[0];
                      const isExpanded = expandedDocId === doc.id;
                      return (
                        <React.Fragment key={doc.id}>
                          <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                            <td className="py-3.5 px-6">
                              <div className="font-semibold text-slate-900 dark:text-white">{doc.title}</div>
                              <div className="text-[11px] font-mono text-slate-400">
                                {row.referenceNumber} · {row.category}
                              </div>
                            </td>
                            <td className="py-3.5 px-6 text-slate-600 dark:text-slate-300">
                              {row.recipientLabel}
                            </td>
                            <td className="py-3.5 px-6">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  row.isSigned
                                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {row.isSigned ? 'Signed' : 'Unsigned'} · {row.statusLabel}
                              </span>
                            </td>
                            <td className="py-3.5 px-6 text-slate-700 dark:text-slate-300">
                              <button
                                type="button"
                                onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                                className="inline-flex items-center gap-1 hover:text-brand-600 dark:hover:text-brand-400 font-medium"
                              >
                                <span>v{doc.current_version} ({row.activityCount} events)</span>
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </td>
                            <td className="py-3.5 px-6 font-mono text-[11px] text-slate-500">
                              {latest ? `${latest.sha256_hash.slice(0, 16)}...` : '—'}
                            </td>
                            <td className="py-3.5 px-6">
                              <div className="flex flex-wrap items-center gap-3">
                                {agreement && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedAgreementId(agreement.id);
                                      setActiveView('agreement_detail');
                                    }}
                                    className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:underline font-medium"
                                  >
                                    <Eye size={12} />
                                    <span>Preview</span>
                                  </button>
                                )}
                                {latest && (
                                  <>
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
                                    <button
                                      type="button"
                                      onClick={() => handleBlobDownload(doc.id, latest.id, latest.file_name)}
                                      className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                                    >
                                      <Download size={12} />
                                      <span>Download</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-900/60">
                              <td colSpan={6} className="px-6 py-3">
                                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-2">
                                  Version History ({doc.versions?.length || 0})
                                </div>
                                <div className="space-y-1.5">
                                  {(doc.versions || []).map((v: any) => (
                                    <div
                                      key={v.id}
                                      className="flex flex-wrap items-center justify-between gap-2 text-[11px] px-3 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
                                    >
                                      <span className="font-medium text-slate-800 dark:text-slate-200">
                                        v{v.version_number} — {v.file_name}
                                      </span>
                                      <span className="font-mono text-slate-500">
                                        {v.sha256_hash.slice(0, 16)}... · {new Date(v.created_at).toLocaleString()}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleBlobDownload(doc.id, v.id, v.file_name)}
                                        className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
                                      >
                                        Download v{v.version_number}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {paginatedDocs.totalPages > 1 && (
              <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Page {paginatedDocs.currentPage} of {paginatedDocs.totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={paginatedDocs.currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                  >
                    <ChevronLeft size={12} />
                    <span>Prev</span>
                  </button>
                  <button
                    type="button"
                    disabled={paginatedDocs.currentPage >= paginatedDocs.totalPages}
                    onClick={() => setPage((p) => Math.min(paginatedDocs.totalPages, p + 1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                  >
                    <span>Next</span>
                    <ChevronRight size={12} />
                  </button>
                </div>
              </div>
            )}
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
                  {receipts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 px-6 text-center text-slate-400">
                        No payment receipts recorded yet.
                      </td>
                    </tr>
                  ) : (
                    receipts.map((r, idx) => (
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
                  ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Receipt Voucher Card matching pages 7 & 21 ~ 5 cols */}
        <div className="lg:col-span-5">
          {!selectedReceipt ? (
            <div className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card text-center text-xs text-slate-400">
              Select a payment receipt to view voucher details.
            </div>
          ) : (
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
                {selectedReceipt.verificationToken || selectedReceipt.txRef || selectedReceipt.id}
              </span>
            </div>
          </div>
          )}
        </div>
      </div>
      )}

      {/* Acknowledge / Record Payment Receipt Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {modalMode === 'acknowledge' ? 'Acknowledge Payment' : 'Record Payment Receipt'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {pendingReceipts.length > 0 && (
              <div className="flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setModalMode('acknowledge')}
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${modalMode === 'acknowledge' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle' : 'text-slate-500'}`}
                >
                  Acknowledge Pending ({pendingReceipts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setModalMode('create')}
                  className={`flex-1 py-1.5 rounded-md font-medium transition-colors ${modalMode === 'create' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-subtle' : 'text-slate-500'}`}
                >
                  New Receipt
                </button>
              </div>
            )}

            <form onSubmit={handleAcknowledgeSubmit} className="space-y-4 text-xs">
              {modalMode === 'acknowledge' ? (
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Select Pending Receipt
                  </label>
                  <select
                    value={ackReceiptId}
                    onChange={e => setAckReceiptId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                  >
                    {pendingReceipts.map((pr) => (
                      <option key={pr.uuid || pr.id} value={pr.uuid || pr.id}>
                        {pr.payer} (₹{pr.amount.toLocaleString('en-IN')} · {pr.purpose})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Payer Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={newPayerName}
                      onChange={e => setNewPayerName(e.target.value)}
                      placeholder="e.g. Meera Iyer"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                        Amount (INR) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={newAmount}
                        onChange={e => setNewAmount(e.target.value)}
                        placeholder="30000"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                      />
                    </div>
                    <div>
                      <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                        Purpose *
                      </label>
                      <input
                        type="text"
                        required
                        value={newPurpose}
                        onChange={e => setNewPurpose(e.target.value)}
                        placeholder="Advisory retainer"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

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
                  <option value="Bank transfer">Bank transfer</option>
                  <option value="Credit Card">Credit Card</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Transaction Reference (UTR / UPI Ref){modalMode === 'acknowledge' ? ' *' : ' (optional for pending)'}
                </label>
                <input
                  type="text"
                  required={modalMode === 'acknowledge'}
                  value={ackRef}
                  onChange={e => setAckRef(e.target.value)}
                  placeholder="e.g. UPI-202611259981"
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
                  disabled={submittingReceipt}
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 font-medium shadow-subtle disabled:opacity-50"
                >
                  {submittingReceipt ? 'Saving...' : modalMode === 'acknowledge' ? 'Confirm & Issue Receipt' : 'Save Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
