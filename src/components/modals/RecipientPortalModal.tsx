import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Smartphone,
  Monitor,
  Check,
  PenTool,
  Download,
  RotateCcw,
  Mail,
  AlertTriangle,
  Clock,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { ThumbImpressionCapture, CapturedThumbImpression } from '../signing/ThumbImpressionCapture';
import {
  BiometricCapabilitiesResponse,
  RecipientSigningMethodId,
  base64UrlToUint8Array,
  bufferToBase64Url,
  getSigningMethodOptions,
} from '../../utils/biometricSigning';
import {
  DEFAULT_RECIPIENT_FIELDS,
  RecipientFieldValue,
  clampZoomLevel,
  paginateDocumentContent,
  computeSigningProgress,
  validateRecipientFieldResponses,
  getCompletionBannerState,
} from '../../utils/recipientSigning';
import { jsPDF } from 'jspdf';

export const RecipientPortalModal: React.FC = () => {
  const {
    recipientModalOpen,
    setRecipientModalOpen,
    signingAgreement,
    signingToken,
    setSigningToken,
    agreements,
    setAgreements,
    branding,
    addToast,
  } = useApp();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [deviceMode, setDeviceMode] = useState<'mobile' | 'desktop'>('mobile');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(0);
  const [otpSentOnce, setOtpSentOnce] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<any>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fieldResponses, setFieldResponses] = useState<Record<string, RecipientFieldValue>>(() => ({
    'rec-date': { value: new Date().toISOString().slice(0, 10) },
  }));
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [biometricCapabilities, setBiometricCapabilities] = useState<BiometricCapabilitiesResponse | null>(null);
  const [selectedSigningMethod, setSelectedSigningMethod] = useState<RecipientSigningMethodId>('basic_drawn');
  const [thumbImpression, setThumbImpression] = useState<CapturedThumbImpression | null>(null);
  const [biometricToken, setBiometricToken] = useState<string | null>(null);
  const [biometricVerifying, setBiometricVerifying] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const agreementFallback = signingAgreement || agreements[0];

  const loadPortal = useCallback(async (token: string) => {
    setLoadingPortal(true);
    setPortalError(null);
    try {
      const [data, caps] = await Promise.all([
        api.getSigningPortalByToken(token),
        api.getBiometricCapabilities(token).catch(() => null),
      ]);
      setPortalData(data);
      setBiometricCapabilities(caps);
      if (data.portal_status === 'READY_TO_SIGN') {
        setStep(2);
      } else if (data.portal_status === 'ALREADY_SIGNED') {
        setStep(3);
      } else {
        setStep(1);
      }
    } catch (err: any) {
      setPortalError(err.message || 'Invalid or expired signing link.');
      setPortalData(null);
    } finally {
      setLoadingPortal(false);
    }
  }, []);

  useEffect(() => {
    if (recipientModalOpen && signingToken) {
      setOtp(['', '', '', '', '', '']);
      setConsentChecked(false);
      setHasDrawn(false);
      setShowRejectBox(false);
      setRejectReason('');
      setCurrentPage(1);
      setZoomLevel(100);
      setSubmitResult(null);
      setSelectedSigningMethod('basic_drawn');
      setThumbImpression(null);
      setBiometricToken(null);
      setBiometricError(null);
      setFieldResponses({ 'rec-date': { value: new Date().toISOString().slice(0, 10) } });
      loadPortal(signingToken);
    }
  }, [recipientModalOpen, signingToken, loadPortal]);

  // Countdown timer for OTP resend cooldown
  useEffect(() => {
    if (!recipientModalOpen || timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [recipientModalOpen, timer]);

  const handleClose = () => {
    setRecipientModalOpen(false);
    setSigningToken(null);
    setPortalData(null);
    setPortalError(null);
    setStep(1);
    if (window.location.search.includes('token=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleRequestOtp = async () => {
    if (!signingToken) return;
    setSubmitting(true);
    try {
      await api.requestSigningOtp(signingToken);
      setOtpSentOnce(true);
      setTimer(60);
      addToast('OTP Sent', 'A 6-digit verification code has been sent to your email.', 'success');
    } catch (err: any) {
      addToast('OTP Error', err.message || 'Could not send verification code.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signingToken) return;
    const entered = otp.join('');
    if (entered.length < 6) {
      addToast('Invalid Code', 'Please enter complete 6-digit code', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      await api.verifySigningOtp(signingToken, entered);
      setStep(2);
      addToast('Identity Verified', 'Email OTP verification successful', 'success');
      await loadPortal(signingToken);
    } catch (err: any) {
      addToast('Verification Failed', err.message || 'Invalid OTP code', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Canvas signature logic
  useEffect(() => {
    if (step === 2 && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#5b13ec';
        ctx.lineWidth = 2.5;
      }
    }
  }, [step]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasDrawn(true);

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
  };

  const handleDeviceBiometricVerify = async () => {
    if (!signingToken) return;
    setBiometricError(null);
    setBiometricVerifying(true);
    try {
      const chal = await api.requestBiometricChallenge(signingToken);
      if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials?.get) {
        throw new Error('Device Biometric / Passkey Verification is not supported in this browser.');
      }
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: base64UrlToUint8Array(chal.challenge) as BufferSource,
          rpId: chal.rp_id,
          userVerification: 'required',
          timeout: chal.timeout || 60000,
        },
      })) as PublicKeyCredential | null;

      if (!assertion || !assertion.response) {
        throw new Error('Device biometric verification was cancelled or returned no credential.');
      }
      const resp = assertion.response as AuthenticatorAssertionResponse;
      const verified = await api.verifyBiometricAssertion(signingToken, {
        challenge_id: chal.challenge_id,
        credential_id: assertion.id,
        client_data_json: bufferToBase64Url(resp.clientDataJSON),
        authenticator_data: bufferToBase64Url(resp.authenticatorData),
        signature: bufferToBase64Url(resp.signature),
      });
      setBiometricToken(verified.biometric_verification_token);
      addToast('Device Verified', 'Device Biometric / Passkey Verification succeeded.', 'success');
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Device verification was cancelled or timed out.'
          : err?.message || 'Device biometric verification failed.';
      setBiometricError(msg);
      setBiometricToken(null);
      addToast('Verification Failed', msg, 'error');
    } finally {
      setBiometricVerifying(false);
    }
  };

  const handleSignAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signingToken) return;
    const fieldCheck = validateRecipientFieldResponses(DEFAULT_RECIPIENT_FIELDS, fieldResponses);
    if (!fieldCheck.valid) {
      addToast('Required Fields Missing', fieldCheck.errors[0], 'warning');
      return;
    }
    if (selectedSigningMethod === 'digital_thumb_impression') {
      if (!thumbImpression?.data_url) {
        addToast('Thumb Impression Required', 'Please capture or upload your thumb impression before submitting.', 'warning');
        return;
      }
    } else if (!hasDrawn) {
      addToast('Signature Required', 'Please draw your signature before submitting', 'warning');
      return;
    }
    if (selectedSigningMethod === 'device_biometric' && !biometricToken) {
      addToast('Verification Required', 'Please complete Device Biometric / Passkey Verification first.', 'warning');
      return;
    }
    if (!consentChecked) {
      addToast('Consent Required', 'Please confirm acknowledgment checkbox', 'warning');
      return;
    }

    const sigData =
      selectedSigningMethod === 'digital_thumb_impression' && thumbImpression
        ? thumbImpression.data_url
        : canvasRef.current
          ? canvasRef.current.toDataURL('image/png')
          : '';
    const consentText =
      selectedSigningMethod === 'digital_thumb_impression'
        ? `I have read the full agreement and consent to include my captured ${thumbImpression?.thumb_type || 'right'} digital thumb impression in this agreement.`
        : 'I have read the full agreement and consent to sign it electronically.';

    setSubmitting(true);
    try {
      const res = await api.submitSigningSignature(signingToken, {
        signature_data_url: sigData,
        consent_accepted: true,
        consent_text: consentText,
        signing_method:
          selectedSigningMethod === 'basic_drawn' ||
          selectedSigningMethod === 'otp_verified' ||
          selectedSigningMethod === 'digital_thumb_impression' ||
          selectedSigningMethod === 'device_biometric'
            ? selectedSigningMethod
            : 'basic_drawn',
        thumb_impression:
          selectedSigningMethod === 'digital_thumb_impression' && thumbImpression
            ? thumbImpression
            : undefined,
        biometric_verification_token:
          selectedSigningMethod === 'device_biometric' && biometricToken
            ? biometricToken
            : undefined,
        field_responses: fieldCheck.payloads,
      });
      setSubmitResult(res);
      setStep(3);
      addToast(
        'Signature Recorded',
        res.agreement_completed
          ? 'All required signatures collected. Agreement is now Completed.'
          : 'Your signature has been recorded.',
        'success',
      );
      try {
        const refreshed = await api.getAgreements();
        if (Array.isArray(refreshed) && refreshed.length > 0) {
          setAgreements(refreshed);
        }
      } catch {
        // Recipient may not be authenticated; ignore
      }
    } catch (err: any) {
      addToast('Signing Error', err.message || 'Could not submit signature', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectAgreement = async () => {
    if (!signingToken || !rejectReason.trim()) {
      addToast('Reason Required', 'Please enter a reason for declining', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await api.rejectSigningRequest(signingToken, rejectReason.trim());
      addToast('Agreement Declined', 'You have declined to sign this agreement.', 'info');
      await loadPortal(signingToken);
      try {
        const refreshed = await api.getAgreements();
        if (Array.isArray(refreshed) && refreshed.length > 0) {
          setAgreements(refreshed);
        }
      } catch {
        // Ignore for unauthenticated recipients
      }
    } catch (err: any) {
      addToast('Error', err.message || 'Could not decline agreement', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const activeAgreement = portalData?.agreement || agreementFallback;
  const activeRecipient = portalData?.recipient;
  const portalStatus = portalData?.portal_status;
  const brandTitle = portalData?.tenant?.name || branding.logoText;

  const handleDownloadSignedPDF = () => {
    if (!activeAgreement) return;
    try {
      const doc = new jsPDF();
      doc.setFillColor(91, 19, 236);
      doc.rect(0, 0, 210, 14, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(brandTitle, 20, 9.5);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(16);
      doc.text('SIGNED AGREEMENT', 20, 32);

      doc.setFontSize(9.5);
      doc.setTextColor(100, 116, 139);
      const refId = activeAgreement.agreement_number || activeAgreement.id;
      doc.text(`Reference: ${refId}   |   Date: ${new Date().toLocaleDateString()}`, 20, 40);

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(activeAgreement.content || '', 170), 20, 56);

      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(20, 95, 170, 38, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(91, 19, 236);
      doc.text('VERIFIED ELECTRONIC SIGNATURE', 25, 104);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);
      doc.text(
        `Signer: ${activeRecipient?.name || activeAgreement.recipientName} (${activeRecipient?.email || activeAgreement.recipientEmail || ''})`,
        25,
        112,
      );
      doc.text(`Authentication: Email OTP Verified`, 25, 118);
      doc.text(`SHA-256 Hash: ${activeAgreement.document_hash || activeAgreement.documentHash || 'Verified'}`, 25, 124);

      doc.save(`Signed_${refId}.pdf`);
      addToast('Download Complete', 'Signed agreement saved to your device', 'success');
    } catch (e) {
      console.error(e);
    }
  };

  if (!recipientModalOpen) return null;

  const isBlockedStatus =
    portalStatus &&
    ['REVOKED', 'EXPIRED', 'REJECTED', 'CANCELLED', 'WAITING_PREDECESSOR'].includes(portalStatus);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recipient Signing Portal"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) handleClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60"
    >
      {/* Top Device switcher & Close button bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2.5 z-50">
        <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-slate-300 text-xs">
          <button
            type="button"
            onClick={() => setDeviceMode('mobile')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors ${
              deviceMode === 'mobile' ? 'bg-slate-700 text-white' : 'hover:text-white'
            }`}
          >
            <Smartphone size={13} />
            <span>Mobile</span>
          </button>
          <button
            type="button"
            onClick={() => setDeviceMode('desktop')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors ${
              deviceMode === 'desktop' ? 'bg-slate-700 text-white' : 'hover:text-white'
            }`}
          >
            <Monitor size={13} />
            <span>Desktop</span>
          </button>
        </div>

        <button
          type="button"
          aria-label="Close signing portal"
          onClick={handleClose}
          className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Container: Mobile Frame vs Desktop */}
      <div
        className={`w-full max-h-[90vh] overflow-y-auto transition-all ${
          deviceMode === 'mobile'
            ? 'max-w-[390px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-modal'
            : 'max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-modal p-6 sm:p-8'
        }`}
      >
        <div className="p-6 sm:p-7 flex flex-col justify-between min-h-[500px]">
          {loadingPortal && (
            <div className="flex-1 flex flex-col items-center justify-center text-xs text-slate-500 space-y-2">
              <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
              <span>Verifying secure signing link...</span>
            </div>
          )}

          {!loadingPortal && portalError && (
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600">
                <AlertTriangle size={22} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Signing Link Unavailable</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{portalError}</p>
              </div>
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium"
              >
                Close
              </button>
            </div>
          )}

          {!loadingPortal && !portalError && isBlockedStatus && (
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-600">
                <Clock size={22} />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {portalStatus === 'WAITING_PREDECESSOR'
                    ? 'Waiting for Previous Signer'
                    : `Signing ${portalStatus.charAt(0) + portalStatus.slice(1).toLowerCase()}`}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                  {portalStatus === 'WAITING_PREDECESSOR'
                    ? 'This agreement uses sequential signing. You will be able to verify and sign once prior recipients complete their signature.'
                    : `This signing request is currently ${portalStatus.toLowerCase()} and cannot accept signatures.`}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium"
              >
                Close
              </button>
            </div>
          )}

          {/* STEP 1: EMAIL OTP VERIFICATION */}
          {!loadingPortal && !portalError && !isBlockedStatus && step === 1 && (
            <div className="flex flex-col justify-between flex-1 space-y-6">
              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt={brandTitle} className="h-6 max-w-[120px] object-contain" />
                  ) : null}
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {brandTitle}
                  </h3>
                </div>

                <div className="space-y-1">
                  <div className="flex gap-1.5">
                    <div className="h-1 flex-1 rounded-full bg-brand-600" />
                    <div className="h-1 flex-1 rounded-full bg-slate-200 dark:bg-slate-800" />
                    <div className="h-1 flex-1 rounded-full bg-slate-200 dark:bg-slate-800" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block pt-0.5">
                    Step 1 of 3 · Verify identity
                  </span>
                </div>

                <div className="space-y-1 pt-1">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                    Verify it is you
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Request and enter the 6-digit verification code sent to{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {activeRecipient?.email || 'your email'}
                    </span>
                    .
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    disabled={submitting || timer > 0}
                    onClick={handleRequestOtp}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 disabled:opacity-50"
                  >
                    <Mail size={13} />
                    <span>{otpSentOnce ? 'Resend verification email' : 'Send verification code to email'}</span>
                  </button>
                </div>

                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <div className="flex gap-2 justify-between">
                    {otp.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => {
                          otpRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(index, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(index, e)}
                        className="w-11 h-12 text-center text-base font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all shadow-subtle"
                      />
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors shadow-subtle"
                  >
                    {submitting ? 'Verifying...' : 'Verify and continue'}
                  </button>

                  <div className="text-center">
                    {timer > 0 ? (
                      <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
                        Resend code in {timer}s
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleRequestOtp}
                        className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
                      >
                        {otpSentOnce ? 'Resend code now' : 'Send code now'}
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="text-center pt-6 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] text-slate-400">
                  Powered by Genemax Sign
                </span>
              </div>
            </div>
          )}

          {/* STEP 2: REVIEW AND SIGN */}
          {!loadingPortal && !portalError && !isBlockedStatus && step === 2 && (
            <div className="flex flex-col justify-between flex-1 space-y-5">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    {branding.logoUrl ? (
                      <img src={branding.logoUrl} alt={brandTitle} className="h-5 max-w-[100px] object-contain" />
                    ) : null}
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {brandTitle}
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {activeAgreement?.template_type || activeAgreement?.templateType} ·{' '}
                    {activeAgreement?.agreement_number || activeAgreement?.id}
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex gap-1.5">
                    <div className="h-1 flex-1 rounded-full bg-brand-600" />
                    <div className="h-1 flex-1 rounded-full bg-brand-600" />
                    <div className="h-1 flex-1 rounded-full bg-slate-200 dark:bg-slate-800" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block pt-0.5">
                    Step 2 of 3 · Review and sign
                  </span>
                </div>

                {(() => {
                  const pages = paginateDocumentContent(activeAgreement?.content || '');
                  const safePage = Math.min(currentPage, pages.length);
                  const progress = computeSigningProgress(portalData?.recipients_progress);
                  return (
                    <div className="space-y-2">
                      {progress.totalSigners > 0 && (
                        <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-md bg-brand-50/70 dark:bg-brand-950/30 border border-brand-200 dark:border-brand-800/50 text-brand-700 dark:text-brand-300">
                          <span>
                            Signing progress: {progress.signedCount} of {progress.totalSigners} required signer(s)
                          </span>
                          <span className="font-mono font-semibold">{progress.percentComplete}%</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Previous page"
                            disabled={safePage <= 1}
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                          >
                            <ChevronLeft size={12} />
                          </button>
                          <span className="font-mono px-1">
                            Page {safePage} / {pages.length}
                          </span>
                          <button
                            type="button"
                            aria-label="Next page"
                            disabled={safePage >= pages.length}
                            onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
                            className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                          >
                            <ChevronRight size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Zoom out"
                            disabled={zoomLevel <= 75}
                            onClick={() => setZoomLevel((z) => clampZoomLevel(z - 25))}
                            className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                          >
                            <ZoomOut size={12} />
                          </button>
                          <span className="font-mono w-10 text-center">{zoomLevel}%</span>
                          <button
                            type="button"
                            aria-label="Zoom in"
                            disabled={zoomLevel >= 150}
                            onClick={() => setZoomLevel((z) => clampZoomLevel(z + 25))}
                            className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                          >
                            <ZoomIn size={12} />
                          </button>
                        </div>
                      </div>
                      <div
                        style={{ fontSize: `${Math.round((12 * zoomLevel) / 100)}px` }}
                        className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap"
                      >
                        {pages[safePage - 1]}
                      </div>
                    </div>
                  );
                })()}

                {/* Assigned Recipient Fields */}
                <div className="space-y-2 p-3 rounded-lg bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Your Assigned Fields
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {DEFAULT_RECIPIENT_FIELDS.filter((f) => f.type !== 'Checkbox').map((field) => (
                      <div key={field.id}>
                        <label className="text-[10px] font-medium text-slate-600 dark:text-slate-400 block mb-0.5">
                          {field.label} {field.required ? '*' : ''}
                        </label>
                        <input
                          type={field.type === 'Date' ? 'date' : 'text'}
                          value={fieldResponses[field.id]?.value || ''}
                          placeholder={field.type === 'Initials' ? 'e.g. AV' : ''}
                          onChange={(e) =>
                            setFieldResponses((prev) => ({
                              ...prev,
                              [field.id]: { ...prev[field.id], value: e.target.value },
                            }))
                          }
                          className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                      </div>
                    ))}
                  </div>
                  {DEFAULT_RECIPIENT_FIELDS.filter((f) => f.type === 'Checkbox').map((field) => (
                    <label key={field.id} className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={Boolean(fieldResponses[field.id]?.checked)}
                        onChange={(e) =>
                          setFieldResponses((prev) => ({
                            ...prev,
                            [field.id]: { ...prev[field.id], checked: e.target.checked },
                          }))
                        }
                        className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-brand-600"
                      />
                      <span>
                        {field.label} {field.required ? '*' : ''}
                      </span>
                    </label>
                  ))}
                </div>

                {/* Signing Method Selector */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Select Signing Method
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {getSigningMethodOptions({ capabilities: biometricCapabilities }).map((opt) => {
                      const active = selectedSigningMethod === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={!opt.available}
                          onClick={() => setSelectedSigningMethod(opt.id)}
                          className={`w-full text-left p-2 rounded-lg border text-[11px] transition-colors ${
                            !opt.available
                              ? 'opacity-55 cursor-not-allowed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40'
                              : active
                                ? 'border-brand-600 bg-brand-50/40 dark:bg-brand-950/30'
                                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-white">{opt.label}</span>
                            {!opt.available && (
                              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Unavailable
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {opt.available ? opt.description : opt.unavailableReason}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedSigningMethod === 'device_biometric' && (
                  <div className="p-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/30 dark:bg-brand-950/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <ShieldCheck size={14} className="text-brand-600" />
                        Device Biometric / Passkey Verification
                      </span>
                      {biometricToken && (
                        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded">
                          Verified
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Uses your device passkey or OS user verification (Touch ID, Face ID, Windows Hello, or PIN). Verification alone does not sign until you consent and submit below.
                    </p>
                    {biometricError && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400">{biometricError}</div>
                    )}
                    <button
                      type="button"
                      disabled={biometricVerifying}
                      onClick={handleDeviceBiometricVerify}
                      className="w-full py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium disabled:opacity-50"
                    >
                      {biometricVerifying
                        ? 'Verifying Device...'
                        : biometricToken
                          ? 'Re-verify Device'
                          : 'Verify with Device Passkey'}
                    </button>
                  </div>
                )}

                {selectedSigningMethod === 'digital_thumb_impression' ? (
                  <ThumbImpressionCapture value={thumbImpression} onChange={setThumbImpression} />
                ) : (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                      Draw your signature
                    </h4>
                    <button
                      type="button"
                      onClick={clearCanvas}
                      className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium flex items-center gap-1"
                    >
                      <RotateCcw size={10} />
                      Clear
                    </button>
                  </div>

                  <div className="relative border border-dashed border-brand-500 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
                    <canvas
                      ref={canvasRef}
                      width={340}
                      height={100}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                      className="w-full h-24 touch-none cursor-crosshair"
                    />

                    {!hasDrawn && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400 font-normal">
                        Sign here with your finger or mouse
                      </div>
                    )}
                  </div>
                </div>
                )}

                <div className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="consent-check"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                  />
                  <label htmlFor="consent-check" className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal cursor-pointer">
                    {selectedSigningMethod === 'digital_thumb_impression'
                      ? `I have read the full agreement and consent to include my captured ${thumbImpression?.thumb_type || 'right'} digital thumb impression in the executed agreement.`
                      : 'I have read the full agreement and consent to sign it electronically.'}
                  </label>
                </div>

                <div className="text-[10px] text-slate-400">
                  Method: {selectedSigningMethod.replace(/_/g, ' ')} · Email OTP verified
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 dark:text-slate-400">
                    Required steps: {Number(selectedSigningMethod === 'digital_thumb_impression' ? Boolean(thumbImpression) : hasDrawn) + Number(consentChecked)} of 2 completed
                  </span>
                  <div className="flex items-center gap-2 font-medium">
                    <span className={(selectedSigningMethod === 'digital_thumb_impression' ? Boolean(thumbImpression) : hasDrawn) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      {(selectedSigningMethod === 'digital_thumb_impression' ? Boolean(thumbImpression) : hasDrawn)
                        ? selectedSigningMethod === 'digital_thumb_impression' ? '✓ Thumb Impression' : '✓ Signature'
                        : selectedSigningMethod === 'digital_thumb_impression' ? '• Thumb Impression' : '• Signature'}
                    </span>
                    <span className={consentChecked ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      {consentChecked ? '✓ Consent' : '• Consent'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSignAndSubmit}
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors shadow-subtle flex items-center justify-center gap-1.5"
                >
                  <PenTool size={13} />
                  <span>{submitting ? 'Submitting...' : 'Sign and submit'}</span>
                </button>

                {!showRejectBox ? (
                  <button
                    type="button"
                    onClick={() => setShowRejectBox(true)}
                    className="w-full py-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    Decline to sign
                  </button>
                ) : (
                  <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50/50 dark:bg-rose-950/20 space-y-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for declining..."
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={handleRejectAgreement}
                        className="flex-1 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-medium"
                      >
                        Confirm Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowRejectBox(false)}
                        className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-[11px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: AGREEMENT SIGNED */}
          {!loadingPortal && !portalError && !isBlockedStatus && step === 3 && (() => {
            const completion = getCompletionBannerState({ submitResult, portalData });
            return (
              <div className="flex flex-col justify-between flex-1 space-y-6">
                <div className="space-y-5 pt-1">
                  <div className="flex items-center gap-2">
                    {branding.logoUrl ? (
                      <img src={branding.logoUrl} alt={brandTitle} className="h-6 max-w-[120px] object-contain" />
                    ) : null}
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {brandTitle}
                    </h3>
                  </div>

                  <div className="flex justify-start">
                    <div
                      className={`w-12 h-12 rounded-full border flex items-center justify-center ${
                        completion.isCompleted
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400'
                          : 'bg-brand-50 dark:bg-brand-950/60 border-brand-200 dark:border-brand-800 text-brand-600 dark:text-brand-400'
                      }`}
                    >
                      {completion.isCompleted ? <Check size={24} strokeWidth={2.5} /> : <Clock size={22} />}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                      {completion.headline}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {completion.subtext}
                    </p>
                  </div>

                  {!completion.isCompleted && completion.nextSigner && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200">
                      Next required signer (#{completion.nextSigner.signing_order}):{' '}
                      <strong>{completion.nextSigner.name}</strong> ({completion.nextSigner.email})
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleDownloadSignedPDF}
                    className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle flex items-center justify-center gap-1.5"
                  >
                    <Download size={13} />
                    <span>{completion.isCompleted ? 'Download Signed PDF' : 'Download Signed Copy'}</span>
                  </button>

                  <div className="text-[11px] font-mono text-slate-400">
                    {activeAgreement?.agreement_number || activeAgreement?.id} · Status: {completion.status}
                  </div>
                </div>

                <div className="text-center pt-6 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] text-slate-400">
                    Powered by Genemax Sign
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
