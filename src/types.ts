export type ThemeMode = 'light' | 'dark';

export type UserRole = 'platform_owner' | 'super_admin' | 'company_admin' | 'company_staff' | 'signatory';

export type AgreementStatus = 
  | 'Completed' 
  | 'Awaiting OTP' 
  | 'Awaiting signature' 
  | 'Expired' 
  | 'Rejected' 
  | 'Draft' 
  | 'Cancelled';

export type Department = 'HR' | 'Legal' | 'Ops' | 'Sales' | 'Executive';

export type TemplateType = 
  | 'Offer Letter' 
  | 'NDA' 
  | 'Vendor Agreement' 
  | 'Franchise Agreement' 
  | 'Service Contract'
  | 'Consulting Agreement';

export interface AuditEvent {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  type: 'created' | 'sent' | 'viewed' | 'otp' | 'consent' | 'signed' | 'pdf' | 'payment';
  ip?: string;
  device?: string;
  hash?: string;
}

export interface Agreement {
  id: string; // e.g. "AGR-2026-0412"
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  templateType: TemplateType;
  department: Department;
  status: AgreementStatus;
  updatedAt: string;
  createdAt: string;
  feeAmount: number;
  period: string;
  content: string;
  signMethod: 'basic_drawn' | 'otp_verified' | 'aadhaar_esign' | 'dsc';
  signatureDataUrl?: string;
  documentHash: string;
  auditTrail: AuditEvent[];
  witnessRequired?: boolean;
  witnessName?: string;
}

export interface Receipt {
  id: string; // e.g. "RCT-0091"
  payer: string;
  amount: number;
  amountInWords: string;
  mode: 'UPI' | 'Bank transfer' | 'Credit Card' | '—';
  status: 'Issued' | 'Payment not confirmed';
  date: string;
  txRef: string;
  purpose: string;
  acknowledgedBy: string;
  agreementId?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Company Admin' | 'Company Staff';
  department: Department;
  status: 'Active · MFA on' | 'Active' | 'Invited' | 'Deactivated';
  avatar?: string;
}

export interface Tenant {
  id: string;
  company: string;
  plan: 'Starter' | 'Business' | 'Professional' | 'Enterprise';
  status: 'Active' | 'Trial' | 'Payment failed';
  docsThisMonth: number;
  domain: string;
  adminEmail: string;
}

export interface PricingPlan {
  id: string;
  name: 'Starter' | 'Business' | 'Professional' | 'Enterprise';
  priceMonthly: number | string;
  documentsLimit: number | string;
  usersLimit: number | string;
  overageRule: string;
  popular?: boolean;
}

export interface TemplateField {
  id: string;
  type: 'Text' | 'Date' | 'Dropdown' | 'Checkbox' | 'File upload' | 'Signature' | 'Initials' | 'Witness' | 'Payment details';
  label: string;
  placeholder?: string;
  required: boolean;
  signingMethod?: 'Basic electronic (drawn)' | 'OTP verified' | 'Aadhaar eSign' | 'DSC';
  value?: string;
}

export interface TemplateVersionSummary {
  id: string;
  versionNumber: number;
  status: 'Draft' | 'Published' | 'Archived';
  publishedAt?: string;
  createdAt: string;
}

export interface AgreementTemplate {
  id: string;
  name: string;
  category: string;
  department: Department | string;
  description: string;
  status: 'Draft' | 'Published' | 'Archived';
  currentVersion: number;
  publishedVersion?: number | null;
  content: string;
  fields: TemplateField[];
  versionStatus: 'Draft' | 'Published' | 'Archived';
  versions: TemplateVersionSummary[];
}

export interface BrandingSettings {
  logoText: string;
  logoUrl?: string;
  brandColor: string;
  emailDisplayName: string;
  customDomain: string;
  dnsVerified: boolean;
  hidePoweredBy?: boolean;
}
