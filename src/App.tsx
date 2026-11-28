import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ToastContainer } from './components/layout/Toast';

// Views
import { DashboardView } from './components/views/DashboardView';
import { AgreementsView } from './components/views/AgreementsView';
import { AgreementDetailView } from './components/views/AgreementDetailView';
import { TemplateBuilderView } from './components/views/TemplateBuilderView';
import { DocumentsReceiptsView } from './components/views/DocumentsReceiptsView';
import { ReportsAnalyticsView } from './components/views/ReportsAnalyticsView';
import { TeamRolesView } from './components/views/TeamRolesView';
import { BrandingDomainView } from './components/views/BrandingDomainView';
import { SubscriptionView } from './components/views/SubscriptionView';
import { SuperAdminTenantsView } from './components/views/SuperAdminTenantsView';
import { SuperAdminPricingView } from './components/views/SuperAdminPricingView';
import { SuperAdminAnalyticsView } from './components/views/SuperAdminAnalyticsView';
import { SuperAdminIntegrationsView } from './components/views/SuperAdminIntegrationsView';
import { SuperAdminSupportView } from './components/views/SuperAdminSupportView';
import { SuperAdminFeatureFlagsView } from './components/views/SuperAdminFeatureFlagsView';
import { SuperAdminSalesInquiriesView } from './components/views/SuperAdminSalesInquiriesView';
import { SignInView } from './components/views/SignInView';
import { RegisterCompanyView } from './components/views/RegisterCompanyView';
import { PricingView } from './components/views/PricingView';
import { ContactSalesView } from './components/views/ContactSalesView';
import { AcceptInviteView } from './components/views/AcceptInviteView';
import { LandingPageView } from './components/views/LandingPageView';
import { LegalView } from './components/views/LegalView';

// Modals
import { RecipientPortalModal } from './components/modals/RecipientPortalModal';
import { NewAgreementModal } from './components/modals/NewAgreementModal';

const AppContent: React.FC = () => {
  const { activeView, authLoading, currentRole } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const isRootAdmin = currentRole === 'platform_owner' || currentRole === 'super_admin';

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-xs font-medium">
        Loading GSIGN workspace...
      </div>
    );
  }

  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard':
        return isRootAdmin ? <SuperAdminTenantsView /> : <DashboardView />;
      case 'agreements':
        return <AgreementsView />;
      case 'agreement_detail':
        return <AgreementDetailView />;
      case 'templates':
        return <TemplateBuilderView />;
      case 'documents_receipts':
        return <DocumentsReceiptsView />;
      case 'reports':
        return <ReportsAnalyticsView />;
      case 'superadmin_analytics':
        return isRootAdmin ? <SuperAdminAnalyticsView /> : <DashboardView />;
      case 'team_roles':
        return <TeamRolesView />;
      case 'branding_domain':
        return <BrandingDomainView />;
      case 'subscription':
        return <SubscriptionView />;
      case 'superadmin_tenants':
        return isRootAdmin ? <SuperAdminTenantsView /> : <DashboardView />;
      case 'superadmin_pricing':
        return isRootAdmin ? <SuperAdminPricingView /> : <DashboardView />;
      case 'superadmin_integrations':
        return isRootAdmin ? <SuperAdminIntegrationsView /> : <DashboardView />;
      case 'superadmin_support':
        return isRootAdmin ? <SuperAdminSupportView /> : <DashboardView />;
      case 'superadmin_flags':
        return isRootAdmin ? <SuperAdminFeatureFlagsView /> : <DashboardView />;
      case 'superadmin_sales_inquiries':
        return isRootAdmin ? <SuperAdminSalesInquiriesView /> : <DashboardView />;
      case 'landing':
        return <LandingPageView />;
      case 'signin':
        return <SignInView />;
      case 'register_company':
        return <RegisterCompanyView />;
      case 'pricing':
        return <PricingView />;
      case 'contact_sales':
        return <ContactSalesView />;
      case 'accept_invite':
        return <AcceptInviteView />;
      case 'privacy_policy':
        return <LegalView mode="privacy" />;
      case 'terms_conditions':
        return <LegalView mode="terms" />;
      default:
        return isRootAdmin ? <SuperAdminTenantsView /> : <DashboardView />;
    }
  };

  const isStandaloneView = [
    'landing',
    'signin',
    'register_company',
    'pricing',
    'contact_sales',
    'accept_invite',
    'privacy_policy',
    'terms_conditions',
  ].includes(activeView);

  if (isStandaloneView) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
        {renderActiveView()}
        <RecipientPortalModal />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-brand-600 selection:text-white transition-colors duration-200 overflow-x-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-brand-600 focus:text-white focus:text-xs focus:font-medium"
      >
        Skip to main content
      </a>
      {/* Sidebar (drawer on mobile/tablet, fixed rail on lg+) */}
      <Sidebar isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
        <Header onOpenMenu={() => setMobileMenuOpen(true)} />
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto outline-none">
          {renderActiveView()}
        </main>
      </div>

      {/* Modals & Overlays */}
      <RecipientPortalModal />
      <NewAgreementModal />
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
