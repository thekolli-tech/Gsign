import * as crypto from 'crypto';

export interface CheckoutSessionInitResult {
  provider: 'RAZORPAY' | 'STRIPE' | 'MANUAL' | 'SIMULATED';
  providerTransactionId: string;
  checkoutUrl: string | null;
  mode: 'gateway' | 'simulated_dev' | 'manual_pending';
  isSimulated: boolean;
}

export interface PaymentProviderAdapter {
  readonly providerName: CheckoutSessionInitResult['provider'];
  readonly isSimulated: boolean;
  createCheckoutSession(input: {
    checkoutReference: string;
    amountInr: number;
    currency: 'INR';
    tenantId: string;
    planName: string;
    billingCycle: 'monthly' | 'annual';
  }): Promise<CheckoutSessionInitResult>;
  verifyWebhookSignature(rawPayload: string, signature?: string): boolean;
}

export class SimulatedDevPaymentAdapter implements PaymentProviderAdapter {
  readonly providerName = 'SIMULATED' as const;
  readonly isSimulated = true;

  async createCheckoutSession(input: {
    checkoutReference: string;
  }): Promise<CheckoutSessionInitResult> {
    return {
      provider: 'SIMULATED',
      providerTransactionId: `sim_init_${crypto.createHash('sha256').update(input.checkoutReference).digest('hex').slice(0, 16)}`,
      checkoutUrl: null,
      mode: 'simulated_dev',
      isSimulated: true,
    };
  }

  verifyWebhookSignature(rawPayload: string, signature?: string): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

export class ManualPendingPaymentAdapter implements PaymentProviderAdapter {
  readonly providerName = 'MANUAL' as const;
  readonly isSimulated = false;

  async createCheckoutSession(input: {
    checkoutReference: string;
  }): Promise<CheckoutSessionInitResult> {
    return {
      provider: 'MANUAL',
      providerTransactionId: `man_init_${input.checkoutReference}`,
      checkoutUrl: null,
      mode: 'manual_pending',
      isSimulated: false,
    };
  }

  verifyWebhookSignature(rawPayload: string, signature?: string): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

export function resolvePaymentProviderAdapter(): PaymentProviderAdapter {
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  if (isProd) {
    return new ManualPendingPaymentAdapter();
  }
  return new SimulatedDevPaymentAdapter();
}
