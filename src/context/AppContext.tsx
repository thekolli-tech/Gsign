import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  Agreement, 
  Receipt, 
  TeamMember, 
  Tenant, 
  PricingPlan, 
  BrandingSettings, 
  ThemeMode,
  UserRole,
  AgreementTemplate
} from '../types';
import { api } from '../services/api';
import { restoreAppSession, performAppLogout } from './sessionLifecycle';

export type ActiveView = 
  | 'dashboard' 
  | 'agreements' 
  | 'agreement_detail' 
  | 'templates' 
  | 'documents_receipts' 
  | 'reports' 
  | 'team_roles' 
  | 'branding_domain' 
  | 'subscription' 
  | 'superadmin_tenants' 
  | 'superadmin_pricing' 
  | 'superadmin_analytics'
  | 'superadmin_integrations'
  | 'superadmin_support'
  | 'superadmin_flags'
  | 'superadmin_sales_inquiries'
  | 'accept_invite'
  | 'landing'
  | 'signin'
  | 'register_company'
  | 'pricing'
  | 'contact_sales'
  | 'privacy_policy'
  | 'terms_conditions';

export interface ToastMessage {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  isPlatformOwner: boolean;
  tenantId: string | null;
  tenantName: string;
  role: string | null;
}

interface AppContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  currentUser: SessionUser | null;
  setCurrentUser: (user: SessionUser | null) => void;
  authLoading: boolean;
  loadLiveWorkspaceData: (session: {
    userId: string;
    email: string;
    fullName: string;
    isSuperAdmin: boolean;
    isPlatformOwner: boolean;
    tenantId: string | null;
    role: string | null;
  }) => Promise<void>;
  selectedAgreementId: string;
  setSelectedAgreementId: (id: string) => void;
  agreements: Agreement[];
  setAgreements: React.Dispatch<React.SetStateAction<Agreement[]>>;
  receipts: Receipt[];
  setReceipts: React.Dispatch<React.SetStateAction<Receipt[]>>;
  teamMembers: TeamMember[];
  setTeamMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  tenants: Tenant[];
  setTenants: React.Dispatch<React.SetStateAction<Tenant[]>>;
  templates: AgreementTemplate[];
  setTemplates: React.Dispatch<React.SetStateAction<AgreementTemplate[]>>;
  pricingPlans: PricingPlan[];
  setPricingPlans: React.Dispatch<React.SetStateAction<PricingPlan[]>>;
  preselectedPlan: { planId: string; billingCycle: 'monthly' | 'annual' } | null;
  setPreselectedPlan: React.Dispatch<React.SetStateAction<{ planId: string; billingCycle: 'monthly' | 'annual' } | null>>;
  branding: BrandingSettings;
  setBranding: React.Dispatch<React.SetStateAction<BrandingSettings>>;
  // Interactive signing modal state
  recipientModalOpen: boolean;
  setRecipientModalOpen: (open: boolean) => void;
  signingAgreement: Agreement | null;
  setSigningAgreement: (ag: Agreement | null) => void;
  signingToken: string | null;
  setSigningToken: (token: string | null) => void;
  // New Agreement Modal
  newAgreementModalOpen: boolean;
  setNewAgreementModalOpen: (open: boolean) => void;
  // Payment Acknowledge Modal
  acknowledgeModalOpen: boolean;
  setAcknowledgeModalOpen: (open: boolean) => void;
  // 3D effects enabled
  enable3D: boolean;
  setEnable3D: (val: boolean) => void;
  // Toasts
  toasts: ToastMessage[];
  addToast: (title: string, message: string, type?: ToastMessage['type']) => void;
  removeToast: (id: string) => void;
  // Helpers
  logout: () => Promise<void>;
  acknowledgePayment: (receiptId: string, ref: string, mode?: 'UPI' | 'Bank transfer' | 'Credit Card') => Promise<Receipt | null>;
  completeSigning: (agreementId: string, signatureData: string) => Promise<void>;
  createAgreement: (data: Partial<Agreement> & { initialStatus?: 'Draft' | 'Awaiting OTP' | 'Awaiting signature' }) => Promise<Agreement | null>;
  transitionAgreementStatus: (agreementId: string, status: Agreement['status'], reason?: string) => Promise<void>;
  deleteDraftAgreement: (agreementId: string) => Promise<void>;
}

const initialBranding: BrandingSettings = {
  logoText: 'GSIGN',
  logoUrl: '/gsign_logo.png',
  brandColor: '#5B13EC',
  emailDisplayName: 'GSIGN HR',
  customDomain: 'sign.gsign.in',
  dnsVerified: false,
  hidePoweredBy: false,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('gsign_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  });

  const [activeView, setActiveViewState] = useState<ActiveView>(() => {
    try {
      const path = window.location.pathname.toLowerCase();
      if (path === '/signin' || path === '/login') return 'signin';
      if (path === '/register') return 'register_company';
      if (path === '/pricing') return 'pricing';
      if (path === '/contact' || path === '/contact-sales') return 'contact_sales';
      if (path === '/privacy') return 'privacy_policy';
      if (path === '/terms') return 'terms_conditions';
    } catch {
      // ignore window access errors
    }
    const saved = sessionStorage.getItem('gsign_active_view') as ActiveView | null;
    if (
      saved &&
      ['landing', 'signin', 'register_company', 'pricing', 'contact_sales', 'privacy_policy', 'terms_conditions'].includes(saved)
    ) {
      return saved;
    }
    return 'landing';
  });
  const [currentRole, setCurrentRole] = useState<UserRole>('company_admin');
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [selectedAgreementId, setSelectedAgreementId] = useState<string>('');
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [templates, setTemplates] = useState<AgreementTemplate[]>([]);
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([]);
  const [preselectedPlan, setPreselectedPlan] = useState<{ planId: string; billingCycle: 'monthly' | 'annual' } | null>(null);

  const setActiveView = useCallback((view: ActiveView) => {
    sessionStorage.setItem('gsign_active_view', view);
    setActiveViewState(view);
  }, []);
  const [branding, setBranding] = useState<BrandingSettings>(initialBranding);
  const [recipientModalOpen, setRecipientModalOpen] = useState(false);
  const [signingAgreement, setSigningAgreement] = useState<Agreement | null>(null);
  const [signingToken, setSigningToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('token');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (signingToken) {
      setRecipientModalOpen(true);
    }
  }, [signingToken]);
  const [newAgreementModalOpen, setNewAgreementModalOpen] = useState(false);
  const [acknowledgeModalOpen, setAcknowledgeModalOpen] = useState(false);
  const [enable3D, setEnable3D] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    localStorage.setItem('gsign_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Apply custom brand color as CSS custom property
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-custom-color', branding.brandColor);
  }, [branding.brandColor]);

  const loadLiveWorkspaceData = useCallback(async (session: {
    userId: string;
    email: string;
    fullName: string;
    isSuperAdmin: boolean;
    isPlatformOwner: boolean;
    tenantId: string | null;
    role: string | null;
  }) => {
    setAgreements([]);
    setReceipts([]);
    setTeamMembers([]);
    setTenants([]);
    setTemplates([]);
    setSelectedAgreementId('');

    const isAdminRoot = Boolean(session.isPlatformOwner || session.isSuperAdmin || session.role === 'PLATFORM_OWNER');
    const tenantInfo = await api.getCurrentTenant().catch(() => null);
    const tenantName = isAdminRoot
      ? 'Genemax IT Solution'
      : tenantInfo?.name || 'Company Workspace';

    setCurrentUser({
      ...session,
      tenantName,
    });

    if (isAdminRoot) {
      setCurrentRole(session.isPlatformOwner || session.role === 'PLATFORM_OWNER' ? 'platform_owner' : 'super_admin');
      const [liveTenants, liveTemplates] = await Promise.all([
        api.getAllTenants().catch(() => []),
        api.getTemplates().catch(() => []),
      ]);
      if (Array.isArray(liveTemplates)) {
        setTemplates(liveTemplates);
      }
      setTenants(
        liveTenants.map((t: any) => ({
          id: t.id,
          company: t.name,
          plan: (t.plan_name?.replace(' Plan', '') || 'Starter') as Tenant['plan'],
          status: t.status === 'Active' ? 'Active' : 'Payment failed',
          docsThisMonth: 0,
          domain: t.slug || '—',
          adminEmail: t.contact_email || '—',
        }))
      );
      setTeamMembers([]);
      setReceipts([]);
      setAgreements([]);
    } else {
      setCurrentRole(session.role === 'Company Admin' ? 'company_admin' : 'company_staff');
      setTenants([]);
      const [liveUsers, liveInvoices, liveReceipts, liveAgreements, liveTemplates] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getInvoices().catch(() => []),
        api.getPaymentReceipts().catch(() => []),
        api.getAgreements().catch(() => []),
        api.getTemplates().catch(() => []),
      ]);
      if (Array.isArray(liveTemplates)) {
        setTemplates(liveTemplates);
      }
      if (Array.isArray(liveAgreements)) {
        setAgreements(liveAgreements);
        if (liveAgreements.length > 0) {
          setSelectedAgreementId(prev => prev || liveAgreements[0].id);
        }
      }
      setTeamMembers(
        liveUsers.map((u: any) => ({
          id: u.id,
          name: u.full_name,
          email: u.email,
          role: (u.role_name || 'Member') as TeamMember['role'],
          department: u.department || 'General',
          status: (u.membership_status === 'Active' && u.is_active ? 'Active' : 'Deactivated') as TeamMember['status'],
          joinedAt: u.joined_at ? new Date(u.joined_at).toLocaleDateString() : '—',
        }))
      );
      const invoiceReceipts: Receipt[] = liveInvoices.map((inv: any) => ({
        id: inv.invoice_number || inv.id,
        agreementId: inv.id,
        payer: tenantName,
        amount: Number(inv.total_amount || inv.amount || 0),
        amountInWords: `INR ${Number(inv.total_amount || inv.amount || 0).toLocaleString('en-IN')} only`,
        mode: 'Credit Card',
        status: inv.status === 'PAID' ? 'Issued' : 'Payment not confirmed',
        date: inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—',
        txRef: inv.invoice_number || inv.id,
        purpose: 'GSIGN Subscription',
        acknowledgedBy: 'Platform Billing',
      }));
      setReceipts([...(Array.isArray(liveReceipts) ? liveReceipts : []), ...invoiceReceipts]);
    }

    const livePlans = await api.getSubscriptionPlans().catch(() => []);
    if (Array.isArray(livePlans) && livePlans.length > 0) {
      setPricingPlans(
        livePlans.map((p: any) => ({
          id: p.id,
          name: p.name.replace(' Plan', '') as PricingPlan['name'],
          priceMonthly: Number(p.monthly_price) === 0 ? 'Custom' : Number(p.monthly_price),
          documentsLimit: p.max_agreements_per_month === -1 ? 'Unlimited' : Number(p.max_agreements_per_month),
          usersLimit: p.max_users === -1 ? 'Unlimited' : Number(p.max_users),
          overageRule: p.slug === 'enterprise' ? 'Custom SLA' : 'Standard overage',
        }))
      );
    }

    if (session?.tenantId) {
      const savedBranding = await api.getTenantBranding().catch(() => null);
      if (savedBranding && typeof savedBranding === 'object') {
        setBranding({
          ...initialBranding,
          ...savedBranding,
          logoUrl: savedBranding.logoUrl === undefined ? initialBranding.logoUrl : savedBranding.logoUrl,
        });
      } else {
        setBranding(initialBranding);
      }
    } else {
      setBranding(initialBranding);
    }
  }, []);

  const clearWorkspaceState = useCallback(() => {
    setCurrentUser(null);
    setAgreements([]);
    setReceipts([]);
    setTeamMembers([]);
    setTenants([]);
    setTemplates([]);
    setSelectedAgreementId('');
    setBranding(initialBranding);
  }, []);

  // Restore active session on page refresh (or open invitation acceptance if ?invite_token= is present)
  useEffect(() => {
    let mounted = true;
    const inviteToken = new URLSearchParams(window.location.search).get('invite_token');
    void restoreAppSession({
      inviteToken,
      getMe: () => api.getMe(),
      loadLiveWorkspaceData,
      clearWorkspaceState,
      getSavedActiveView: () => sessionStorage.getItem('gsign_active_view') as ActiveView | null,
      setActiveView,
      setAuthLoading,
      isMounted: () => mounted,
    });
    return () => {
      mounted = false;
    };
  }, [clearWorkspaceState, loadLiveWorkspaceData, setActiveView]);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      addToast('Theme Switched', `Switched to ${next} mode`, 'info');
      return next;
    });
  };

  const addToast = (title: string, message: string, type: ToastMessage['type'] = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const logout = useCallback(async () => {
    await performAppLogout({
      apiLogout: () => api.logout(),
      removeSavedActiveView: () => sessionStorage.removeItem('gsign_active_view'),
      clearWorkspaceState,
      resetUiState: (defaultBranding) => {
        setCurrentRole('company_admin');
        setSigningAgreement(null);
        setSigningToken(null);
        setRecipientModalOpen(false);
        setNewAgreementModalOpen(false);
        setAcknowledgeModalOpen(false);
        setBranding(defaultBranding);
      },
      initialBranding,
      setActiveView,
    });
  }, [clearWorkspaceState, setActiveView]);

  const acknowledgePayment = async (
    receiptId: string,
    ref: string,
    mode: 'UPI' | 'Bank transfer' | 'Credit Card' = 'UPI',
  ): Promise<Receipt | null> => {
    try {
      const updated: Receipt = await api.acknowledgePaymentReceipt(receiptId, {
        payment_mode: mode,
        tx_reference: ref,
      });
      setReceipts(prev => prev.map(r => (r.id === receiptId || r.uuid === receiptId ? updated : r)));
      addToast('Payment Acknowledged', `Official receipt ${updated.id} issued.`, 'success');
      return updated;
    } catch (err: any) {
      addToast('Acknowledgement Failed', err.message || 'Could not acknowledge payment.', 'error');
      return null;
    }
  };

  const completeSigning = async (agreementId: string, _signatureData: string) => {
    addToast(
      'Signing Verification Required',
      `Agreement ${agreementId} can only be marked Completed via the verified Signing Module.`,
      'info'
    );
  };

  const createAgreement = async (
    data: Partial<Agreement> & { initialStatus?: 'Draft' | 'Awaiting OTP' | 'Awaiting signature' }
  ): Promise<Agreement | null> => {
    try {
      const created = await api.createAgreement({
        recipient_name: data.recipientName || 'Signatory',
        recipient_email: data.recipientEmail || '',
        recipient_phone: data.recipientPhone || '',
        template_type: data.templateType || 'Offer Letter',
        department: data.department || 'HR',
        fee_amount: Number(data.feeAmount || 0),
        period: data.period || '12 months',
        content:
          data.content ||
          `Agreement for ${data.recipientName || 'Signatory'} (${data.period || '12 months'}).`,
        sign_method: data.signMethod || 'basic_drawn',
        initial_status: data.initialStatus,
      });
      setAgreements(prev => [created, ...prev]);
      setSelectedAgreementId(created.id);
      addToast(
        created.status === 'Draft' ? 'Draft Saved' : 'Agreement Sent',
        `${created.id} (${created.status}) saved to database.`,
        'success'
      );
      return created;
    } catch (err: any) {
      addToast('Agreement Error', err.message || 'Failed to create agreement.', 'error');
      return null;
    }
  };

  const transitionAgreementStatus = async (
    agreementId: string,
    status: Agreement['status'],
    reason?: string
  ) => {
    try {
      const updated = await api.transitionAgreement(agreementId, { status, reason });
      setAgreements(prev => prev.map(ag => (ag.id === agreementId ? updated : ag)));
      addToast('Status Updated', `${agreementId} transitioned to ${status}.`, 'success');
    } catch (err: any) {
      addToast('Transition Blocked', err.message || 'Invalid status transition.', 'error');
    }
  };

  const deleteDraftAgreement = async (agreementId: string) => {
    try {
      await api.deleteDraftAgreement(agreementId);
      setAgreements(prev => {
        const next = prev.filter(ag => ag.id !== agreementId);
        if (selectedAgreementId === agreementId) {
          setSelectedAgreementId(next[0]?.id || '');
        }
        return next;
      });
      addToast('Draft Deleted', `${agreementId} permanently removed.`, 'info');
    } catch (err: any) {
      addToast('Delete Failed', err.message || 'Could not delete draft.', 'error');
    }
  };

  return (
    <AppContext.Provider
      value={{
        theme,
        toggleTheme,
        activeView,
        setActiveView,
        currentRole,
        setCurrentRole,
        currentUser,
        setCurrentUser,
        authLoading,
        loadLiveWorkspaceData,
        selectedAgreementId,
        setSelectedAgreementId,
        agreements,
        setAgreements,
        receipts,
        setReceipts,
        teamMembers,
        setTeamMembers,
        tenants,
        setTenants,
        templates,
        setTemplates,
        pricingPlans,
        setPricingPlans,
        preselectedPlan,
        setPreselectedPlan,
        branding,
        setBranding,
        recipientModalOpen,
        setRecipientModalOpen,
        signingAgreement,
        setSigningAgreement,
        signingToken,
        setSigningToken,
        newAgreementModalOpen,
        setNewAgreementModalOpen,
        acknowledgeModalOpen,
        setAcknowledgeModalOpen,
        enable3D,
        setEnable3D,
        toasts,
        addToast,
        removeToast,
        logout,
        acknowledgePayment,
        completeSigning,
        createAgreement,
        transitionAgreementStatus,
        deleteDraftAgreement
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
