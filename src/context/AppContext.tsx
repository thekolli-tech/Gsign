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
  | 'signin'
  | 'register_company'
  | 'pricing'
  | 'contact_sales';

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
  acknowledgePayment: (receiptId: string, ref: string) => void;
  completeSigning: (agreementId: string, signatureData: string) => Promise<void>;
  createAgreement: (data: Partial<Agreement> & { initialStatus?: 'Draft' | 'Awaiting OTP' | 'Awaiting signature' }) => Promise<Agreement | null>;
  transitionAgreementStatus: (agreementId: string, status: Agreement['status'], reason?: string) => Promise<void>;
  deleteDraftAgreement: (agreementId: string) => Promise<void>;
}

const initialAgreements: Agreement[] = [
  {
    id: 'AGR-2026-0412',
    recipientName: 'Ravi Kumar',
    recipientEmail: 'ravi.kumar@example.com',
    recipientPhone: '+91 98765 44821',
    templateType: 'Offer Letter',
    department: 'HR',
    status: 'Completed',
    updatedAt: '10 min ago',
    createdAt: '24 Nov 2026 10:02',
    feeAmount: 45000,
    period: '12 months',
    content: 'This offer is made to Ravi Kumar for a monthly salary of ₹45,000 for 12 months. The recipient agrees to the terms and clauses set out in Schedule A. 1. The recipient agrees to intellectual property assignments and confidentiality agreements.',
    signMethod: 'basic_drawn',
    signatureDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60"><path d="M 10 40 Q 50 10, 80 35 T 140 25 T 190 30" stroke="%235B13EC" stroke-width="3" fill="none"/></svg>',
    documentHash: 'a91f3b72c4e908f0923058cd41209e7c',
    witnessRequired: true,
    witnessName: 'Sunil G (Director)',
    auditTrail: [
      { id: '1', title: 'Agreement created', description: 'Template v3 · by Priya, 24 Nov 10:02', timestamp: '24 Nov 10:02', type: 'created' },
      { id: '2', title: 'Invitation sent', description: 'Email delivered · 10:03', timestamp: '24 Nov 10:03', type: 'sent' },
      { id: '3', title: 'Link opened', description: 'Mobile Chrome · 10:20', timestamp: '24 Nov 10:20', type: 'viewed', ip: '152.58.12.94', device: 'Chrome Mobile 128 / Android 14' },
      { id: '4', title: 'OTP verified', description: 'SMS delivered, verified · 10:21', timestamp: '24 Nov 10:21', type: 'otp' },
      { id: '5', title: 'Consent recorded', description: 'Explicit consent · 10:24', timestamp: '24 Nov 10:24', type: 'consent' },
      { id: '6', title: 'Signed (basic electronic)', description: 'Document hash a91f…c7 · 10:25', timestamp: '24 Nov 10:25', type: 'signed', hash: 'a91f3b72c4e908f0923058cd41209e7c' },
      { id: '7', title: 'PDF generated', description: 'Emailed to recipient and HR · 10:26', timestamp: '24 Nov 10:26', type: 'pdf' },
    ]
  },
  {
    id: 'AGR-2026-0411',
    recipientName: 'Meera Iyer',
    recipientEmail: 'meera.iyer@fintech.io',
    recipientPhone: '+91 99881 24821',
    templateType: 'NDA',
    department: 'Legal',
    status: 'Awaiting OTP',
    updatedAt: '1 hr ago',
    createdAt: '24 Nov 2026 09:15',
    feeAmount: 30000,
    period: '24 months',
    content: 'This Non-Disclosure Agreement is made to Meera Iyer for a monthly advisory fee of ₹30,000 for the period of 24 months. The recipient agrees to maintain strict confidentiality of proprietary algorithms and data repositories.',
    signMethod: 'otp_verified',
    documentHash: 'c74f8810e4231b578fa98e6a32d184bf',
    auditTrail: [
      { id: '1', title: 'Agreement created', description: 'Template v2 · by Priya, 24 Nov 09:15', timestamp: '24 Nov 09:15', type: 'created' },
      { id: '2', title: 'Invitation sent', description: 'Email delivered · 09:16', timestamp: '24 Nov 09:16', type: 'sent' },
      { id: '3', title: 'Link opened', description: 'Safari Mobile / iOS 18 · 09:40', timestamp: '24 Nov 09:40', type: 'viewed' },
      { id: '4', title: 'OTP sent', description: 'SMS dispatched to +91 99881 24821', timestamp: '24 Nov 09:42', type: 'otp' },
    ]
  },
  {
    id: 'AGR-2026-0410',
    recipientName: 'Sunrise Traders',
    recipientEmail: 'procure@sunrisetraders.in',
    recipientPhone: '+91 94451 98200',
    templateType: 'Vendor Agreement',
    department: 'Ops',
    status: 'Awaiting signature',
    updatedAt: 'Yesterday',
    createdAt: '23 Nov 2026 14:30',
    feeAmount: 120000,
    period: '12 months',
    content: 'Master Vendor & Supply Agreement between GSIGN Pvt Ltd and Sunrise Traders for supply chain provisioning valued at ₹1,20,000 per month.',
    signMethod: 'basic_drawn',
    documentHash: 'e3b0c44298fc1c149afbf4c8996fb924',
    auditTrail: [
      { id: '1', title: 'Agreement created', description: 'Template v4 · by Vikram, 23 Nov 14:30', timestamp: '23 Nov 14:30', type: 'created' },
      { id: '2', title: 'Invitation sent', description: 'Email delivered · 14:35', timestamp: '23 Nov 14:35', type: 'sent' },
      { id: '3', title: 'OTP verified', description: 'SMS verified · 15:10', timestamp: '23 Nov 15:10', type: 'otp' },
    ]
  },
  {
    id: 'AGR-2026-0409',
    recipientName: 'Anil Rao',
    recipientEmail: 'anil.rao@franchise.in',
    recipientPhone: '+91 98840 11928',
    templateType: 'Franchise Agreement',
    department: 'Sales',
    status: 'Expired',
    updatedAt: '2 days ago',
    createdAt: '21 Nov 2026 11:00',
    feeAmount: 250000,
    period: '36 months',
    content: 'Franchise Partner Agreement for regional territory distribution in South India.',
    signMethod: 'basic_drawn',
    documentHash: '98a3fbc910245aedc45781203498bced',
    auditTrail: [
      { id: '1', title: 'Agreement created', description: 'Template v1 · by Karan, 21 Nov 11:00', timestamp: '21 Nov 11:00', type: 'created' },
      { id: '2', title: 'Invitation sent', description: 'Email delivered · 11:05', timestamp: '21 Nov 11:05', type: 'sent' },
      { id: '3', title: 'Link Expired', description: 'Signature window closed after 48h limit', timestamp: '23 Nov 11:05', type: 'consent' },
    ]
  },
  {
    id: 'AGR-2026-0408',
    recipientName: 'Pooja Shah',
    recipientEmail: 'pooja.shah@mail.com',
    recipientPhone: '+91 97720 33411',
    templateType: 'Offer Letter',
    department: 'HR',
    status: 'Rejected',
    updatedAt: '3 days ago',
    createdAt: '20 Nov 2026 16:10',
    feeAmount: 65000,
    period: 'Permanent',
    content: 'Employment offer for Senior Product Designer position at GSIGN Pvt Ltd.',
    signMethod: 'basic_drawn',
    documentHash: 'fa823bc0192e478acb6812498701235b',
    auditTrail: [
      { id: '1', title: 'Agreement created', description: 'Template v3 · by Priya, 20 Nov 16:10', timestamp: '20 Nov 16:10', type: 'created' },
      { id: '2', title: 'Invitation sent', description: 'Email delivered · 16:15', timestamp: '20 Nov 16:15', type: 'sent' },
      { id: '3', title: 'Offer declined', description: 'Candidate requested salary renegotiation', timestamp: '21 Nov 09:30', type: 'consent' },
    ]
  },
  {
    id: 'AGR-2026-0407',
    recipientName: 'Dev Patel',
    recipientEmail: 'dev.patel@cloudtech.com',
    recipientPhone: '+91 93310 99402',
    templateType: 'Service Contract',
    department: 'Ops',
    status: 'Cancelled',
    updatedAt: '4 days ago',
    createdAt: '19 Nov 2026 12:00',
    feeAmount: 85000,
    period: '6 months',
    content: 'Infrastructure monitoring & SLA response agreement with CloudTech.',
    signMethod: 'basic_drawn',
    documentHash: '3187adcb0912faef8902c4819702341b',
    auditTrail: [
      { id: '1', title: 'Agreement created', description: 'Template v2 · by Vikram, 19 Nov 12:00', timestamp: '19 Nov 12:00', type: 'created' },
      { id: '2', title: 'Agreement voided', description: 'Cancelled by administrator due to scope revision', timestamp: '19 Nov 15:00', type: 'consent' },
    ]
  }
];

const initialReceipts: Receipt[] = [
  {
    id: 'RCT-0091',
    payer: 'Ravi Kumar',
    amount: 45000,
    amountInWords: 'Forty-five thousand rupees only',
    mode: 'UPI',
    status: 'Issued',
    date: '24 Nov 2026',
    txRef: 'UPI-982340192841',
    purpose: 'First month fee',
    acknowledgedBy: 'Priya (Admin)',
    agreementId: 'AGR-2026-0412'
  },
  {
    id: 'RCT-0090',
    payer: 'Sunrise Traders',
    amount: 120000,
    amountInWords: 'One lakh twenty thousand rupees only',
    mode: 'Bank transfer',
    status: 'Issued',
    date: '22 Nov 2026',
    txRef: 'NEFT-AXIS-992018',
    purpose: 'Quarterly provisioning advance',
    acknowledgedBy: 'Priya (Admin)',
    agreementId: 'AGR-2026-0410'
  },
  {
    id: 'RCT-PENDING',
    payer: 'Meera Iyer',
    amount: 30000,
    amountInWords: 'Thirty thousand rupees only',
    mode: '—',
    status: 'Payment not confirmed',
    date: '24 Nov 2026',
    txRef: '—',
    purpose: 'Advisory retainer',
    acknowledgedBy: '—',
    agreementId: 'AGR-2026-0411'
  }
];

const initialTeam: TeamMember[] = [
  { id: '1', name: 'Priya N', email: 'priya@gsign.in', role: 'Company Admin', department: 'HR', status: 'Active · MFA on' },
  { id: '2', name: 'Karan S', email: 'karan@gsign.in', role: 'Company Staff', department: 'Sales', status: 'Active' },
  { id: '3', name: 'Asha M', email: 'asha@gsign.in', role: 'Company Staff', department: 'Legal', status: 'Invited' },
  { id: '4', name: 'Vikram R', email: 'vikram@gsign.in', role: 'Company Staff', department: 'Ops', status: 'Deactivated' },
];

const initialTenants: Tenant[] = [
  { id: 'ten-1', company: 'GSIGN', plan: 'Business', status: 'Active', docsThisMonth: 62, domain: 'sign.gsign.in', adminEmail: 'admin@gsign.in' },
  { id: 'ten-2', company: 'Sunrise Traders', plan: 'Starter', status: 'Trial', docsThisMonth: 9, domain: '—', adminEmail: 'ops@sunrisetraders.in' },
  { id: 'ten-3', company: 'Bright Academy', plan: 'Professional', status: 'Active', docsThisMonth: 214, domain: '—', adminEmail: 'info@brightacademy.edu' },
  { id: 'ten-4', company: 'Zenith BPO', plan: 'Enterprise', status: 'Payment failed', docsThisMonth: 480, domain: 'esign.zenithbpo.in', adminEmail: 'legal@zenithbpo.in' },
];

const initialPlans: PricingPlan[] = [
  { id: 'plan-1', name: 'Starter', priceMonthly: '₹499', documentsLimit: 25, usersLimit: 2, overageRule: '₹ per extra doc' },
  { id: 'plan-2', name: 'Business', priceMonthly: '₹1,499', documentsLimit: 100, usersLimit: 5, overageRule: '₹ per extra doc', popular: true },
  { id: 'plan-3', name: 'Professional', priceMonthly: '₹2,999', documentsLimit: 300, usersLimit: 15, overageRule: '₹ per extra doc' },
  { id: 'plan-4', name: 'Enterprise', priceMonthly: 'Custom', documentsLimit: 'Custom', usersLimit: 'Custom', overageRule: '₹ per extra doc' },
];

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
    const saved = sessionStorage.getItem('gsign_active_view') as ActiveView | null;
    if (saved && ['signin', 'register_company', 'pricing', 'contact_sales'].includes(saved)) {
      return saved;
    }
    return 'signin';
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
  const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([
    {
      id: 'starter',
      name: 'Starter',
      priceMonthly: 499,
      documentsLimit: 25,
      usersLimit: 2,
      overageRule: '₹15 per extra document',
    },
    {
      id: 'business',
      name: 'Business',
      priceMonthly: 1499,
      documentsLimit: 100,
      usersLimit: 5,
      overageRule: '₹10 per extra document',
    },
    {
      id: 'professional',
      name: 'Professional',
      priceMonthly: 2999,
      documentsLimit: 300,
      usersLimit: 15,
      overageRule: '₹5 per extra document',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      priceMonthly: 'Custom',
      documentsLimit: 'Unlimited',
      usersLimit: 'Unlimited',
      overageRule: 'Custom SLA',
    }
  ]);

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
      const liveTenants = await api.getAllTenants().catch(() => []);
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
      const [liveUsers, liveInvoices, liveAgreements, liveTemplates] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getInvoices().catch(() => []),
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
          status: u.is_active ? 'Active' : 'Deactivated',
          joinedAt: u.joined_at ? new Date(u.joined_at).toLocaleDateString() : '—',
        }))
      );
      setReceipts(
        liveInvoices.map((inv: any) => ({
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
        }))
      );
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

  // Restore active session on page refresh
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const session = await api.getMe();
        if (!mounted) return;
        if (session && session.userId) {
          await loadLiveWorkspaceData(session);
          const isAdminRoot = Boolean(session.isPlatformOwner || session.isSuperAdmin || session.role === 'PLATFORM_OWNER');
          const saved = sessionStorage.getItem('gsign_active_view') as ActiveView | null;
          const publicViews: ActiveView[] = ['signin', 'register_company', 'pricing', 'contact_sales'];
          if (saved && !publicViews.includes(saved)) {
            if (!isAdminRoot && saved.startsWith('superadmin_')) {
              setActiveView('dashboard');
            } else {
              setActiveView(saved);
            }
          } else {
            setActiveView(
              isAdminRoot
                ? 'superadmin_tenants'
                : session.role === 'Company Admin'
                  ? 'dashboard'
                  : 'agreements'
            );
          }
        }
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadLiveWorkspaceData, setActiveView]);

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

  const acknowledgePayment = (receiptId: string, ref: string) => {
    setReceipts(prev => prev.map(r => {
      if (r.id === receiptId || (r.id === 'RCT-PENDING' && receiptId === 'RCT-PENDING')) {
        const nextId = 'RCT-0092';
        return {
          ...r,
          id: nextId,
          mode: 'UPI',
          status: 'Issued',
          txRef: ref || `UPI-TXN-${Date.now().toString().slice(-6)}`,
          acknowledgedBy: 'Priya (Admin)',
          date: '25 Nov 2026'
        };
      }
      return r;
    }));
    addToast('Payment Acknowledged', `Official receipt generated with authorized sign-off.`, 'success');
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
