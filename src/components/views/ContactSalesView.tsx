import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import gsignLogo from '../../assets/gsign_logo.png';

export const ContactSalesView: React.FC = () => {
  const { branding, setActiveView, addToast } = useApp();

  const [fullName, setFullName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [teamSize, setTeamSize] = useState('11-50');
  const [monthlyAgreements, setMonthlyAgreements] = useState('250-1000');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    addToast('Inquiry Received', 'Our enterprise sales team will reach out within 4 business hours.', 'success');
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 transition-colors duration-200">
      {/* Top Header */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <img
            src={branding.logoUrl || gsignLogo}
            alt="GSIGN"
            className="h-8 w-auto max-w-[160px] object-contain cursor-pointer"
            onClick={() => setActiveView('signin')}
          />
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveView('signin')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Sign in
          </button>
          <button
            onClick={() => setActiveView('pricing')}
            className="text-slate-600 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            Pricing
          </button>
          <button
            onClick={() => setActiveView('register_company')}
            className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors shadow-subtle"
          >
            Register Company
          </button>
        </div>
      </div>

      {/* Main Form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-lg p-7 sm:p-9 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-modal space-y-6">
          {!submitted ? (
            <>
              <div className="space-y-1.5 text-center">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  Contact Enterprise Sales
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Discuss custom agreements capacity, dedicated tenant hosting, and SLA guarantees
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sumanth Rao"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="sumanth@enterprise.com"
                      value={workEmail}
                      onChange={e => setWorkEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Global Logistics Private Limited"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Team Size
                    </label>
                    <select
                      value={teamSize}
                      onChange={e => setTeamSize(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    >
                      <option value="1-10">1 - 10 members</option>
                      <option value="11-50">11 - 50 members</option>
                      <option value="51-250">51 - 250 members</option>
                      <option value="250+">250+ members</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                      Monthly Agreements
                    </label>
                    <select
                      value={monthlyAgreements}
                      onChange={e => setMonthlyAgreements(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600"
                    >
                      <option value="50-250">50 - 250 / mo</option>
                      <option value="250-1000">250 - 1,000 / mo</option>
                      <option value="1000-5000">1,000 - 5,000 / mo</option>
                      <option value="5000+">5,000+ / mo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Requirements & Use Case (Optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Tell us about your document workflows, custom integrations, or compliance needs..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white outline-none focus:border-brand-600 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
                >
                  Submit Enterprise Inquiry →
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-8 space-y-4 text-xs">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-2xl font-bold">
                ✓
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Thank You, {fullName}!
              </h2>
              <p className="text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                We have received your enterprise inquiry for <strong>{companyName}</strong>. A dedicated solutions specialist from Genemax will connect with you shortly.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => setActiveView('signin')}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium"
                >
                  Return to Login
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-2 text-[11px] text-slate-400">
        Powered by Genemax IT Solution Private Limited • GSIGN Enterprise Platform
      </div>
    </div>
  );
};
