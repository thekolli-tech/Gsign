import React, { useState } from 'react';
import { X, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Department, TemplateType } from '../../types';

export const NewAgreementModal: React.FC = () => {
  const { newAgreementModalOpen, setNewAgreementModalOpen, createAgreement, setActiveView } = useApp();

  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('+91 ');
  const [templateType, setTemplateType] = useState<TemplateType>('Offer Letter');
  const [department, setDepartment] = useState<Department>('HR');
  const [feeAmount, setFeeAmount] = useState('50000');
  const [period, setPeriod] = useState('12 months');
  const [signMethod, setSignMethod] = useState<'basic_drawn' | 'otp_verified' | 'aadhaar_esign'>('basic_drawn');
  const [submitting, setSubmitting] = useState(false);

  if (!newAgreementModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent, asDraft = false) => {
    e.preventDefault();
    if (!recipientName || !recipientEmail || submitting) return;
    setSubmitting(true);
    try {
      const created = await createAgreement({
        recipientName,
        recipientEmail,
        recipientPhone,
        templateType,
        department,
        feeAmount: parseInt(feeAmount) || 0,
        period,
        signMethod,
        initialStatus: asDraft ? 'Draft' : signMethod === 'otp_verified' ? 'Awaiting OTP' : 'Awaiting signature',
        content: `This offer is made to ${recipientName} for a monthly fee of ₹${Number(feeAmount || 0).toLocaleString('en-IN')} for ${period}. The recipient agrees to the terms and clauses set out in Schedule A.`
      });
      if (created) {
        setNewAgreementModalOpen(false);
        setActiveView('agreement_detail');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-7 w-full max-w-lg shadow-modal space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Create New Agreement
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Generate secure agreement and signature invite link
            </p>
          </div>
          <button
            onClick={() => setNewAgreementModalOpen(false)}
            className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Alok Verma"
                value={recipientName}
                onChange={e => setRecipientName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600"
              />
            </div>

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Recipient Email
              </label>
              <input
                type="email"
                required
                placeholder="alok@example.com"
                value={recipientEmail}
                onChange={e => setRecipientEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Phone Number (for OTP)
              </label>
              <input
                type="text"
                required
                value={recipientPhone}
                onChange={e => setRecipientPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600 font-mono"
              />
            </div>

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Template
              </label>
              <select
                value={templateType}
                onChange={e => setTemplateType(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none focus:border-brand-600 cursor-pointer"
              >
                <option value="Offer Letter">Offer Letter</option>
                <option value="NDA">NDA</option>
                <option value="Vendor Agreement">Vendor Agreement</option>
                <option value="Franchise Agreement">Franchise Agreement</option>
                <option value="Service Contract">Service Contract</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Department
              </label>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value as any)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
              >
                <option value="HR">HR</option>
                <option value="Legal">Legal</option>
                <option value="Ops">Ops</option>
                <option value="Sales">Sales</option>
                <option value="Executive">Executive</option>
              </select>
            </div>

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Fee Amount (₹)
              </label>
              <input
                type="number"
                value={feeAmount}
                onChange={e => setFeeAmount(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none font-mono"
              />
            </div>

            <div>
              <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                Period
              </label>
              <input
                type="text"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
              Signing Method
            </label>
            <select
              value={signMethod}
              onChange={e => setSignMethod(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 outline-none cursor-pointer"
            >
              <option value="basic_drawn">Basic electronic (drawn signature)</option>
              <option value="otp_verified">Email OTP Verified</option>
              <option value="aadhaar_esign">Aadhaar eSign</option>
            </select>
          </div>

          <div className="pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setNewAgreementModalOpen(false)}
              className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !recipientName || !recipientEmail}
              onClick={(e) => handleSubmit(e, true)}
              className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 font-medium"
            >
              Save as Draft
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 font-medium shadow-subtle"
            >
              <Send size={13} />
              <span>{submitting ? 'Saving...' : 'Create & Send'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
