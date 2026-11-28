export interface ProviderSendInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface ProviderSendOutput {
  delivered: boolean;
  status: 'sent' | 'disabled' | 'failed';
  retryable: boolean;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface EmailProviderAdapter {
  readonly providerName: string;
  isConfigured(): boolean;
  send(input: ProviderSendInput): Promise<ProviderSendOutput>;
}

export class ResendEmailProvider implements EmailProviderAdapter {
  readonly providerName = 'resend';

  private getApiKey(): string | undefined {
    const key = process.env.RESEND_API_KEY?.trim();
    return key || undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  async send(input: ProviderSendInput): Promise<ProviderSendOutput> {
    const apiKey = this.getApiKey();
    const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

    if (!apiKey) {
      if (isProd) {
        return {
          delivered: false,
          status: 'failed',
          retryable: false,
          errorCode: 'MISSING_PROVIDER_CONFIG',
          errorMessage: 'Email provider is not configured in production.',
        };
      }
      return {
        delivered: false,
        status: 'disabled',
        retryable: false,
        errorCode: 'PROVIDER_DISABLED_NON_PROD',
        errorMessage: 'Email delivery skipped because RESEND_API_KEY is not configured.',
      };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(10_000)
          : undefined,
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        return {
          delivered: false,
          status: 'failed',
          retryable,
          errorCode: `RESEND_HTTP_${response.status}`,
          errorMessage: `Email provider returned HTTP ${response.status}.`,
        };
      }

      const data = await response.json().catch(() => ({} as any));
      return {
        delivered: true,
        status: 'sent',
        retryable: false,
        messageId: typeof data?.id === 'string' ? data.id : undefined,
      };
    } catch (err: any) {
      return {
        delivered: false,
        status: 'failed',
        retryable: true,
        errorCode: 'RESEND_NETWORK_ERROR',
        errorMessage: err?.message ? String(err.message).slice(0, 200) : 'Network error calling email provider.',
      };
    }
  }
}
