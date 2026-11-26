/**
 * GSIGN Enterprise API Client
 * Connects frontend views directly to the NestJS /api/v1 backend
 */

const API_BASE = '/api/v1';

async function parseJsonSafe(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: `Server returned non-JSON response (HTTP ${res.status})` };
  }
}

export interface LoginResponse {
  mfa_required: boolean;
  mfa_token?: string;
  session?: {
    sessionId: string;
    userId: string;
    email: string;
    fullName: string;
    isSuperAdmin: boolean;
    isPlatformOwner: boolean;
    mustChangePassword?: boolean;
    tenantId: string | null;
    role: string | null;
    permissions: string[];
    expiresAt: string;
  };
}

export const api = {
  // 1. Authentication
  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Login failed. Please check your credentials.');
    }
    return data;
  },

  async verifyMfa(mfa_token: string, code: string): Promise<LoginResponse['session']> {
    const res = await fetch(`${API_BASE}/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mfa_token, code }),
    });

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'MFA verification failed. Please try again.');
    }
    return data.session;
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  async getMe() {
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return res.json();
  },

  // 2. Company Registration
  async registerCompany(payload: {
    company_name: string;
    display_name: string;
    business_email: string;
    business_phone: string;
    country: string;
    state: string;
    city: string;
    address: string;
    website?: string;
    admin_full_name: string;
    admin_email: string;
    password: string;
    terms_accepted: boolean;
    selected_plan_id?: string;
    billing_cycle?: string;
  }) {
    const res = await fetch(`${API_BASE}/auth/register-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Company registration failed. Please review your details.');
    }
    return data;
  },

  async verifyEmail(token: string) {
    const res = await fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(token)}`);
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Email verification failed.');
    }
    return data;
  },

  async completeCompanySetup(payload: {
    registration_id: string;
    plan_id: string;
    billing_cycle: 'monthly' | 'annual';
  }) {
    const res = await fetch(`${API_BASE}/auth/complete-company-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Company setup failed.');
    }
    return data;
  },

  // 3. Subscriptions & Payments
  async getSubscriptionPlans() {
    const res = await fetch(`${API_BASE}/subscriptions/plans`);
    if (!res.ok) {
      throw new Error('Failed to load subscription plans.');
    }
    return res.json();
  },

  async simulateCheckout(payload: {
    tenant_id: string;
    plan_id: string;
    billing_cycle: 'monthly' | 'annual';
    payment_method?: string;
  }) {
    const res = await fetch(`${API_BASE}/payments/simulate-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Payment simulation failed.');
    }
    return data;
  },

  // 4. Forgot Password (Email OTP)
  async requestPasswordResetOtp(email: string) {
    const res = await fetch(`${API_BASE}/auth/forgot-password/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Failed to send verification OTP.');
    }
    return data;
  },

  async verifyPasswordResetOtp(email: string, otp: string) {
    const res = await fetch(`${API_BASE}/auth/forgot-password/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Invalid or expired OTP.');
    }
    return data;
  },

  async resetPasswordWithOtp(reset_token: string, new_password: string) {
    const res = await fetch(`${API_BASE}/auth/forgot-password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset_token, new_password }),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Failed to update password.');
    }
    return data;
  },

  // 5. Live Workspace & Platform Data
  async getCurrentTenant() {
    const res = await fetch(`${API_BASE}/tenants/current`, { credentials: 'include' });
    if (!res.ok) return null;
    return parseJsonSafe(res);
  },

  async getAllTenants() {
    const res = await fetch(`${API_BASE}/tenants`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await parseJsonSafe(res);
    return Array.isArray(data) ? data : [];
  },

  async getUsers() {
    const res = await fetch(`${API_BASE}/users`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await parseJsonSafe(res);
    return Array.isArray(data) ? data : [];
  },

  async getCurrentSubscription() {
    const res = await fetch(`${API_BASE}/subscriptions/current`, { credentials: 'include' });
    if (!res.ok) return null;
    return parseJsonSafe(res);
  },

  async getInvoices() {
    const res = await fetch(`${API_BASE}/payments/invoices`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await parseJsonSafe(res);
    return Array.isArray(data) ? data : [];
  },

  // 6. Agreements Engine
  async getAgreements(params?: { status?: string; department?: string }) {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'All') qs.set('status', params.status);
    if (params?.department && params.department !== 'All') qs.set('department', params.department);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`${API_BASE}/agreements${query}`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await parseJsonSafe(res);
    return Array.isArray(data) ? data : [];
  },

  async createAgreement(payload: {
    recipient_name: string;
    recipient_email: string;
    recipient_phone?: string;
    template_type: string;
    department: string;
    fee_amount?: number;
    period?: string;
    content: string;
    sign_method?: string;
    initial_status?: 'Draft' | 'Awaiting OTP' | 'Awaiting signature';
  }) {
    const res = await fetch(`${API_BASE}/agreements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Failed to create agreement.');
    }
    return data;
  },

  async transitionAgreement(
    id: string,
    payload: { status: string; reason?: string; signature_data_url?: string }
  ) {
    const res = await fetch(`${API_BASE}/agreements/${encodeURIComponent(id)}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Failed to update agreement status.');
    }
    return data;
  },

  async deleteDraftAgreement(id: string) {
    const res = await fetch(`${API_BASE}/agreements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(data.message || 'Failed to delete draft agreement.');
    }
    return data;
  },

  // 7. Templates Management Engine
  async getTemplates(includeArchived = false) {
    const qs = includeArchived ? '?include_archived=true' : '';
    const res = await fetch(`${API_BASE}/templates${qs}`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await parseJsonSafe(res);
    return Array.isArray(data) ? data : [];
  },

  async createTemplate(payload: {
    name: string;
    category?: string;
    department?: string;
    description?: string;
    content: string;
    fields?: any[];
  }) {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to create template.');
    return data;
  },

  async updateTemplate(
    id: string,
    payload: {
      name?: string;
      category?: string;
      department?: string;
      description?: string;
      content?: string;
      fields?: any[];
    }
  ) {
    const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to save template.');
    return data;
  },

  async publishTemplate(id: string) {
    const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to publish template.');
    return data;
  },

  async duplicateTemplate(id: string) {
    const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to duplicate template.');
    return data;
  },

  async archiveTemplate(id: string) {
    const res = await fetch(`${API_BASE}/templates/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.message || 'Failed to archive template.');
    return data;
  },
};
