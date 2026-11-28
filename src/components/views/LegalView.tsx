import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import gsignLogo from '../../assets/gsign_logo.png';

interface LegalViewProps {
  mode: 'privacy' | 'terms';
}

export const LegalView: React.FC<LegalViewProps> = ({ mode }) => {
  const { setActiveView, setPreselectedPlan } = useApp();
  const isPrivacy = mode === 'privacy';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setActiveView('landing')}
            className="flex items-center gap-2 focus:outline-none"
          >
            <img src={gsignLogo} alt="GSIGN" className="h-8 w-auto object-contain" />
          </button>
          <div className="flex items-center gap-4 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveView('landing')}
              className="text-slate-600 hover:text-brand-600 transition-colors"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => setActiveView('pricing')}
              className="text-slate-600 hover:text-brand-600 transition-colors"
            >
              Pricing
            </button>
            <button
              type="button"
              onClick={() => setActiveView('contact_sales')}
              className="text-slate-600 hover:text-brand-600 transition-colors"
            >
              Contact Sales
            </button>
            <button
              type="button"
              onClick={() => setActiveView('signin')}
              className="text-slate-600 hover:text-brand-600 transition-colors"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setPreselectedPlan(null);
                setActiveView('register_company');
              }}
              className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold transition-colors"
            >
              Register Company
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-12 space-y-6">
        <button
          type="button"
          onClick={() => setActiveView('landing')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
        >
          <ArrowLeft size={14} />
          <span>Back to GSIGN Home</span>
        </button>

        <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-card space-y-5">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Genemax IT Solution Private Limited
            </span>
            <h1 className="text-2xl font-bold text-slate-900">
              {isPrivacy ? 'Privacy Policy' : 'Terms and Conditions'}
            </h1>
          </div>

          {isPrivacy ? (
            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <p>
                GSIGN is a product of Genemax IT Solution Private Limited. This notice outlines how information submitted within the GSIGN platform is handled during workspace administration, agreement preparation, and signing workflows.
              </p>
              <p>
                Account details, company workspace records, agreement templates, uploaded documents, and signing audit logs are stored solely to operate the GSIGN service for your organisation and its designated recipients.
              </p>
              <p>
                Session cookies are used strictly for authenticated workspace access and security enforcement. For enterprise inquiries or account assistance, please use the Contact Sales page.
              </p>
            </div>
          ) : (
            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <p>
                GSIGN is developed and operated by Genemax IT Solution Private Limited. By registering a company workspace or accessing an agreement signing link on GSIGN, you agree to use the platform solely for lawful business agreement workflows.
              </p>
              <p>
                Organisations are responsible for the accuracy of agreement content, recipient details, and workspace user permissions configured within their tenant.
              </p>
              <p>
                Completion certificates and audit trails reflect recorded platform events and document hashes generated within GSIGN. Subscription plans and billing terms are presented on the Pricing page prior to checkout.
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-5 px-4 text-center text-xs text-slate-500">
        GSIGN is a product of Genemax IT Solution Private Limited. &copy; 2026 Genemax IT Solution Private Limited.
      </footer>
    </div>
  );
};
