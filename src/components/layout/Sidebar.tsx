import React from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Layers, 
  Receipt, 
  BarChart3, 
  Users, 
  Palette, 
  CreditCard,
  Building2,
  BadgePercent,
  LineChart,
  Plug,
  ShieldAlert,
  ToggleLeft,
  ShieldCheck,
  ChevronRight,
  ExternalLink,
  LogOut
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import gsignLogo from '../../assets/gsign_logo.png';

export const Sidebar: React.FC = () => {
  const { 
    activeView, 
    setActiveView, 
    currentRole, 
    setCurrentRole, 
    currentUser,
    setCurrentUser,
    branding, 
    agreements,
    setRecipientModalOpen,
    setSigningAgreement,
    addToast
  } = useApp();

  const isPlatformOwner = currentRole === 'platform_owner';
  const isSuperAdmin = currentRole === 'super_admin' || isPlatformOwner;

  // Pending count for badge
  const pendingCount = agreements.filter(a => a.status === 'Awaiting signature' || a.status === 'Awaiting OTP').length;

  interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    onClick?: () => void;
  }

  const tenantNavItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} />, onClick: () => setActiveView('dashboard') },
    { id: 'agreements', label: 'Agreements', icon: <FileText size={17} />, badge: pendingCount, onClick: () => setActiveView('agreements') },
    { id: 'templates', label: 'Templates', icon: <Layers size={17} />, onClick: () => setActiveView('templates') },
    { id: 'documents_receipts', label: 'Documents & Receipts', icon: <Receipt size={17} />, onClick: () => setActiveView('documents_receipts') },
    { id: 'reports', label: 'Reports', icon: <BarChart3 size={17} />, onClick: () => setActiveView('reports') },
    { id: 'team_roles', label: 'Team & Roles', icon: <Users size={17} />, onClick: () => setActiveView('team_roles') },
    { id: 'branding_domain', label: 'Branding & Domain', icon: <Palette size={17} />, onClick: () => setActiveView('branding_domain') },
    { id: 'subscription', label: 'Subscription', icon: <CreditCard size={17} />, onClick: () => setActiveView('subscription') },
  ];

  const superAdminNavItems: NavItem[] = [
    { id: 'superadmin_tenants', label: 'Tenants', icon: <Building2 size={17} />, onClick: () => setActiveView('superadmin_tenants') },
    { id: 'templates', label: 'Templates', icon: <Layers size={17} />, onClick: () => setActiveView('templates') },
    { id: 'superadmin_pricing', label: 'Plans & Pricing', icon: <BadgePercent size={17} />, onClick: () => setActiveView('superadmin_pricing') },
    { id: 'superadmin_analytics', label: 'Usage Analytics', icon: <LineChart size={17} />, onClick: () => setActiveView('superadmin_analytics') },
    { 
      id: 'superadmin_integrations', 
      label: 'Integrations', 
      icon: <Plug size={17} />, 
      onClick: () => setActiveView('superadmin_integrations') 
    },
    { 
      id: 'superadmin_support', 
      label: 'Support Access', 
      icon: <ShieldAlert size={17} />, 
      onClick: () => setActiveView('superadmin_support') 
    },
    { 
      id: 'superadmin_flags', 
      label: 'Feature Flags', 
      icon: <ToggleLeft size={17} />, 
      onClick: () => setActiveView('superadmin_flags') 
    },
  ];

  const items = isSuperAdmin ? superAdminNavItems : tenantNavItems;

  const handleLaunchSignatoryDemo = () => {
    const target = agreements.find(a => a.status === 'Awaiting OTP') || agreements[1] || agreements[0];
    setSigningAgreement(target);
    setRecipientModalOpen(true);
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex flex-col justify-between h-screen sticky top-0 border-r border-slate-200 dark:border-slate-800 z-30 select-none transition-colors duration-200">
      <div className="flex flex-col flex-1 overflow-y-auto">
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setActiveView(isSuperAdmin ? 'superadmin_tenants' : 'dashboard')}
            className="flex items-center focus:outline-none group text-left"
            title="Go to Dashboard"
          >
            <div className="rounded-md transition-colors dark:bg-white dark:px-2.5 dark:py-1">
              <img
                src={branding.logoUrl || gsignLogo}
                alt="GSign"
                className="h-8 w-auto max-w-[160px] object-contain transition-opacity group-hover:opacity-90"
              />
            </div>
          </button>
          {isSuperAdmin && (
            <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              Root
            </span>
          )}
        </div>

        {/* Quick Portal Switch */}
        <div className="px-3 pt-3">
          <button
            onClick={handleLaunchSignatoryDemo}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <span>Signatory Portal Demo</span>
            <ExternalLink size={12} className="text-slate-400 dark:text-slate-500" />
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="p-3 space-y-0.5 mt-1">
          {items.map(item => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                id={item.id}
                onClick={item.onClick}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-brand-600 text-white font-semibold shadow-subtle'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && item.badge > 0 && (
                  <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
                    isActive 
                      ? 'bg-white/20 text-white' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 transition-colors">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-subtle">
          <div className="w-6 h-6 rounded bg-brand-600 flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0">
            {isPlatformOwner ? 'GM' : (currentUser?.fullName?.slice(0, 2).toUpperCase() || 'GS')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-slate-900 dark:text-white truncate">
              {isPlatformOwner
                ? 'Genemax IT Solution'
                : (currentUser?.fullName || 'Workspace User')}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {currentUser?.email || (isPlatformOwner ? 'genemaxitsolution@gmail.com' : '')}
            </p>
          </div>
          <ShieldCheck size={14} className="text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
        </div>

        <button
          type="button"
          onClick={async () => {
            await api.logout().catch(() => {});
            sessionStorage.removeItem('gsign_active_view');
            setCurrentUser(null);
            setCurrentRole('company_admin');
            setActiveView('signin');
            addToast('Signed Out', 'Your session has been ended.', 'info');
          }}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 dark:hover:border-rose-900/60 transition-colors cursor-pointer"
        >
          <LogOut size={13} />
          <span>Sign out</span>
        </button>

        {/* Powered By Genemax Sign */}
        {!branding.hidePoweredBy && (
          <div className="mt-2 text-center">
            <span className="text-[10px] text-slate-500 dark:text-slate-500">
              Powered by <strong className="text-slate-700 dark:text-slate-400 font-medium">Genemax Sign</strong>
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
