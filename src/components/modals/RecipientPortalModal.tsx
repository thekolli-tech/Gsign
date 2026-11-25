import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Smartphone, 
  Monitor, 
  RotateCcw, 
  Check, 
  Download, 
  PenTool
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { jsPDF } from 'jspdf';

export const RecipientPortalModal: React.FC = () => {
  const { 
    recipientModalOpen, 
    setRecipientModalOpen, 
    signingAgreement, 
    completeSigning, 
    branding,
    addToast
  } = useApp();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [deviceMode, setDeviceMode] = useState<'mobile' | 'desktop'>('mobile');

  // OTP State (Step 1)
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [timer, setTimer] = useState(30);

  // Signature State (Step 2)
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const agreement = signingAgreement || {
    id: 'AGR-2026-0411',
    recipientName: 'Meera Iyer',
    recipientPhone: '+91 99881 24821',
    recipientEmail: 'meera.iyer@fintech.io',
    feeAmount: 45000,
    period: '12 months',
    templateType: 'Offer Letter',
    content: 'This offer is made to Meera Iyer for a monthly fee of ₹45,000 for the period of 12 months. The recipient agrees to the terms set out in Schedule A…'
  };

  // OTP Countdown
  useEffect(() => {
    if (!recipientModalOpen || step !== 1) return;
    if (timer > 0) {
      const interval = setInterval(() => setTimer(t => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [recipientModalOpen, step, timer]);

  // Handle OTP inputs
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    // Auto move to next input
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleFillDemoOtp = () => {
    setOtp(['4', '8', '2', '1', '9', '0']);
    addToast('OTP Applied', 'Demo code 482190 entered', 'info');
  };

  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    const entered = otp.join('');
    if (entered.length < 6) {
      addToast('Invalid Code', 'Please enter complete 6-digit code', 'warning');
      return;
    }
    setStep(2);
    addToast('Identity Verified', 'SMS verification successful', 'success');
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

  const handleSignAndSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentChecked) {
      addToast('Consent Required', 'Please confirm acknowledgment checkbox', 'warning');
      return;
    }

    let sigData = '';
    if (canvasRef.current) {
      sigData = canvasRef.current.toDataURL('image/png');
    }

    completeSigning(agreement.id, sigData);
    setStep(3);
  };

  const handleDownloadSignedPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFillColor(91, 19, 236);
      doc.rect(0, 0, 210, 14, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(branding.logoText, 20, 9.5);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(16);
      doc.text('SIGNED AGREEMENT', 20, 32);

      doc.setFontSize(9.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Reference: ${agreement.id}   |   Date: 25 Nov 2026`, 20, 40);

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(agreement.content, 170), 20, 56);

      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(20, 95, 170, 38, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(91, 19, 236);
      doc.text('VERIFIED ELECTRONIC SIGNATURE', 25, 104);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);
      doc.text(`Signer: ${agreement.recipientName}`, 25, 112);
      doc.text(`Authentication: OTP SMS Verified (+91 ••••• 4821)`, 25, 118);
      doc.text(`Hash: e8a9103c... verified tamper-proof`, 25, 124);

      doc.save(`Signed_${agreement.id}.pdf`);
      addToast('Download Complete', 'Signed agreement saved to your device', 'success');
    } catch (e) {
      console.error(e);
    }
  };

  if (!recipientModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      {/* Top Device switcher & Close button bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2.5 z-50">
        <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-slate-300 text-xs">
          <button
            onClick={() => setDeviceMode('mobile')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors ${
              deviceMode === 'mobile' ? 'bg-slate-700 text-white' : 'hover:text-white'
            }`}
          >
            <Smartphone size={13} />
            <span>Mobile</span>
          </button>
          <button
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
          onClick={() => {
            setRecipientModalOpen(false);
            setStep(1);
          }}
          className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Container: Mobile Frame vs Desktop */}
      <div
        className={`w-full transition-all ${
          deviceMode === 'mobile'
            ? 'max-w-[390px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-modal overflow-hidden'
            : 'max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-modal p-6 sm:p-8'
        }`}
      >
        <div className="p-6 sm:p-7 flex flex-col justify-between min-h-[500px]">
          {/* STEP 1: VERIFY IT IS YOU (Exact match to pages 13 & 27) */}
          {step === 1 && (
            <div className="flex flex-col justify-between flex-1 space-y-6">
              <div className="space-y-5">
                {/* Brand Title matching screenshot */}
                <div className="flex items-center gap-2">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt={branding.logoText} className="h-6 max-w-[120px] object-contain" />
                  ) : null}
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {branding.logoText}
                  </h3>
                </div>

                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                    Verify it is you
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    We sent a 6-digit email code to <strong className="text-slate-800 dark:text-slate-200">{agreement.recipientEmail}</strong>.
                  </p>
                </div>

                {/* 6 OTP Input Boxes */}
                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <div className="flex items-center justify-between gap-1.5">
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={el => { otpRefs.current[idx] = el; }}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={e => handleOtpChange(idx, e.target.value)}
                        onKeyDown={e => handleOtpKeyDown(idx, e)}
                        className="w-11 h-12 text-center text-lg font-semibold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-brand-600 focus:ring-1 focus:ring-brand-600 text-slate-900 dark:text-white outline-none transition-colors"
                      />
                    ))}
                  </div>

                  {/* Demo auto-fill helper */}
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleFillDemoOtp}
                      className="text-[11px] text-brand-600 dark:text-brand-400 hover:underline font-medium"
                    >
                      Fill sample OTP (482190)
                    </button>
                  </div>

                  {/* Verify and continue button matching screenshot */}
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
                  >
                    Verify and continue
                  </button>

                  {/* Resend code in 30s matching screenshot */}
                  <div className="text-center">
                    {timer > 0 ? (
                      <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
                        Resend code in {timer}s
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTimer(30);
                          addToast('Code Resent', 'New verification code sent', 'info');
                        }}
                        className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        Resend code now
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Powered By Footer matching screenshot */}
              <div className="text-center pt-6 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] text-slate-400">
                  Powered by Genemax Sign
                </span>
              </div>
            </div>
          )}

          {/* STEP 2: REVIEW AND SIGN (Exact match to pages 3 & 17) */}
          {step === 2 && (
            <div className="flex flex-col justify-between flex-1 space-y-5">
              <div className="space-y-4">
                {/* Header matching screenshot */}
                <div>
                  <div className="flex items-center gap-2">
                    {branding.logoUrl ? (
                      <img src={branding.logoUrl} alt={branding.logoText} className="h-5 max-w-[100px] object-contain" />
                    ) : null}
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {branding.logoText}
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {agreement.templateType} · {agreement.id}
                  </p>
                </div>

                {/* Stepper matching screenshot: Step 2 of 3 · Review and sign */}
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

                {/* Agreement preview box matching screenshot */}
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {agreement.content}
                </div>

                {/* Draw your signature section matching screenshot */}
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

                  {/* Signature Canvas Box with blue dashed border */}
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
                        Sign here with your finger
                      </div>
                    )}
                  </div>
                </div>

                {/* Consent Checkbox matching screenshot */}
                <div className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="consent-check"
                    checked={consentChecked}
                    onChange={e => setConsentChecked(e.target.checked)}
                    className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                  />
                  <label htmlFor="consent-check" className="text-[11px] text-slate-600 dark:text-slate-400 leading-normal cursor-pointer">
                    I have read the full agreement and consent to sign it electronically.
                  </label>
                </div>

                <div className="text-[10px] text-slate-400">
                  Basic electronic signature · OTP verified
                </div>
              </div>

              {/* Sign and submit button matching screenshot */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleSignAndSubmit}
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle flex items-center justify-center gap-1.5"
                >
                  <PenTool size={13} />
                  <span>Sign and submit</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: AGREEMENT SIGNED (Exact match to pages 14 & 28) */}
          {step === 3 && (
            <div className="flex flex-col justify-between flex-1 space-y-6">
              <div className="space-y-5 pt-1">
                <div className="flex items-center gap-2">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt={branding.logoText} className="h-6 max-w-[120px] object-contain" />
                  ) : null}
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {branding.logoText}
                  </h3>
                </div>

                {/* Circular Green Checkmark matching screenshot */}
                <div className="flex justify-start">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Check size={24} strokeWidth={2.5} />
                  </div>
                </div>

                {/* Title & confirmation message */}
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                    Agreement signed
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    A copy of the signed PDF has been emailed to you and {branding.logoText}.
                  </p>
                </div>

                {/* Download PDF button matching screenshot */}
                <button
                  type="button"
                  onClick={handleDownloadSignedPDF}
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle flex items-center justify-center gap-1.5"
                >
                  <Download size={13} />
                  <span>Download PDF</span>
                </button>

                <div className="text-[11px] font-mono text-slate-400">
                  {agreement.id} · Basic electronic signature
                </div>
              </div>

              {/* Powered By Footer matching screenshot */}
              <div className="text-center pt-6 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] text-slate-400">
                  Powered by Genemax Sign
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
