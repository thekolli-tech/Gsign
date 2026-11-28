import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Sun, 
  Moon, 
  Plus, 
  Command,
  FileCheck2,
  LogOut,
  Menu
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface HeaderProps {
  onOpenMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMenu }) => {
  const { 
    theme, 
    toggleTheme, 
    activeView, 
    setNewAgreementModalOpen, 
    branding,
    agreements,
    setSelectedAgreementId,
    setActiveView,
    currentRole,
    currentUser,
    logout,
    addToast
  } = useApp();

  const isRootAdmin = currentRole === 'platform_owner' || currentRole === 'super_admin';

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Keyboard shortcut Ctrl+J for theme switch
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTheme]);

  const filtered = searchQuery.trim()
    ? agreements.filter(
        a =>
          a.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.recipientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.templateType.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.status.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const getTitle = () => {
    const tenantLabel = currentUser?.tenantName || 'Company Workspace';
    switch (activeView) {
      case 'dashboard':
        return { main: 'Dashboard', sub: tenantLabel };
      case 'agreements':
        return { main: 'Agreements', sub: 'All agreements across departments' };
      case 'agreement_detail':
        return { main: 'Agreement Details', sub: 'Audit trail and verification' };
      case 'templates':
        return { main: 'Templates', sub: 'Reusable agreement templates and clauses' };
      case 'documents_receipts':
        return { main: 'Documents & Receipts', sub: 'Receipts are issued only after confirmed payment' };
      case 'reports':
        return { main: 'Reports & Analytics', sub: 'Turnaround time, compliance & signature velocity' };
      case 'team_roles':
        return { main: 'Team & Roles', sub: 'Invite, deactivate and assign roles' };
      case 'branding_domain':
        return { main: 'Branding & Domain', sub: 'Your customers see your brand, not ours' };
      case 'subscription':
        return { main: 'Subscription', sub: 'Manage your active plan, usage quota & billing invoices' };
      case 'superadmin_tenants':
        return { main: 'Tenants', sub: 'Genemax IT Solution · All customer companies' };
      case 'superadmin_pricing':
        return { main: 'Plans & Pricing', sub: 'Genemax IT Solution · Change prices, limits and add-ons without code' };
      case 'superadmin_analytics':
        return { main: 'Usage Analytics', sub: 'Genemax IT Solution · Global document throughput & signature volumes' };
      case 'superadmin_integrations':
        return { main: 'Integrations', sub: 'Genemax IT Solution · Live infrastructure & eSign gateway status' };
      case 'superadmin_support':
        return { main: 'Support Access', sub: 'Genemax IT Solution · Audit-logged, time-boxed workspace support sessions' };
      case 'superadmin_flags':
        return { main: 'Feature Flags', sub: 'Genemax IT Solution · Per-tenant capability toggles persisted in PostgreSQL' };
      case 'superadmin_sales_inquiries':
        return { main: 'Sales Inquiries', sub: 'Genemax IT Solution · Enterprise sales pipeline & confidential notes' };
      default:
        return { main: 'GSIGN Hub', sub: branding.logoText };
    }
  };

  const titleInfo = getTitle();

  return (
    <header className="sticky top-0 z-20 w-full h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2 transition-colors duration-200">
      {/* Mobile Menu + Title & Organization Subhead */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex-shrink-0"
        >
          <Menu size={17} />
        </button>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-white leading-tight truncate">
            {titleInfo.main}
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-normal truncate">
            {titleInfo.sub}
          </p>
        </div>
      </div>

      {/* Center Search & Actions */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {/* Search Input with quick matching popup */}
        <div className="hidden md:block relative w-52 lg:w-72">
          <div className="flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600 transition-colors">
            <Search size={15} className="text-slate-400 mr-2 flex-shrink-0" />
            <input
              type="text"
              aria-label="Search agreements by number, party, or status"
              placeholder="Search by number, party, status"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setShowSearchResults(true);
              }}
              onFocus={() => setShowSearchResults(true)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setShowSearchResults(false);
                }
              }}
              className="bg-transparent border-none outline-none w-full text-xs font-normal placeholder-slate-400 text-slate-900 dark:text-slate-100"
            />
            <div className="hidden sm:flex items-center text-[10px] text-slate-400 border border-slate-200 dark:border-slate-700 px-1 rounded font-mono">
              <Command size={10} className="mr-0.5" />K
            </div>
          </div>

          {/* Search dropdown results */}
          {showSearchResults && searchQuery.trim().length > 0 && (
            <div 
              className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-dropdown overflow-hidden z-50"
              onMouseLeave={() => setShowSearchResults(false)}
            >
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Matching Documents ({filtered.length})
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.length === 0 ? (
                  <div className="p-3 text-xs text-center text-slate-500">No matching agreements found.</div>
                ) : (
                  filtered.map(ag => (
                    <button
                      key={ag.id}
                      type="button"
                      onClick={() => {
                        setSelectedAgreementId(ag.id);
                        setActiveView('agreement_detail');
                        setShowSearchResults(false);
                        setSearchQuery('');
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center justify-between transition-colors group"
                    >
                      <div>
                        <div className="text-xs font-medium text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 flex items-center gap-1.5">
                          <FileCheck2 size={13} className="text-brand-600 dark:text-brand-400" />
                          {ag.id} · {ag.recipientName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {ag.templateType} · {ag.department}
                        </div>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300">
                        {ag.status}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle Button (Light / Dark) */}
        <button
          id="theme-toggle"
          data-testid="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle Light/Dark Theme"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode (Ctrl+J)`}
          className="relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer select-none text-xs font-medium"
        >
          {theme === 'dark' ? (
            <>
              <Sun size={15} className="text-amber-400" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon size={15} className="text-slate-700" />
              <span>Dark</span>
            </>
          )}
        </button>

        {/* New Agreement Action Button (Tenant workspaces only) */}
        {!isRootAdmin && (
          <button
            type="button"
            onClick={() => setNewAgreementModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg font-medium text-xs text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle cursor-pointer"
          >
            <Plus size={15} strokeWidth={2} />
            <span className="hidden sm:inline">+ New agreement</span>
          </button>
        )}

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={async () => {
            await logout();
            addToast('Signed Out', 'Your session has been ended.', 'info');
          }}
          title="Sign out"
          aria-label="Sign out"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
};
