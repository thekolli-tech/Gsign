export interface PublicSubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string;
  monthly_price: number;
  annual_price: number;
  max_agreements_per_month: number;
  max_users: number;
  features: string[];
  is_active: boolean;
  updated_at?: string;
}

export type PricingViewState = 'loading' | 'error' | 'empty' | 'ready';

export function parsePlanFeatures(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
      }
    } catch {
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function normalizeSubscriptionPlan(raw: any): PublicSubscriptionPlan {
  const monthly = Number(raw?.monthly_price ?? 0);
  const annual = Number(raw?.annual_price ?? 0);
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? '').trim() || 'Unnamed Plan',
    slug: String(raw?.slug ?? '').trim().toLowerCase(),
    description: String(raw?.description ?? '').trim(),
    monthly_price: Number.isFinite(monthly) ? monthly : 0,
    annual_price: Number.isFinite(annual) ? annual : 0,
    max_agreements_per_month: Number(raw?.max_agreements_per_month ?? 0),
    max_users: Number(raw?.max_users ?? 0),
    features: parsePlanFeatures(raw?.features),
    is_active: raw?.is_active !== false,
    updated_at: raw?.updated_at ? String(raw.updated_at) : undefined,
  };
}

export function isCustomEnterprisePlan(plan: Pick<PublicSubscriptionPlan, 'slug' | 'monthly_price' | 'annual_price'>): boolean {
  return (
    plan.slug === 'enterprise' ||
    (plan.monthly_price <= 0 && plan.annual_price <= 0)
  );
}

export function isPlanPurchasable(plan: Pick<PublicSubscriptionPlan, 'slug' | 'monthly_price' | 'annual_price' | 'is_active'>): boolean {
  return plan.is_active !== false && !isCustomEnterprisePlan(plan);
}

export function getDisplayPlanPrice(
  plan: Pick<PublicSubscriptionPlan, 'monthly_price' | 'annual_price'>,
  billingCycle: 'monthly' | 'annual',
): number {
  return billingCycle === 'annual' ? plan.annual_price : plan.monthly_price;
}

export function getPricingViewState(params: {
  loading: boolean;
  error: string | null;
  plans: PublicSubscriptionPlan[];
}): PricingViewState {
  if (params.loading) return 'loading';
  if (params.error) return 'error';
  if (!Array.isArray(params.plans) || params.plans.length === 0) return 'empty';
  return 'ready';
}
