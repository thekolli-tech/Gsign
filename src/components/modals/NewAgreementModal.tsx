import React, { useState, useEffect, useRef } from 'react';
import { X, Send, ArrowRight, ArrowLeft, CheckCircle2, Plus, Trash2, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Department, TemplateField, TemplateType } from '../../types';
import {
  normalizeFieldCoordinates,
  computeClickCoordinates,
  validateAgreementPreparation,
  buildAgreementPreviewModel,
} from '../../utils/documentPreparation';

const DEFAULT_PREPARED_FIELDS: TemplateField[] = [
  normalizeFieldCoordinates(
    {
      id: 'prep-sig-1',
      type: 'Signature',
      label: 'Recipient Signature',
      required: true,
      signingMethod: 'Basic electronic (drawn)',
      assignedRole: 'Recipient',
      x: 8,
      y: 74,
    },
    0,
  ),
  normalizeFieldCoordinates(
    {
      id: 'prep-date-1',
      type: 'Date',
      label: 'Signing Date',
      required: true,
      assignedRole: 'Recipient',
      x: 56,
      y: 76,
    },
    1,
  ),
];

export const NewAgreementModal: React.FC = () => {
  const {
    newAgreementModalOpen,
    setNewAgreementModalOpen,
    createAgreement,
    setActiveView,
    templates,
    branding,
  } = useApp();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('+91 ');
  const [templateType, setTemplateType] = useState<TemplateType>('Offer Letter');
  const [department, setDepartment] = useState<Department>('HR');
  const [feeAmount, setFeeAmount] = useState('50000');
  const [period, setPeriod] = useState('12 months');
  const [rawContent, setRawContent] = useState(
    'This offer is made to {{recipient_name}} for a monthly salary of {{fee_amount}} for {{period}}. The recipient agrees to the terms and clauses set out in Schedule A.',
  );
  const [signMethod, setSignMethod] = useState<'basic_drawn' | 'otp_verified' | 'aadhaar_esign'>('basic_drawn');
  const [preparedFields, setPreparedFields] = useState<TemplateField[]>(DEFAULT_PREPARED_FIELDS);
  const [activeFieldId, setActiveFieldId] = useState<string>('prep-sig-1');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const pageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!newAgreementModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setNewAgreementModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newAgreementModalOpen, submitting, setNewAgreementModalOpen]);

  if (!newAgreementModalOpen) return null;

  const handleSelectTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setTemplateType((tpl.category as TemplateType) || 'Offer Letter');
    setDepartment((tpl.department as Department) || 'HR');
    if (tpl.content) {
      setRawContent(tpl.content);
    }
    if (Array.isArray(tpl.fields) && tpl.fields.length > 0) {
      const normalized = tpl.fields.map((f, idx) => normalizeFieldCoordinates(f, idx));
      setPreparedFields(normalized);
      setActiveFieldId(normalized[0].id);
    }
  };

  const handleAddPreparedField = (type: TemplateField['type'], label: string) => {
    const newField = normalizeFieldCoordinates(
      {
        id: `prep-${Date.now()}`,
        type,
        label,
        required: type === 'Signature' || type === 'Initials' || type === 'Date',
        assignedRole: type === 'Witness' ? 'Witness' : 'Recipient',
      },
      preparedFields.length,
    );
    setPreparedFields((prev) => [...prev, newField]);
    setActiveFieldId(newField.id);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pageRef.current || !activeFieldId) return;
    const rect = pageRef.current.getBoundingClientRect();
    const active = preparedFields.find((f) => f.id === activeFieldId);
    if (!active) return;
    const coords = computeClickCoordinates({
      clientX: e.clientX,
      clientY: e.clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      fieldWidthPct: active.width,
      fieldHeightPct: active.height,
    });
    setPreparedFields((prev) =>
      prev.map((f) => (f.id === activeFieldId ? { ...f, x: coords.x, y: coords.y } : f)),
    );
  };

  const previewModel = buildAgreementPreviewModel({
    recipientName,
    recipientEmail,
    recipientPhone,
    templateType,
    department,
    feeAmount: parseInt(feeAmount, 10) || 0,
    period,
    signMethod,
    rawContent,
    fields: preparedFields,
  });

  const handleNextStep = () => {
    setValidationErrors([]);
    if (step === 2) {
      const errs: string[] = [];
      if (!recipientName.trim()) errs.push('Recipient name is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
        errs.push('A valid recipient email address is required.');
      }
      if (!recipientPhone.trim() || recipientPhone.trim().length < 6) {
        errs.push('Recipient phone number is required.');
      }
      if (errs.length > 0) {
        setValidationErrors(errs);
        return;
      }
    }
    if (step === 3) {
      const errs = validateAgreementPreparation({
        recipientName,
        recipientEmail,
        recipientPhone,
        templateType,
        content: rawContent,
        fields: preparedFields,
      });
      if (errs.length > 0) {
        setValidationErrors(errs);
        return;
      }
    }
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  };

  const handleSubmit = async (e: React.FormEvent, asDraft = false) => {
    e.preventDefault();
    if (submitting) return;
    const errs = validateAgreementPreparation({
      recipientName,
      recipientEmail,
      recipientPhone,
      templateType,
      content: rawContent,
      fields: preparedFields,
    });
    if (errs.length > 0) {
      setValidationErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAgreement({
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        recipientPhone: recipientPhone.trim(),
        templateType,
        department,
        feeAmount: parseInt(feeAmount, 10) || 0,
        period,
        signMethod,
        initialStatus: asDraft ? 'Draft' : signMethod === 'otp_verified' ? 'Awaiting OTP' : 'Awaiting signature',
        content: previewModel.renderedContent,
      });
      if (created) {
        setStep(1);
        setSelectedTemplateId('');
        setRecipientName('');
        setRecipientEmail('');
        setRecipientPhone('+91 ');
        setValidationErrors([]);
        setNewAgreementModalOpen(false);
        setActiveView('agreement_detail');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activeField = preparedFields.find((f) => f.id === activeFieldId) || preparedFields[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-agreement-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-modal space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 id="new-agreement-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
              Create & Prepare Agreement
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Step {step} of 4 ·{' '}
              {step === 1
                ? 'Template & Details'
                : step === 2
                  ? 'Recipient Assignment'
                  : step === 3
                    ? 'Prepare Document & Fields'
                    : 'Pre-Send Preview & Send'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close new agreement dialog"
            onClick={() => setNewAgreementModalOpen(false)}
            className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* 4-Step Progress Bar */}
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          {[
            { num: 1, label: '1. Template' },
            { num: 2, label: '2. Recipient' },
            { num: 3, label: '3. Fields' },
            { num: 4, label: '4. Preview' },
          ].map((item) => (
            <button
              key={item.num}
              type="button"
              onClick={() => {
                if (item.num < step) setStep(item.num as 1 | 2 | 3 | 4);
              }}
              className={`py-1.5 px-2 rounded-lg font-medium border text-left transition-colors ${
                step === item.num
                  ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700'
                  : item.num < step
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 cursor-pointer'
                    : 'bg-slate-50 dark:bg-slate-800/60 text-slate-400 border-slate-200 dark:border-slate-800 cursor-default'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {validationErrors.length > 0 && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 space-y-1"
          >
            <div className="font-semibold flex items-center gap-1.5">
              <AlertCircle size={13} />
              <span>Please resolve before continuing:</span>
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4 text-xs">
          {/* STEP 1: Template & Details */}
          {step === 1 && (
            <div className="space-y-3.5">
              {templates.length > 0 && (
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Load Saved Template (Optional)
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600"
                  >
                    <option value="">Custom Agreement / Preset</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.category} · v{t.currentVersion})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Agreement Type
                  </label>
                  <select
                    value={templateType}
                    onChange={(e) => setTemplateType(e.target.value as TemplateType)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600"
                  >
                    <option value="Offer Letter">Offer Letter</option>
                    <option value="NDA">NDA</option>
                    <option value="Vendor Agreement">Vendor Agreement</option>
                    <option value="Franchise Agreement">Franchise Agreement</option>
                    <option value="Service Contract">Service Contract</option>
                  </select>
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value as Department)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none"
                  >
                    <option value="HR">HR</option>
                    <option value="Legal">Legal</option>
                    <option value="Ops">Ops</option>
                    <option value="Sales">Sales</option>
                    <option value="Executive">Executive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Fee / Compensation Amount (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={feeAmount}
                    onChange={(e) => setFeeAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Term / Period
                  </label>
                  <input
                    type="text"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Agreement Content (supports {'{{recipient_name}}'}, {'{{fee_amount}}'}, {'{{period}}'})
                </label>
                <textarea
                  rows={4}
                  value={rawContent}
                  onChange={(e) => setRawContent(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600 leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Recipients & Signing Method */}
          {step === 2 && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Recipient Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Alok Verma"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600"
                  />
                </div>
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Recipient Email *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="alok@example.com"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Phone Number (for OTP) *
                  </label>
                  <input
                    type="text"
                    required
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600 font-mono"
                  />
                </div>
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Signing Verification Method
                  </label>
                  <select
                    value={signMethod}
                    onChange={(e) => setSignMethod(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
                  >
                    <option value="basic_drawn">Basic electronic (drawn signature)</option>
                    <option value="otp_verified">Email OTP Verified</option>
                    <option value="aadhaar_esign" disabled>
                      Aadhaar eSign (Unavailable — Not Integrated)
                    </option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Prepare Document & Field Placement */}
          {step === 3 && (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-slate-500 mr-1">Add field:</span>
                {(['Signature', 'Thumb Impression', 'Initials', 'Date', 'Text', 'Checkbox'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleAddPreparedField(t, `${t} Field`)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-950/40 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[11px] font-medium"
                  >
                    <Plus size={11} />
                    {t}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* Click-to-place normalized A4 canvas */}
                <div className="md:col-span-7">
                  <div
                    ref={pageRef}
                    onClick={handleCanvasClick}
                    title="Click anywhere on the page to move the selected field"
                    className="relative w-full aspect-[210/297] max-h-[300px] bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-4 overflow-hidden cursor-crosshair select-none"
                  >
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                      {branding.logoText} · Page 1 (Click to position selected field)
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-6 leading-relaxed pointer-events-none">
                      {previewModel.renderedContent}
                    </p>

                    {previewModel.normalizedFields.map((f) => {
                      const isSelected = f.id === activeFieldId;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setActiveFieldId(f.id);
                          }}
                          style={{
                            left: `${f.x}%`,
                            top: `${f.y}%`,
                            width: `${f.width}%`,
                          }}
                          className={`absolute px-2 py-1 rounded border text-left text-[10px] transition-colors ${
                            isSelected
                              ? 'bg-brand-600 text-white border-brand-700 shadow-sm z-10'
                              : 'bg-white/95 dark:bg-slate-900/95 text-slate-800 dark:text-slate-200 border-brand-400 border-dashed'
                          }`}
                        >
                          <div className="font-semibold truncate">
                            {f.label} {f.required ? '*' : ''}
                          </div>
                          <div className="text-[9px] opacity-80 truncate">
                            {f.assignedRole} · {f.x}%, {f.y}%
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected Field Inspector */}
                <div className="md:col-span-5 space-y-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Field Properties ({preparedFields.length})
                  </div>
                  {activeField ? (
                    <div className="space-y-2.5">
                      <div>
                        <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-0.5">Label</label>
                        <input
                          type="text"
                          value={activeField.label}
                          onChange={(e) =>
                            setPreparedFields((prev) =>
                              prev.map((f) => (f.id === activeField.id ? { ...f, label: e.target.value } : f)),
                            )
                          }
                          className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-0.5">Assigned To</label>
                        <select
                          value={activeField.assignedRole || 'Recipient'}
                          onChange={(e) =>
                            setPreparedFields((prev) =>
                              prev.map((f) =>
                                f.id === activeField.id ? { ...f, assignedRole: e.target.value as any } : f,
                              ),
                            )
                          }
                          className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          <option value="Recipient">Recipient</option>
                          <option value="Witness">Witness</option>
                          <option value="Sender">Sender</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activeField.required}
                            onChange={(e) =>
                              setPreparedFields((prev) =>
                                prev.map((f) => (f.id === activeField.id ? { ...f, required: e.target.checked } : f)),
                              )
                            }
                          />
                          <span>Required</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const next = preparedFields.filter((f) => f.id !== activeField.id);
                            setPreparedFields(next);
                            setActiveFieldId(next[0]?.id || '');
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:underline"
                        >
                          <Trash2 size={11} />
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400">Select or add a field to configure it.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Pre-Send Preview */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] font-medium text-amber-900 dark:text-amber-200 flex items-center justify-between">
                <span>{previewModel.previewBanner}</span>
                <span className="font-mono">{previewModel.requiredFieldsCount} required fields</span>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-[11px] border-b border-slate-200 dark:border-slate-800 pb-2">
                  <div>
                    <span className="text-slate-400 block">Recipient</span>
                    <strong className="text-slate-900 dark:text-white">
                      {previewModel.recipientSummary.name} ({previewModel.recipientSummary.email})
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Agreement & Department</span>
                    <strong className="text-slate-900 dark:text-white">
                      {previewModel.metadata.templateType} · {previewModel.metadata.department}
                    </strong>
                  </div>
                </div>

                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {previewModel.renderedContent}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Prepared Fields ({previewModel.normalizedFields.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {previewModel.normalizedFields.map((f) => (
                      <span
                        key={f.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-700 dark:text-slate-300"
                      >
                        <CheckCircle2 size={10} className="text-brand-600" />
                        {f.label} ({f.assignedRole} · {f.x}%, {f.y}%)
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Navigation */}
          <div className="pt-3 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setValidationErrors([]);
                    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  <ArrowLeft size={13} />
                  Back
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNewAgreementModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
              >
                Cancel
              </button>

              {step < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
                >
                  <span>Next</span>
                  <ArrowRight size={13} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={(e) => handleSubmit(e, true)}
                    className="px-3.5 py-1.5 rounded-lg font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60"
                  >
                    Save as Draft
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 rounded-lg font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-60 transition-colors shadow-subtle flex items-center gap-1.5"
                  >
                    <Send size={13} />
                    <span>{submitting ? 'Sending...' : 'Send Agreement'}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
