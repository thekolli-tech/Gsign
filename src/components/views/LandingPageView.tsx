import React, { useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileCheck2,
  FileText,
  FolderKanban,
  History,
  LayoutTemplate,
  Menu,
  PenTool,
  ShieldCheck,
  Users,
  UserCheck,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import gsignLogo from '../../assets/gsign_logo.png';

const FEATURES = [
  {
    title: 'Agreement Management',
    description: 'Create, organise and track business agreements.',
    icon: FileText,
  },
  {
    title: 'Document Templates',
    description: 'Build reusable agreement templates.',
    icon: LayoutTemplate,
  },
  {
    title: 'Recipient Management',
    description: 'Assign recipients and coordinate signing workflows.',
    icon: UserCheck,
  },
  {
    title: 'Electronic Signatures',
    description: 'Support available electronic signing methods.',
    icon: PenTool,
  },
  {
    title: 'Agreement Tracking',
    description: 'Monitor agreement progress and signing status.',
    icon: CheckCircle2,
  },
  {
    title: 'Document History',
    description: 'Review agreement activity and available audit records.',
    icon: History,
  },
  {
    title: 'Team Collaboration',
    description: 'Manage business users and agreement responsibilities.',
    icon: Users,
  },
  {
    title: 'Document Access',
    description: 'Access agreement documents through the platform.',
    icon: FolderKanban,
  },
];

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Create',
    description: 'Prepare an agreement or use an existing template.',
  },
  {
    step: '02',
    title: 'Configure',
    description: 'Add recipients and assign relevant signing fields.',
  },
  {
    step: '03',
    title: 'Send',
    description: 'Share the agreement with recipients for review and signature.',
  },
  {
    step: '04',
    title: 'Track',
    description: 'Monitor signing progress and access completed agreements.',
  },
];

const AUDIENCE_LIST = [
  'Small and medium-sized businesses',
  'Enterprises and corporate teams',
  'HR and recruitment departments',
  'Sales and business development teams',
  'Service providers and consultants',
  'Businesses managing recurring agreements',
];

export const LandingPageView: React.FC = () => {
  const { setActiveView, setPreselectedPlan } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollToSection = (sectionId: string) => {
    setMobileMenuOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const goToRegister = () => {
    setMobileMenuOpen(false);
    setPreselectedPlan(null);
    setActiveView('register_company');
  };

  const goToView = (view: 'signin' | 'pricing' | 'contact_sales' | 'privacy_policy' | 'terms_conditions') => {
    setMobileMenuOpen(false);
    setActiveView(view);
  };

  return (
    <div id="top" className="min-h-screen flex flex-col bg-white text-slate-900 antialiased">
      {/* Sticky Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => scrollToSection('top')}
            className="flex items-center gap-2.5 shrink-0 focus:outline-none"
            aria-label="GSIGN Home"
          >
            <img src={gsignLogo} alt="GSIGN" className="h-8 w-auto object-contain" />
          </button>

          {/* Desktop Navigation */}
          <nav aria-label="Primary" className="hidden lg:flex items-center gap-6 text-xs font-medium text-slate-600">
            <button
              type="button"
              onClick={() => scrollToSection('top')}
              className="hover:text-brand-600 transition-colors"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('features')}
              className="hover:text-brand-600 transition-colors"
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('how-it-works')}
              className="hover:text-brand-600 transition-colors"
            >
              How It Works
            </button>
            <button
              type="button"
              onClick={() => goToView('pricing')}
              className="hover:text-brand-600 transition-colors"
            >
              Pricing
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('about-us')}
              className="hover:text-brand-600 transition-colors"
            >
              About Us
            </button>
            <button
              type="button"
              onClick={() => goToView('contact_sales')}
              className="hover:text-brand-600 transition-colors"
            >
              Contact Sales
            </button>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => goToView('signin')}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:text-brand-600 hover:bg-slate-50 transition-colors"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={goToRegister}
              className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors shadow-subtle"
            >
              Register Company
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2">
            <div className="grid grid-cols-1 gap-1 text-sm font-medium text-slate-700">
              <button type="button" onClick={() => scrollToSection('top')} className="text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                Home
              </button>
              <button type="button" onClick={() => scrollToSection('features')} className="text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                Features
              </button>
              <button type="button" onClick={() => scrollToSection('how-it-works')} className="text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                How It Works
              </button>
              <button type="button" onClick={() => goToView('pricing')} className="text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                Pricing
              </button>
              <button type="button" onClick={() => scrollToSection('about-us')} className="text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                About Us
              </button>
              <button type="button" onClick={() => goToView('contact_sales')} className="text-left px-3 py-2 rounded-lg hover:bg-slate-50">
                Contact Sales
              </button>
            </div>
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => goToView('signin')}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={goToRegister}
                className="w-full px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold"
              >
                Register Company
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-16 sm:py-24 bg-slate-50/60 border-b border-slate-200/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold">
                <Building2 size={13} />
                <span>GSIGN is a product of Genemax IT Solution Private Limited</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-tight">
                Agreements, Simplified. Business, Connected.
              </h1>

              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                GSIGN helps businesses create, manage, share and sign agreements through one organised digital platform. Simplify agreement workflows, coordinate recipients and keep track of every document from creation to completion.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => scrollToSection('what-is-gsign')}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors shadow-subtle"
                >
                  <span>Explore GSIGN</span>
                  <ArrowRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => goToView('signin')}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-sm font-semibold transition-colors"
                >
                  <span>Sign In</span>
                </button>
              </div>
            </div>

            {/* Composed Product-Interface Visual (reflecting actual GSIGN modules) */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl bg-white border border-slate-200 shadow-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img src={gsignLogo} alt="GSIGN workspace" className="h-5 w-auto object-contain" />
                    <span className="text-xs font-semibold text-slate-700">Agreement Workspace</span>
                  </div>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                    Live Tracking
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <span className="text-[11px] text-slate-500 block">Templates</span>
                      <span className="text-sm font-bold text-slate-900">Reusable Library</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <span className="text-[11px] text-slate-500 block">Recipients</span>
                      <span className="text-sm font-bold text-slate-900">Signing Order</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      <span className="text-[11px] text-slate-500 block">Documents</span>
                      <span className="text-sm font-bold text-slate-900">Audit &amp; PDF</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                    <div className="px-4 py-2.5 bg-slate-50/70 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                      <span>Agreement</span>
                      <span>Status</span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">Vendor Service Agreement</div>
                        <div className="text-[11px] text-slate-500">AGR-2026-0412 · Template: Vendor Agreement</div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                        Completed
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">Employee Offer Letter</div>
                        <div className="text-[11px] text-slate-500">AGR-2026-0418 · Awaiting Recipient Signature</div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-brand-50 text-brand-700 text-[11px] font-semibold">
                        Awaiting signature
                      </span>
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">Mutual Non-Disclosure Agreement</div>
                        <div className="text-[11px] text-slate-500">AGR-2026-0421 · 1 of 2 Recipients Signed</div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] font-semibold">
                        Partially signed
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-slate-700 font-medium">
                      <ShieldCheck size={15} className="text-brand-600" />
                      <span>Audit trail &amp; document version history recorded</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">SHA-256</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What is GSIGN? */}
        <section id="what-is-gsign" className="py-16 sm:py-20 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              What is GSIGN?
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              A Smarter Way to Manage Business Agreements
            </h2>
            <p className="text-base text-slate-600 leading-relaxed">
              GSIGN is a digital agreement management and electronic signing platform designed to streamline the way businesses prepare, organise, share and execute agreements.
            </p>
            <p className="text-base text-slate-600 leading-relaxed">
              From document preparation and reusable templates to recipient coordination, electronic signatures and agreement tracking, GSIGN brings essential agreement workflows together in one platform.
            </p>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-16 sm:py-20 bg-slate-50/70 border-y border-slate-200/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="max-w-2xl space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                Platform Capabilities
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
                Everything Needed to Coordinate Business Agreements
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className="p-6 rounded-xl bg-white border border-slate-200 hover:border-brand-300 hover:shadow-card transition-all space-y-3"
                  >
                    <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                      <Icon size={20} />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">{feature.title}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{feature.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-16 sm:py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
            <div className="max-w-2xl space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                How It Works
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
                Four Clear Steps from Draft to Completion
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {WORKFLOW_STEPS.map((item) => (
                <div
                  key={item.step}
                  className="p-6 rounded-xl bg-slate-50/80 border border-slate-200 space-y-3"
                >
                  <span className="inline-block text-xs font-mono font-bold text-brand-600 bg-brand-50 px-2.5 py-1 rounded">
                    {item.step} — {item.title}
                  </span>
                  <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who Is GSIGN For? */}
        <section className="py-16 sm:py-20 bg-slate-50/70 border-y border-slate-200/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                Who Is GSIGN For?
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
                Built for Organised Business Workflows
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Whether coordinating internal onboarding documents or external vendor contracts, GSIGN supports teams that rely on structured agreement execution.
              </p>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {AUDIENCE_LIST.map((audience) => (
                <div
                  key={audience}
                  className="p-4 rounded-xl bg-white border border-slate-200 flex items-center gap-3"
                >
                  <FileCheck2 size={18} className="text-brand-600 shrink-0" />
                  <span className="text-sm font-medium text-slate-800">{audience}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Company Ownership Section */}
        <section id="about-us" className="py-16 sm:py-20 bg-white">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="p-8 sm:p-10 rounded-2xl bg-slate-50 border border-slate-200 space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-xs font-semibold">
                <Building2 size={14} />
                <span>Product Ownership</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
                Powered by Genemax IT Solution Private Limited
              </h2>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                GSIGN is a product of Genemax IT Solution Private Limited, an IT solutions company focused on developing technology-driven products and services.
              </p>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                GSIGN is developed and operated as part of the company&apos;s technology product portfolio, with the objective of simplifying business agreement management and digital signing workflows.
              </p>

              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <img src={gsignLogo} alt="GSIGN" className="h-7 w-auto object-contain" />
                  <span className="text-xs font-medium text-slate-700">
                    GSIGN is a product of Genemax IT Solution Private Limited.
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => goToView('pricing')}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    View Pricing
                  </button>
                  <button
                    type="button"
                    onClick={() => goToView('contact_sales')}
                    className="text-xs font-semibold text-slate-700 hover:text-brand-600 hover:underline"
                  >
                    Contact Sales
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-5 space-y-3">
            <img src={gsignLogo} alt="GSIGN" className="h-8 w-auto object-contain brightness-0 invert" />
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              Digital agreement management and electronic signing platform for preparing, sharing, signing, and tracking business agreements.
            </p>
            <p className="text-xs font-semibold text-white">
              GSIGN is a product of Genemax IT Solution Private Limited.
            </p>
          </div>

          <div className="md:col-span-3 space-y-2.5 text-xs">
            <h3 className="font-semibold text-white uppercase tracking-wider text-[11px]">Platform</h3>
            <ul className="space-y-2">
              <li>
                <button type="button" onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">
                  Features
                </button>
              </li>
              <li>
                <button type="button" onClick={() => goToView('pricing')} className="hover:text-white transition-colors">
                  Pricing
                </button>
              </li>
              <li>
                <button type="button" onClick={() => goToView('contact_sales')} className="hover:text-white transition-colors">
                  Contact Sales
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-2 space-y-2.5 text-xs">
            <h3 className="font-semibold text-white uppercase tracking-wider text-[11px]">Account</h3>
            <ul className="space-y-2">
              <li>
                <button type="button" onClick={() => goToView('signin')} className="hover:text-white transition-colors">
                  Sign In
                </button>
              </li>
              <li>
                <button type="button" onClick={goToRegister} className="hover:text-white transition-colors">
                  Register Company
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-2 space-y-2.5 text-xs">
            <h3 className="font-semibold text-white uppercase tracking-wider text-[11px]">Legal</h3>
            <ul className="space-y-2">
              <li>
                <button type="button" onClick={() => goToView('privacy_policy')} className="hover:text-white transition-colors">
                  Privacy Policy
                </button>
              </li>
              <li>
                <button type="button" onClick={() => goToView('terms_conditions')} className="hover:text-white transition-colors">
                  Terms and Conditions
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
            <span>&copy; 2026 Genemax IT Solution Private Limited. All rights reserved.</span>
            <span>GSIGN — Product of Genemax IT Solution Private Limited</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
