import React, { useEffect, useState } from 'react';
import { 
  Download, 
  ArrowLeft, 
  CheckCircle2, 
  Copy, 
  PenTool,
  Lock,
  Upload,
  FileText,
  ShieldCheck,
  Bell
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { jsPDF } from 'jspdf';
import {
  buildCompletionCertificateSummary,
  buildSanitizedAuditTimeline,
  getAgreementLifecycleInfo,
} from '../../utils/documentManagement';

export const AgreementDetailView: React.FC = () => {
  const { 
    selectedAgreementId, 
    agreements, 
    setAgreements,
    setActiveView, 
    setRecipientModalOpen, 
    setSigningAgreement,
    setSigningToken,
    transitionAgreementStatus,
    deleteDraftAgreement,
    currentUser,
    branding, 
    addToast 
  } = useApp();

  const [verifyingHash, setVerifyingHash] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<
    'not_verified' | 'verified' | 'failed' | 'unavailable'
  >('not_verified');
  const [verificationDetail, setVerificationDetail] = useState<string>('');
  const [creatingSigningLink, setCreatingSigningLink] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [serverDocs, setServerDocs] = useState<any[]>([]);
  const [signingRequests, setSigningRequests] = useState<any[]>([]);
  const [docBusy, setDocBusy] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const agreement = agreements.find(a => a.id === selectedAgreementId) || agreements[0];
  const agreementUuid = (agreement as any)?.uuid || agreement?.id;

  const loadServerDocs = React.useCallback(async () => {
    if (!agreementUuid) return;
    setDocsError(null);
    setVerificationStatus('not_verified');
    setVerificationDetail('');
    try {
      const [docs, requests] = await Promise.all([
        api.getDocuments(agreementUuid),
        api.getSigningRequestsForAgreement(agreementUuid).catch(() => []),
      ]);
      setServerDocs(docs);
      setSigningRequests(Array.isArray(requests) ? requests : []);
    } catch (err: any) {
      setDocsError(err.message || 'Could not load server documents.');
    }
  }, [agreementUuid]);

  useEffect(() => {
    void loadServerDocs();
  }, [loadServerDocs]);

  const handleUploadOriginal = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !agreementUuid) return;
    setDocBusy(true);
    try {
      await api.uploadDocument(file, { agreement_id: agreementUuid, title: `${agreement.id} — ${file.name}` });
      addToast('Document Uploaded', `${file.name} stored in private encrypted vault.`, 'success');
      await loadServerDocs();
    } catch (err: any) {
      addToast('Upload Failed', err.message || 'Could not upload file', 'error');
    } finally {
      setDocBusy(false);
      e.target.value = '';
    }
  };

  const handleGenerateServerPdf = async () => {
    if (!agreementUuid) return;
    setDocBusy(true);
    try {
      await api.generateAgreementPdf(agreementUuid);
      addToast('PDF Generated', 'Server-side immutable PDF version created.', 'success');
      await loadServerDocs();
    } catch (err: any) {
      addToast('Generation Failed', err.message || 'Could not generate PDF', 'error');
    } finally {
      setDocBusy(false);
    }
  };

  const handleVerifyDocument = async (docId: string, versionId?: string): Promise<boolean> => {
    setDocBusy(true);
    setVerifyingHash(true);
    try {
      const res = await api.verifyDocumentIntegrity(docId, versionId);
      const isOk = Boolean(res?.verified && res?.expected_sha256 && res?.actual_sha256 === res?.expected_sha256);
      setVerificationStatus(isOk ? 'verified' : 'failed');
      setVerificationDetail(
        isOk
          ? `Server SHA-256 verified (${String(res.actual_sha256).slice(0, 16)}...)`
          : 'Server SHA-256 mismatch detected.',
      );
      addToast(
        isOk ? 'Integrity Verified' : 'Integrity Mismatch',
        `SHA-256 ${isOk ? 'matches' : 'does not match'}: ${String(res?.actual_sha256 || '').slice(0, 16)}...`,
        isOk ? 'success' : 'error',
      );
      return isOk;
    } catch (err: any) {
      setVerificationStatus('failed');
      setVerificationDetail(err?.message || 'Document integrity verification failed.');
      addToast('Verification Failed', err.message || 'Could not verify document', 'error');
      return false;
    } finally {
      setDocBusy(false);
      setVerifyingHash(false);
    }
  };

  if (!agreement) {
    return (
      <div className="p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No agreement selected or created yet.</p>
        <button
          onClick={() => setActiveView('agreements')}
          className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium"
        >
          Back to Agreements
        </button>
      </div>
    );
  }

  const handleBlobDownload = async (docId: string, versionId?: string, fileName?: string) => {
    setDocBusy(true);
    try {
      await api.downloadDocumentBlob(docId, versionId, fileName);
      addToast('PDF Downloaded', `${fileName || agreement.id} downloaded securely.`, 'success');
    } catch (err: any) {
      addToast('Download Failed', err.message || 'Could not download document', 'error');
    } finally {
      setDocBusy(false);
    }
  };

  const handleDownloadPDF = async () => {
    const preferredDoc =
      serverDocs.find((d) => d.doc_kind === 'signed_pdf') ||
      serverDocs.find((d) => d.doc_kind === 'generated_pdf') ||
      serverDocs[0];

    if (preferredDoc?.versions?.[0]) {
      await handleBlobDownload(
        preferredDoc.id,
        preferredDoc.versions[0].id,
        preferredDoc.versions[0].file_name,
      );
      return;
    }

    if (agreementUuid) {
      setDocBusy(true);
      try {
        const generated = await api.generateAgreementPdf(agreementUuid);
        await loadServerDocs();
        await api.downloadDocumentBlob(
          generated.document.id,
          generated.version.id,
          generated.version.file_name,
        );
        addToast('PDF Downloaded', `Agreement ${agreement.id} generated and downloaded.`, 'success');
        return;
      } catch (err: any) {
        addToast('PDF Error', err.message || 'Could not generate server PDF', 'error');
      } finally {
        setDocBusy(false);
      }
      return;
    }

    try {
      const doc = new jsPDF();

      // Header Brand
      doc.setFillColor(91, 19, 236);
      doc.rect(0, 0, 210, 14, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(branding.logoText, 20, 9.5);

      doc.setFontSize(8);
      doc.text('CRYPTOGRAPHICALLY SEALED AGREEMENT', 135, 9.5);

      // Document Title
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(agreement.templateType.toUpperCase(), 20, 30);

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Agreement Ref: ${agreement.id}   |   Date: ${agreement.createdAt}`, 20, 38);

      // Divider
      doc.setDrawColor(226, 232, 240);
      doc.line(20, 43, 190, 43);

      // Parties
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text('PARTIES & SCOPE:', 20, 52);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(`Executing Company: ${currentUser?.tenantName || 'Company Workspace'}`, 20, 60);
      doc.text(`Designated Signatory: ${agreement.recipientName} (${agreement.recipientEmail})`, 20, 67);
      doc.text(`Department: ${agreement.department}   |   Tenure: ${agreement.period}`, 20, 74);
      doc.text(`Stipulated Consideration: INR ${agreement.feeAmount.toLocaleString('en-IN')}`, 20, 81);

      // Terms & Clauses
      doc.setFont('helvetica', 'bold');
      doc.text('TERMS AND CLAUSES:', 20, 93);

      doc.setFont('helvetica', 'normal');
      doc.text(doc.splitTextToSize(agreement.content, 170), 20, 101);

      // Signature Section
      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(20, 132, 170, 45, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(91, 19, 236);
      doc.text('ELECTRONIC SIGNATURE RECORD', 25, 140);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);
      doc.text(`Signer: ${agreement.recipientName}`, 25, 148);
      doc.text(`Status: ${agreement.status === 'Completed' ? 'Legally Signed & Executed' : 'Awaiting Execution'}`, 25, 154);
      doc.text(`Method: Basic electronic (image-based, not certificate-backed)`, 25, 160);
      doc.text(`Cryptographic Hash: ${agreement.documentHash}`, 25, 166);
      doc.text(`Audit Timestamp: ${agreement.updatedAt}`, 25, 172);

      // Audit Trail Summary
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text('AUDIT TRAIL LOG:', 20, 192);

      let yPos = 202;
      agreement.auditTrail.forEach(step => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(91, 19, 236);
        doc.text(`[${step.timestamp}]`, 20, yPos);

        doc.setTextColor(15, 23, 42);
        doc.text(`${step.title} — `, 45, yPos);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(`${step.description}`, 80, yPos);

        yPos += 7;
      });

      // Footer
      doc.setDrawColor(226, 232, 240);
      doc.line(20, 275, 190, 275);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generated by GSIGN (Powered by Genemax Sign) | Verified Integrity Hash: ${agreement.documentHash}`, 20, 282);

      doc.save(`${agreement.id}_${agreement.recipientName.replace(/\s+/g, '_')}.pdf`);
      addToast('PDF Downloaded', `Agreement ${agreement.id} exported successfully.`, 'success');
    } catch (err) {
      console.error(err);
      addToast('Download Failed', 'Could not compile PDF', 'error');
    }
  };

  const handleVerifyTamperProof = async () => {
    const preferredDoc =
      serverDocs.find((d) => d.doc_kind === 'signed_pdf') ||
      serverDocs.find((d) => d.doc_kind === 'generated_pdf') ||
      serverDocs[0];

    if (!preferredDoc?.id) {
      setVerificationStatus('unavailable');
      setVerificationDetail('No vaulted server document is available to verify.');
      addToast(
        'Verification Unavailable',
        'No server-stored document exists yet. Upload a document or generate a server PDF to verify integrity.',
        'warning',
      );
      return;
    }

    const latestVersionId = preferredDoc.versions?.[0]?.id;
    await handleVerifyDocument(preferredDoc.id, latestVersionId);
  };

  const issueSigningLink = async (): Promise<{ token: string; url: string } | null> => {
    setCreatingSigningLink(true);
    try {
      const res = await api.createSigningRequest({
        agreement_id: (agreement as any).uuid || agreement.id,
        sequential: true,
        recipients: [
          {
            name: agreement.recipientName,
            email: agreement.recipientEmail,
            signing_order: 1,
            is_required: true,
            sign_method: agreement.signMethod || 'basic_drawn',
          },
        ],
      });
      const rec = res.recipients?.[0];
      const token = rec?.signing_token;
      const url = `${window.location.origin}/?token=${token}`;
      const refreshed = await api.getAgreements();
      if (Array.isArray(refreshed)) {
        setAgreements(refreshed);
      }
      return token ? { token, url } : null;
    } catch (err: any) {
      addToast('Signing Error', err.message || 'Could not create signing link', 'error');
      return null;
    } finally {
      setCreatingSigningLink(false);
    }
  };

  const copyShareLink = async () => {
    const issued = await issueSigningLink();
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url);
    addToast('Link Copied', 'Secure recipient signing portal link copied to clipboard', 'info');
  };

  const handleSendReminder = async () => {
    if (!agreement || sendingReminder) return;
    setSendingReminder(true);
    try {
      const res = await api.remindAgreement(agreement.id);
      const firstStatus = res?.delivery_results?.[0]?.status;
      if (firstStatus === 'sent') {
        addToast('Reminder Sent', `Signing reminder delivered to ${res.recipients_notified} recipient(s).`, 'success');
      } else if (firstStatus === 'disabled') {
        addToast('Reminder Recorded', 'Reminder queued in audit trail (email provider disabled in this environment).', 'info');
      } else {
        addToast('Reminder Queued (Delivery Failed)', 'Reminder audit logged, but email delivery failed.', 'warning');
      }
      const refreshed = await api.getAgreements();
      if (Array.isArray(refreshed)) {
        setAgreements(refreshed);
      }
    } catch (err: any) {
      addToast('Reminder Failed', err.message || 'Could not send signing reminder.', 'error');
    } finally {
      setSendingReminder(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar matching pages 6 & 20 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView('agreements')}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                {agreement.id}
              </h2>
              {agreement.status === 'Completed' ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                  Completed
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                  {agreement.status}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {agreement.templateType} · {agreement.recipientName}
            </p>
          </div>
        </div>

        {/* Action Buttons: Download PDF & Cancel */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={copyShareLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle"
          >
            <Copy size={13} />
            <span>Copy Link</span>
          </button>

          {['Awaiting OTP', 'Awaiting signature', 'Partially signed'].includes(agreement.status) && (
            <button
              type="button"
              onClick={handleSendReminder}
              disabled={sendingReminder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-subtle"
            >
              <Bell size={13} />
              <span>{sendingReminder ? 'Sending...' : 'Send Reminder'}</span>
            </button>
          )}

          {agreement.status === 'Draft' && (
            <>
              <button
                disabled={creatingSigningLink}
                onClick={async () => {
                  const issued = await issueSigningLink();
                  if (issued) {
                    await navigator.clipboard.writeText(issued.url);
                    addToast('Sent for Signing', 'Signing request created and secure link copied.', 'success');
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors shadow-subtle"
              >
                <span>{creatingSigningLink ? 'Sending...' : 'Send for Signing'}</span>
              </button>
              <button
                onClick={async () => {
                  await deleteDraftAgreement(agreement.id);
                  setActiveView('agreements');
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                Delete Draft
              </button>
            </>
          )}

          {(agreement.status === 'Awaiting OTP' || agreement.status === 'Awaiting signature' || agreement.status === 'Partially signed') && (
            <>
              <button
                disabled={creatingSigningLink}
                onClick={async () => {
                  const issued = await issueSigningLink();
                  if (issued) {
                    setSigningAgreement(agreement);
                    setSigningToken(issued.token);
                    setRecipientModalOpen(true);
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors shadow-subtle"
              >
                <PenTool size={13} />
                <span>{creatingSigningLink ? 'Opening...' : 'Sign Document'}</span>
              </button>
              <button
                onClick={() => transitionAgreementStatus(agreement.id, 'Cancelled', 'Cancelled by administrator')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-subtle"
          >
            <Download size={13} />
            <span>Download PDF</span>
          </button>

          <button
            onClick={() => setActiveView('agreements')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Main 2-Column Layout matching Screenshots 6 & 20 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Document View (approx 7 cols) */}
        <div className="lg:col-span-7">
          <div className="p-8 sm:p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card min-h-[480px] flex flex-col justify-between">
            {/* Top Watermark & Letterhead */}
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt={branding.logoText} className="h-6 max-w-[120px] object-contain" />
                  ) : null}
                  <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                    {branding.logoText}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                  <Lock size={11} className={verificationStatus === 'verified' ? 'text-emerald-500' : 'text-slate-400'} />
                  <span>
                    {verificationStatus === 'verified'
                      ? 'SERVER INTEGRITY VERIFIED'
                      : verificationStatus === 'failed'
                        ? 'VERIFICATION FAILED'
                        : verificationStatus === 'unavailable'
                          ? 'NO VAULTED DOCUMENT'
                          : 'RECORD HASH ON FILE'}
                  </span>
                </div>
              </div>

              {/* Document Text matching screenshot */}
              <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed space-y-4">
                <p>
                  This offer is made to <strong className="text-slate-900 dark:text-white font-semibold">{agreement.recipientName}</strong> for a {agreement.templateType.toLowerCase().includes('offer') ? 'monthly salary' : 'monthly fee'} of <strong className="text-slate-900 dark:text-white font-semibold">₹{agreement.feeAmount.toLocaleString('en-IN')}</strong> for {agreement.period}…
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                  The recipient agrees to the standard covenants, intellectual property assignment clauses, confidentiality protocols, and department guidelines as set out in Schedule A.
                </p>
              </div>
            </div>

            {/* Signature Box (matches screenshot dashed or solid box) */}
            <div className="mt-10 pt-5 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Signature: {agreement.recipientName}
                  </span>
                  <span className="text-[11px] font-mono">
                    {agreement.status === 'Completed' ? 'Signed & Timestamped' : 'Pending Signature'}
                  </span>
                </div>

                {/* Drawn Signature Preview if completed */}
                {agreement.status === 'Completed' ? (
                  <div className="py-1.5 flex items-center justify-between">
                    <div className="border-b border-slate-300 dark:border-slate-700 pb-1 w-44">
                      {agreement.signatureDataUrl?.startsWith('data:image') ? (
                        <img src={agreement.signatureDataUrl} alt="Signature" className="h-8 object-contain" />
                      ) : (
                        <span className="font-serif italic text-lg text-brand-600 dark:text-brand-400">
                          {agreement.recipientName}
                        </span>
                      )}
                    </div>
                    <div
                      className={`flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border ${
                        verificationStatus === 'verified'
                          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40'
                          : verificationStatus === 'failed'
                            ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/40'
                            : 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <CheckCircle2 size={11} />
                      {verificationStatus === 'verified'
                        ? 'Server Verified'
                        : verificationStatus === 'failed'
                          ? 'Verification Failed'
                          : verificationStatus === 'unavailable'
                            ? 'No Vaulted PDF'
                            : 'Not Yet Verified'}
                    </div>
                  </div>
                ) : (
                  <div className="h-10 border border-dashed border-slate-300 dark:border-slate-700 rounded flex items-center justify-center text-xs text-slate-400">
                    Awaiting recipient drawn signature
                  </div>
                )}

                <div className="text-[11px] text-slate-400">
                  Basic electronic · image-based, not certificate-backed
                </div>
              </div>

              {/* Cryptographic Hash Verification Line */}
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1 font-mono gap-2">
                <div className="flex items-center gap-1.5 text-[11px] truncate" title={verificationDetail || undefined}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      verificationStatus === 'verified'
                        ? 'bg-emerald-500'
                        : verificationStatus === 'failed'
                          ? 'bg-rose-500'
                          : verificationStatus === 'unavailable'
                            ? 'bg-amber-500'
                            : 'bg-slate-400'
                    }`}
                  />
                  <span className="truncate">SHA-256: {agreement.documentHash}</span>
                </div>
                <button
                  onClick={handleVerifyTamperProof}
                  disabled={verifyingHash}
                  className="text-brand-600 dark:text-brand-400 hover:underline text-[11px] font-sans font-medium shrink-0"
                >
                  {verifyingHash
                    ? 'Verifying...'
                    : verificationStatus === 'verified'
                      ? '✓ Server Verified'
                      : verificationStatus === 'failed'
                        ? 'Verification Failed — Retry'
                        : verificationStatus === 'unavailable'
                          ? 'Verification Unavailable'
                          : 'Verify Integrity'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Agreement History, Audit Trail & Completion Certificate Summary */}
        <div className="lg:col-span-5 space-y-6">
          {(() => {
            const lifecycle = getAgreementLifecycleInfo(agreement.status);
            const timelineEvents = buildSanitizedAuditTimeline(agreement.auditTrail || []);
            const allRecipients = signingRequests.flatMap((req: any) =>
              Array.isArray(req.recipients) ? req.recipients : [],
            );
            const certSummary = buildCompletionCertificateSummary(agreement.status, allRecipients);

            return (
              <>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Agreement Lifecycle & History
                    </h3>
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-brand-50 dark:bg-brand-950/60 text-brand-700 dark:text-brand-300">
                      {lifecycle.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lifecycle.description}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                    <div>
                      <span className="text-slate-400 block">Template</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{agreement.templateType}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Document Versions</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{serverDocs.length} vaulted</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Primary Recipient</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                        {agreement.recipientName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Certificate Status</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{certSummary.status}</span>
                    </div>
                  </div>
                  {allRecipients.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-slate-400">
                        Signing Order & Recipients
                      </span>
                      {allRecipients.map((rec: any, rIdx: number) => (
                        <div key={rec.id || rIdx} className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>#{rec.signing_order ?? rIdx + 1} · {rec.name}</span>
                          <span className="font-mono uppercase text-[10px]">{rec.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-100 dark:border-slate-800">
                    {certSummary.disclaimer}
                  </p>
                </div>

                <div className="p-6 sm:p-7 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Audit trail
                    </h3>
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Recorded Events ({timelineEvents.length})
                    </span>
                  </div>

                  {timelineEvents.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No audit events recorded yet for this agreement.
                    </p>
                  ) : (
                    <div className="relative pl-5 space-y-5 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-px before:bg-brand-600 dark:before:bg-brand-500">
                      {timelineEvents.map((event, idx) => (
                        <div key={event.id || idx} className="relative">
                          <div className="absolute -left-[19px] top-1.5 w-2.5 h-2.5 rounded-full bg-brand-600 dark:bg-brand-500 border-2 border-white dark:border-slate-800" />
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                                {event.title}
                              </h4>
                              <span className="text-[10px] font-mono text-slate-400">
                                {event.timestamp || 'Recorded'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {event.description}
                            </p>
                            {event.category === 'unsupported' && (
                              <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                                Unverified / legacy event type
                              </span>
                            )}
                            {event.ip && (
                              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                                IP: {event.ip} {event.device ? `· ${event.device}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Timestamp: Genemax Server</span>
                    <span className="font-mono">UTC+05:30</span>
                  </div>
                </div>
              </>
            );
          })()}

          {/* Server Documents, Versions & Integrity Card */}
          <div className="mt-6 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-brand-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Documents & Integrity
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <Upload size={11} />
                  <span>Upload</span>
                  <input type="file" className="hidden" disabled={docBusy} onChange={handleUploadOriginal} />
                </label>
                <button
                  type="button"
                  disabled={docBusy}
                  onClick={handleGenerateServerPdf}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-60"
                >
                  Generate PDF
                </button>
              </div>
            </div>

            {docsError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300">
                {docsError}
              </div>
            )}

            {serverDocs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No server-stored documents yet. Upload an original file or generate a server PDF.
              </p>
            ) : (
              <div className="space-y-2.5">
                {serverDocs.map((doc) => {
                  const latest = doc.versions?.[0];
                  return (
                    <div
                      key={doc.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {doc.title}
                        </span>
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-400">
                          {doc.doc_kind} · v{doc.current_version}
                        </span>
                      </div>
                      {latest && (
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="font-mono truncate">
                            SHA-256: {latest.sha256_hash.slice(0, 14)}...
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={docBusy}
                              onClick={() => handleVerifyDocument(doc.id, latest.id)}
                              className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                            >
                              <ShieldCheck size={11} />
                              <span>Verify</span>
                            </button>
                            <button
                              type="button"
                              disabled={docBusy}
                              onClick={() => handleBlobDownload(doc.id, latest.id, latest.file_name)}
                              className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                            >
                              <Download size={11} />
                              <span>Download</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
