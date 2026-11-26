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
import { SuperAdminIntegrationsView } from './components/views/SuperAdminIntegrationsView';
import { SuperAdminSupportView } from './components/views/SuperAdminSupportView';
import { SuperAdminFeatureFlagsView } from './components/views/SuperAdminFeatureFlagsView';
import { SignInView } from './components/views/SignInView';
import { RegisterCompanyView } from './components/views/RegisterCompanyView';
import { PricingView } from './components/views/PricingView';
import { ContactSalesView } from './components/views/ContactSalesView';

// Modals
import { RecipientPortalModal } from './components/modals/RecipientPortalModal';
import { NewAgreementModal } from './components/modals/NewAgreementModal';

const AppContent: React.FC = () => {
  const { activeView, authLoading, currentRole } = useApp();
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
        return <DashboardView />;
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
        return isRootAdmin ? <ReportsAnalyticsView /> : <DashboardView />;
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
      case 'signin':
        return <SignInView />;
      case 'register_company':
        return <RegisterCompanyView />;
      case 'pricing':
        return <PricingView />;
      case 'contact_sales':
        return <ContactSalesView />;
      default:
        return <DashboardView />;
    }
  };

  const isStandaloneView = ['signin', 'register_company', 'pricing', 'contact_sales'].includes(activeView);

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
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-brand-600 selection:text-white transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
        <Header />
        <main className="flex-1 p-6 sm:p-8 max-w-7xl w-full mx-auto">
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
