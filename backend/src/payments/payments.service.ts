import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../notifications/email.service';
import { SimulateCheckoutDto } from './dto/simulate-checkout.dto';
import { AcknowledgeReceiptDto, CreateReceiptDto } from './dto/receipt.dto';
import {
  CheckoutStatusDto,
  InitiateCheckoutDto,
  PaymentState,
  PaymentWebhookConfirmDto,
  TransitionCheckoutDto,
} from './dto/checkout.dto';
import { resolvePaymentProviderAdapter } from './payment-provider.adapter';
import { verifyCheckoutAccessToken } from './checkout-token.util';
import * as crypto from 'crypto';

export const PAYMENT_STATE_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  PAYMENT_PENDING: ['PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_COMPLETED'],
  PAYMENT_PROCESSING: ['PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_COMPLETED'],
  PAYMENT_FAILED: ['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_CANCELLED'],
  PAYMENT_CANCELLED: ['PAYMENT_PENDING'],
  PAYMENT_COMPLETED: [],
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  /**
   * Simulates checkout and payment verification for a company subscription
   * Disabled in production; restricted to Platform Owner in non-production.
   */
  async simulateCheckout(dto: SimulateCheckoutDto) {
    if (process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)) {
      throw new ForbiddenException(
        'Simulated checkout is disabled in production. Use manual Platform Owner activation or a verified payment gateway.',
      );
    }
    // 1. Verify tenant exists
    const tenantRes = await this.db.query('SELECT id, name FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (tenantRes.rows.length === 0) {
      throw new NotFoundException(`Tenant with ID ${dto.tenant_id} not found.`);
    }

    // 2. Verify plan
    const planRes = await this.db.query('SELECT id, name, monthly_price, annual_price FROM subscription_plans WHERE id = $1', [dto.plan_id]);
    if (planRes.rows.length === 0) {
      throw new NotFoundException(`Subscription plan ${dto.plan_id} not found.`);
    }
    const plan = planRes.rows[0];

    const amount = dto.billing_cycle === 'annual' ? plan.annual_price : plan.monthly_price;
    const durationMonths = dto.billing_cycle === 'annual' ? 12 : 1;
    const providerTxId = `sim_tx_${crypto.randomBytes(12).toString('hex')}`;
    const invoiceNum = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.is_super_admin = 'true';");

      // 3. Upsert / Activate subscription
      const subRes = await client.query(
        `INSERT INTO tenant_subscriptions (
           tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end
         ) VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW() + ($4 || ' months')::interval)
         ON CONFLICT (tenant_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           billing_cycle = EXCLUDED.billing_cycle,
           status = 'ACTIVE',
           current_period_start = NOW(),
           current_period_end = NOW() + ($4 || ' months')::interval,
           updated_at = NOW()
         RETURNING id;`,
        [dto.tenant_id, dto.plan_id, dto.billing_cycle, durationMonths.toString()]
      );
      const subscriptionId = subRes.rows[0].id;

      // 4. Record verified payment transaction
      const payRes = await client.query(
        `INSERT INTO payments (
           tenant_id, subscription_id, amount, currency, provider, provider_transaction_id, status, payment_method, verified_at, metadata
         ) VALUES ($1, $2, $3, 'INR', 'SIMULATED', $4, 'COMPLETED', $5, NOW(), $6)
         RETURNING id;`,
        [
          dto.tenant_id,
          subscriptionId,
          amount,
          providerTxId,
          dto.payment_method || 'Net Banking / UPI',
          JSON.stringify({ plan_name: plan.name, billing_cycle: dto.billing_cycle }),
        ]
      );
      const paymentId = payRes.rows[0].id;

      // 5. Generate Invoice
      const taxAmount = Number(amount) * 0.18; // 18% GST standard in India
      const totalAmount = Number(amount) + taxAmount;
      await client.query(
        `INSERT INTO invoices (
           tenant_id, payment_id, invoice_number, amount, tax_amount, total_amount, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'PAID');`,
        [dto.tenant_id, paymentId, invoiceNum, amount, taxAmount, totalAmount]
      );

      // 6. Set Tenant status to Active
      await client.query(`UPDATE tenants SET status = 'Active', updated_at = NOW() WHERE id = $1`, [dto.tenant_id]);

      // 7. Update company_registrations if any
      await client.query(
        `UPDATE company_registrations SET status = 'COMPLETED', updated_at = NOW() WHERE tenant_id = $1`,
        [dto.tenant_id]
      );

      // 8. Log audit trail
      await client.query(
        `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata)
         VALUES ($1, 'SYSTEM', 'PAYMENT_VERIFIED_ACTIVATION', 'SUBSCRIPTION', $2, $3, 'Automated payment gateway verification and activation', $4);`,
        ['payment-gateway@gsign.in', subscriptionId, dto.tenant_id, JSON.stringify({ amount, providerTxId, invoiceNum })]
      );

      await client.query('COMMIT');

      return {
        success: true,
        message: 'Payment verified successfully. Paid company workspace is now active.',
        tenant_id: dto.tenant_id,
        payment_id: paymentId,
        transaction_id: providerTxId,
        invoice_number: invoiceNum,
        subscription_status: 'ACTIVE',
        plan_name: plan.name,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get all invoices for a tenant
   */
  async getInvoices(tenantId: string) {
    if (!tenantId) {
      return [];
    }

    const res = await this.db.executeWithTenantContext(tenantId, async (client) => {
      return client.query(
        `SELECT id, invoice_number, amount, tax_amount, total_amount, status, created_at
         FROM invoices
         WHERE tenant_id = $1
         ORDER BY created_at DESC;`,
        [tenantId]
      );
    });

    return res.rows;
  }

  /**
   * Get paginated tenant-scoped payment transaction history.
   * Excludes internal provider metadata and clearly flags simulated payments.
   */
  async getPaymentHistory(tenantId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    if (!tenantId) {
      return { items: [], total: 0, page: safePage, limit: safeLimit };
    }

    const offset = (safePage - 1) * safeLimit;
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM payments
         WHERE tenant_id = $1::uuid`,
        [tenantId],
      );
      const total = Number(countRes.rows[0]?.total ?? 0);

      const listRes = await client.query(
        `SELECT p.id, p.amount, p.currency, p.provider, p.provider_transaction_id,
                p.status, p.payment_method, p.verified_at, p.created_at,
                (p.provider = 'SIMULATED') AS is_simulated,
                sp.name AS plan_name,
                i.invoice_number
         FROM payments p
         LEFT JOIN tenant_subscriptions ts ON ts.id = p.subscription_id
         LEFT JOIN subscription_plans sp ON sp.id = ts.plan_id
         LEFT JOIN invoices i ON i.payment_id = p.id
         WHERE p.tenant_id = $1::uuid
         ORDER BY p.created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, safeLimit, offset],
      );

      return {
        items: listRes.rows,
        total,
        page: safePage,
        limit: safeLimit,
      };
    });
  }

  private formatAmountInWords(amount: number): string {
    const rounded = Math.round(Number(amount) || 0);
    return `INR ${rounded.toLocaleString('en-IN')} only`;
  }

  private mapReceiptRow(row: any) {
    return {
      id: row.receipt_number,
      uuid: row.id,
      agreementId: row.agreement_number || row.agreement_id || '',
      payer: row.payer_name,
      amount: Number(row.amount || 0),
      amountInWords: row.amount_in_words,
      mode: row.payment_mode || '—',
      status: row.status,
      date: row.acknowledged_at
        ? new Date(row.acknowledged_at).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : new Date(row.created_at).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
      txRef: row.tx_reference || '—',
      purpose: row.purpose,
      acknowledgedBy: row.acknowledged_by_name || '—',
      verificationToken: row.verification_token,
    };
  }

  async listReceipts(tenantId: string) {
    if (!tenantId) {
      return [];
    }
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT *
         FROM payment_receipts
         WHERE tenant_id = $1::uuid
         ORDER BY created_at DESC`,
        [tenantId],
      );
      return res.rows.map((r) => this.mapReceiptRow(r));
    });
  }

  async createReceipt(
    tenantId: string,
    actor: { id: string; email?: string; fullName?: string; role?: string },
    dto: CreateReceiptDto,
  ) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant workspace context is required.');
    }
    const issueNow = Boolean(dto.issue_immediately && dto.tx_reference?.trim());
    const year = new Date().getFullYear();
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const receiptNumber = issueNow ? `RCT-${year}-${suffix}` : `RCT-PENDING-${suffix}`;
    const verificationToken = `GSIGN-RCT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const amountInWords = this.formatAmountInWords(dto.amount);
    const actorDisplay = actor.fullName || actor.email || 'Admin';

    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO payment_receipts (
           tenant_id, receipt_number, agreement_id, agreement_number,
           payer_name, amount, amount_in_words, payment_mode, tx_reference,
           purpose, status, acknowledged_by, acknowledged_by_name, acknowledged_at,
           verification_token
         ) VALUES (
           $1::uuid, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14,
           $15
         )
         RETURNING *`,
        [
          tenantId,
          receiptNumber,
          dto.agreement_id || null,
          dto.agreement_number || null,
          dto.payer_name.trim(),
          dto.amount,
          amountInWords,
          issueNow ? (dto.payment_mode?.trim() || 'UPI') : '—',
          issueNow ? dto.tx_reference!.trim() : null,
          dto.purpose.trim(),
          issueNow ? 'Issued' : 'Payment not confirmed',
          issueNow ? actor.id : null,
          issueNow ? actorDisplay : null,
          issueNow ? new Date().toISOString() : null,
          verificationToken,
        ],
      );
      const created = res.rows[0];

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata)
         VALUES ($1, $2, $3, $4, 'PAYMENT_RECEIPT', $5, $6::uuid, $7, $8)`,
        [
          actor.id,
          actor.email || 'unknown',
          actor.role || 'Company Admin',
          issueNow ? 'RECEIPT_ISSUED' : 'RECEIPT_PENDING_CREATED',
          created.id,
          tenantId,
          dto.purpose.trim(),
          JSON.stringify({ receipt_number: receiptNumber, amount: dto.amount }),
        ],
      );

      return this.mapReceiptRow(created);
    });
  }

  async acknowledgeReceipt(
    tenantId: string,
    receiptIdOrNumber: string,
    actor: { id: string; email?: string; fullName?: string; role?: string },
    dto: AcknowledgeReceiptDto,
  ) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant workspace context is required.');
    }
    const actorDisplay = actor.fullName || actor.email || 'Admin';

    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const existingRes = await client.query(
        `SELECT *
         FROM payment_receipts
         WHERE tenant_id = $1::uuid
           AND (id::text = $2 OR receipt_number = $2)
         LIMIT 1`,
        [tenantId, receiptIdOrNumber],
      );
      if (existingRes.rows.length === 0) {
        throw new NotFoundException(`Payment receipt ${receiptIdOrNumber} not found.`);
      }
      const existing = existingRes.rows[0];
      if (existing.status === 'Issued') {
        throw new ConflictException(`Payment receipt ${existing.receipt_number} is already issued.`);
      }

      const year = new Date().getFullYear();
      const nextReceiptNumber = existing.receipt_number.startsWith('RCT-PENDING')
        ? `RCT-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
        : existing.receipt_number;

      const updatedRes = await client.query(
        `UPDATE payment_receipts
         SET receipt_number = $1,
             payment_mode = $2,
             tx_reference = $3,
             status = 'Issued',
             acknowledged_by = $4,
             acknowledged_by_name = $5,
             acknowledged_at = NOW(),
             updated_at = NOW()
         WHERE id = $6::uuid AND tenant_id = $7::uuid
         RETURNING *`,
        [
          nextReceiptNumber,
          dto.payment_mode.trim(),
          dto.tx_reference.trim(),
          actor.id,
          actorDisplay,
          existing.id,
          tenantId,
        ],
      );
      const updated = updatedRes.rows[0];

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata)
         VALUES ($1, $2, $3, 'RECEIPT_ACKNOWLEDGED', 'PAYMENT_RECEIPT', $4, $5::uuid, $6, $7)`,
        [
          actor.id,
          actor.email || 'unknown',
          actor.role || 'Company Admin',
          updated.id,
          tenantId,
          `Payment acknowledged via ${dto.payment_mode.trim()}`,
          JSON.stringify({
            receipt_number: updated.receipt_number,
            tx_reference: dto.tx_reference.trim(),
          }),
        ],
      );

      return this.mapReceiptRow(updated);
    });
  }

  private async enforceCheckoutRateLimit(ip: string): Promise<void> {
    if (!this.redis) return;
    const safeIp = (ip || 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '');
    const key = `checkout_init:rl:${safeIp}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, 900);
      }
      if (count > 10) {
        throw new HttpException(
          'Too many checkout initiation attempts. Please wait 15 minutes before trying again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
    }
  }

  private assertValidPaymentTransition(from: string, to: PaymentState): void {
    const allowed = PAYMENT_STATE_TRANSITIONS[from as PaymentState];
    if (!allowed || !allowed.includes(to)) {
      throw new BadRequestException(`Invalid payment state transition from '${from}' to '${to}'.`);
    }
  }

  async initiateRegistrationCheckout(dto: InitiateCheckoutDto, ip?: string) {
    await this.enforceCheckoutRateLimit(ip || 'unknown');
    const normalizedEmail = dto.admin_email.trim().toLowerCase();
    try {
      verifyCheckoutAccessToken(dto.checkout_access_token, dto.registration_id, normalizedEmail);
    } catch (err: any) {
      throw new ForbiddenException(err?.message || 'Invalid or expired checkout access token.');
    }

    return this.db.executeAsSuperAdmin(async (client) => {
      // 1. Validate registration exists & caller owns it
      const regRes = await client.query(
        `SELECT id, company_name, business_email, admin_email, status, tenant_id
         FROM company_registrations
         WHERE id = $1::uuid
         LIMIT 1`,
        [dto.registration_id],
      );
      if (regRes.rows.length === 0) {
        throw new NotFoundException('Company registration not found.');
      }
      const reg = regRes.rows[0];

      const regAdmin = String(reg.admin_email || '').trim().toLowerCase();
      const regBiz = String(reg.business_email || '').trim().toLowerCase();
      if (normalizedEmail !== regAdmin && normalizedEmail !== regBiz) {
        throw new ForbiddenException('You are not authorized to initiate checkout for this registration.');
      }

      if (reg.status !== 'EMAIL_VERIFIED' && reg.status !== 'PAYMENT_PENDING') {
        throw new BadRequestException(
          `Registration is not eligible for checkout (current status: ${reg.status}).`,
        );
      }
      if (!reg.tenant_id) {
        throw new BadRequestException(
          'Workspace setup must be completed before initiating checkout.',
        );
      }

      // 2. Validate plan is active and self-serve purchasable; calculate price strictly server-side
      const planRes = await client.query(
        `SELECT id, name, slug, monthly_price, annual_price, is_active
         FROM subscription_plans
         WHERE id = $1::uuid
         LIMIT 1`,
        [dto.plan_id],
      );
      if (planRes.rows.length === 0) {
        throw new NotFoundException('Subscription plan not found.');
      }
      const plan = planRes.rows[0];
      const serverAmount =
        dto.billing_cycle === 'annual' ? Number(plan.annual_price) : Number(plan.monthly_price);
      if (!plan.is_active || plan.slug === 'enterprise' || !Number.isFinite(serverAmount) || serverAmount <= 0) {
        throw new BadRequestException('Selected subscription plan is not active or not eligible for self-serve checkout.');
      }

      // 3. Idempotency check (explicit idempotency_key or existing active PAYMENT_PENDING/PAYMENT_PROCESSING checkout)
      if (dto.idempotency_key?.trim()) {
        const idemRes = await client.query(
          `SELECT id, checkout_reference, status, amount, currency, provider, provider_transaction_id, metadata
           FROM payments
           WHERE idempotency_key = $1
             AND registration_id = $2::uuid
           LIMIT 1`,
          [dto.idempotency_key.trim(), reg.id],
        );
        if (idemRes.rows.length > 0) {
          const existing = idemRes.rows[0];
          const meta = existing.metadata || {};
          return {
            success: true,
            idempotent_replay: true,
            payment_id: existing.id,
            checkout_reference: existing.checkout_reference,
            status: existing.status,
            amount: Number(existing.amount),
            currency: existing.currency,
            billing_cycle: meta.billing_cycle || dto.billing_cycle,
            plan_name: meta.plan_name || plan.name,
            provider: existing.provider,
            mode: meta.mode || (existing.provider === 'SIMULATED' ? 'simulated_dev' : 'manual_pending'),
            is_simulated: existing.provider === 'SIMULATED',
            subscription_status: 'PAYMENT_PENDING',
          };
        }
      }

      const activePendingRes = await client.query(
        `SELECT id, checkout_reference, status, amount, currency, provider, metadata
         FROM payments
         WHERE registration_id = $1::uuid
           AND status IN ('PAYMENT_PENDING', 'PAYMENT_PROCESSING')
           AND amount = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [reg.id, serverAmount],
      );
      if (activePendingRes.rows.length > 0) {
        const existing = activePendingRes.rows[0];
        const meta = existing.metadata || {};
        return {
          success: true,
          idempotent_replay: true,
          payment_id: existing.id,
          checkout_reference: existing.checkout_reference,
          status: existing.status,
          amount: Number(existing.amount),
          currency: existing.currency,
          billing_cycle: meta.billing_cycle || dto.billing_cycle,
          plan_name: meta.plan_name || plan.name,
          provider: existing.provider,
          mode: meta.mode || (existing.provider === 'SIMULATED' ? 'simulated_dev' : 'manual_pending'),
          is_simulated: existing.provider === 'SIMULATED',
          subscription_status: 'PAYMENT_PENDING',
        };
      }

      // 4. Resolve payment adapter and create PAYMENT_PENDING record (NEVER activate subscription here)
      const subRes = await client.query(
        `SELECT id FROM tenant_subscriptions WHERE tenant_id = $1::uuid LIMIT 1`,
        [reg.tenant_id],
      );
      const subscriptionId = subRes.rows[0]?.id || null;

      const checkoutReference = `CHK-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const adapter = resolvePaymentProviderAdapter();
      const sessionInit = await adapter.createCheckoutSession({
        checkoutReference,
        amountInr: serverAmount,
        currency: 'INR',
        tenantId: reg.tenant_id,
        planName: plan.name,
        billingCycle: dto.billing_cycle,
      });

      const payRes = await client.query(
        `INSERT INTO payments (
           tenant_id, subscription_id, registration_id, checkout_reference, idempotency_key,
           amount, currency, provider, provider_transaction_id, status, metadata
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4, $5,
           $6, 'INR', $7, $8, 'PAYMENT_PENDING', $9::jsonb
         )
         RETURNING id, checkout_reference, status, amount, currency, provider`,
        [
          reg.tenant_id,
          subscriptionId,
          reg.id,
          checkoutReference,
          dto.idempotency_key?.trim() || null,
          serverAmount,
          sessionInit.provider,
          sessionInit.providerTransactionId,
          JSON.stringify({
            plan_id: plan.id,
            plan_name: plan.name,
            billing_cycle: dto.billing_cycle,
            mode: sessionInit.mode,
            is_simulated: sessionInit.isSimulated,
          }),
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata)
         VALUES ($1, 'PUBLIC_REGISTRATION', 'CHECKOUT_INITIATED', 'PAYMENT', $2, $3::uuid, $4, $5::jsonb)`,
        [
          normalizedEmail,
          payRes.rows[0].id,
          reg.tenant_id,
          'Self-serve checkout initiated in PAYMENT_PENDING state',
          JSON.stringify({
            checkout_reference: checkoutReference,
            amount: serverAmount,
            provider: sessionInit.provider,
            mode: sessionInit.mode,
          }),
        ],
      );

      return {
        success: true,
        idempotent_replay: false,
        payment_id: payRes.rows[0].id,
        checkout_reference: checkoutReference,
        status: 'PAYMENT_PENDING' as PaymentState,
        amount: serverAmount,
        currency: 'INR',
        billing_cycle: dto.billing_cycle,
        plan_name: plan.name,
        provider: sessionInit.provider,
        mode: sessionInit.mode,
        is_simulated: sessionInit.isSimulated,
        checkout_url: sessionInit.checkoutUrl,
        subscription_status: 'PAYMENT_PENDING',
      };
    });
  }

  async getCheckoutStatus(dto: CheckoutStatusDto) {
    const normalizedEmail = dto.admin_email.trim().toLowerCase();
    try {
      verifyCheckoutAccessToken(dto.checkout_access_token, undefined, normalizedEmail);
    } catch (err: any) {
      throw new ForbiddenException(err?.message || 'Invalid or expired checkout access token.');
    }
    return this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT p.id, p.registration_id, p.checkout_reference, p.status, p.amount, p.currency, p.provider, p.verified_at,
                p.metadata, cr.admin_email, cr.business_email, ts.status AS subscription_status
         FROM payments p
         JOIN company_registrations cr ON cr.id = p.registration_id
         LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = p.tenant_id
         WHERE p.checkout_reference = $1
         LIMIT 1`,
        [dto.checkout_reference.trim()],
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('Checkout reference not found.');
      }
      const row = res.rows[0];
      try {
        verifyCheckoutAccessToken(dto.checkout_access_token, row.registration_id, normalizedEmail);
      } catch (err: any) {
        throw new ForbiddenException(err?.message || 'Not authorized to view this checkout status.');
      }
      if (
        normalizedEmail !== String(row.admin_email || '').toLowerCase() &&
        normalizedEmail !== String(row.business_email || '').toLowerCase()
      ) {
        throw new ForbiddenException('Not authorized to view this checkout status.');
      }
      return {
        checkout_reference: row.checkout_reference,
        status: row.status,
        amount: Number(row.amount),
        currency: row.currency,
        provider: row.provider,
        is_simulated: row.provider === 'SIMULATED',
        verified_at: row.verified_at,
        subscription_status: row.subscription_status || 'PAYMENT_PENDING',
        plan_name: row.metadata?.plan_name || null,
        billing_cycle: row.metadata?.billing_cycle || null,
      };
    });
  }

  async transitionCheckoutState(checkoutReference: string, dto: TransitionCheckoutDto) {
    const normalizedEmail = dto.admin_email.trim().toLowerCase();
    try {
      verifyCheckoutAccessToken(dto.checkout_access_token, undefined, normalizedEmail);
    } catch (err: any) {
      throw new ForbiddenException(err?.message || 'Invalid or expired checkout access token.');
    }
    return this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT p.id, p.registration_id, p.status, p.tenant_id, cr.admin_email, cr.business_email
         FROM payments p
         JOIN company_registrations cr ON cr.id = p.registration_id
         WHERE p.checkout_reference = $1
         LIMIT 1`,
        [checkoutReference.trim()],
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('Checkout reference not found.');
      }
      const row = res.rows[0];
      try {
        verifyCheckoutAccessToken(dto.checkout_access_token, row.registration_id, normalizedEmail);
      } catch (err: any) {
        throw new ForbiddenException(err?.message || 'Not authorized to update this checkout.');
      }
      if (
        normalizedEmail !== String(row.admin_email || '').toLowerCase() &&
        normalizedEmail !== String(row.business_email || '').toLowerCase()
      ) {
        throw new ForbiddenException('Not authorized to update this checkout.');
      }
      this.assertValidPaymentTransition(row.status, dto.status);

      const upd = await client.query(
        `UPDATE payments
         SET status = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $1::uuid
         RETURNING id, checkout_reference, status`,
        [row.id, dto.status, JSON.stringify({ transition_reason: dto.reason || null })],
      );
      return upd.rows[0];
    });
  }

  async handleVerifiedWebhook(dto: PaymentWebhookConfirmDto, rawBody: string, signature?: string) {
    const adapter = resolvePaymentProviderAdapter();
    if (!adapter.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid or missing payment webhook signature.');
    }

    return this.db.executeAsSuperAdmin(async (client) => {
      const payRes = await client.query(
        `SELECT p.id, p.tenant_id, p.subscription_id, p.registration_id, p.amount, p.currency, p.status, p.metadata
         FROM payments p
         WHERE p.checkout_reference = $1
         FOR UPDATE`,
        [dto.checkout_reference.trim()],
      );
      if (payRes.rows.length === 0) {
        throw new NotFoundException('Checkout reference not found.');
      }
      const payment = payRes.rows[0];

      // Duplicate webhook protection (idempotent if already completed)
      if (payment.status === 'PAYMENT_COMPLETED' || payment.status === 'COMPLETED') {
        return {
          success: true,
          already_completed: true,
          checkout_reference: dto.checkout_reference,
          status: payment.status,
        };
      }

      // Amount and currency mismatch protection
      if (
        Math.abs(Number(payment.amount) - Number(dto.amount)) > 0.01 ||
        String(payment.currency).toUpperCase() !== String(dto.currency).toUpperCase()
      ) {
        throw new BadRequestException('Webhook amount or currency mismatch.');
      }

      this.assertValidPaymentTransition(payment.status, dto.status);

      // Replay protection: ensure provider_transaction_id was not already applied to another completed payment
      const txReplayRes = await client.query(
        `SELECT id FROM payments
         WHERE provider_transaction_id = $1
           AND id <> $2::uuid
           AND status IN ('PAYMENT_COMPLETED', 'COMPLETED')
         LIMIT 1`,
        [dto.provider_transaction_id.trim(), payment.id],
      );
      if (txReplayRes.rows.length > 0) {
        throw new ConflictException('Provider transaction ID has already been applied to another payment.');
      }

      // Lookup registrant/tenant email for notification
      const contactRes = await client.query(
        `SELECT t.name AS company_name,
                COALESCE(cr.admin_email, t.contact_email) AS recipient_email,
                COALESCE(cr.admin_full_name, t.name) AS recipient_name
         FROM tenants t
         LEFT JOIN company_registrations cr ON cr.id = $2
         WHERE t.id = $1::uuid
         LIMIT 1`,
        [payment.tenant_id, payment.registration_id || null],
      );
      const contact = contactRes.rows[0];
      const planName = payment.metadata?.plan_name || 'GSIGN Subscription';

      if (dto.status === 'PAYMENT_FAILED') {
        await client.query(
          `UPDATE payments SET status = 'PAYMENT_FAILED', provider_transaction_id = $2 WHERE id = $1::uuid`,
          [payment.id, dto.provider_transaction_id],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata)
           VALUES ('payment-webhook@gsign.in', 'SYSTEM', 'PAYMENT_WEBHOOK_FAILED', 'PAYMENT', $1, $2::uuid, 'Gateway webhook reported payment failure', $3::jsonb)`,
          [payment.id, payment.tenant_id, JSON.stringify({ checkout_reference: dto.checkout_reference, provider_transaction_id: dto.provider_transaction_id })],
        );
        if (this.emailService && contact?.recipient_email) {
          await this.emailService
            .sendNotification({
              template: 'payment_failure',
              to: contact.recipient_email,
              tenantId: payment.tenant_id,
              idempotencyKey: `pay_fail:${dto.checkout_reference}:${dto.provider_transaction_id}`,
              payload: {
                recipientName: contact.recipient_name || 'Customer',
                companyName: contact.company_name || 'Your Company',
                planName,
                checkoutReference: dto.checkout_reference,
              },
              safeMetadata: { checkout_reference: dto.checkout_reference },
            })
            .catch(() => {});
        }
        return { success: true, checkout_reference: dto.checkout_reference, status: 'PAYMENT_FAILED' };
      }

      // Verified PAYMENT_COMPLETED -> activate subscription, tenant, registration, and invoice
      const billingCycle = payment.metadata?.billing_cycle === 'annual' ? 'annual' : 'monthly';
      const durationMonths = billingCycle === 'annual' ? 12 : 1;
      const invoiceNum = `INV-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      try {
        await client.query(
          `UPDATE payments
           SET status = 'PAYMENT_COMPLETED',
               provider_transaction_id = $2,
               verified_at = NOW()
           WHERE id = $1::uuid`,
          [payment.id, dto.provider_transaction_id],
        );
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new ConflictException('Provider transaction ID has already been applied to another payment.');
        }
        throw err;
      }

      if (payment.subscription_id) {
        await client.query(
          `UPDATE tenant_subscriptions
           SET status = 'ACTIVE',
               current_period_start = NOW(),
               current_period_end = NOW() + ($2 || ' months')::interval,
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [payment.subscription_id, durationMonths.toString()],
        );
      }

      await client.query(
        `UPDATE tenants SET status = 'Active', updated_at = NOW() WHERE id = $1::uuid`,
        [payment.tenant_id],
      );

      if (payment.registration_id) {
        await client.query(
          `UPDATE company_registrations SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1::uuid`,
          [payment.registration_id],
        );
      }

      const taxAmount = Number(payment.amount) * 0.18;
      const totalAmount = Number(payment.amount) + taxAmount;
      await client.query(
        `INSERT INTO invoices (tenant_id, payment_id, invoice_number, amount, tax_amount, total_amount, status)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'PAID')`,
        [payment.tenant_id, payment.id, invoiceNum, payment.amount, taxAmount, totalAmount],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata)
         VALUES ('payment-webhook@gsign.in', 'SYSTEM', 'PAYMENT_WEBHOOK_COMPLETED', 'PAYMENT', $1, $2::uuid, 'Verified gateway webhook activated subscription', $3::jsonb)`,
        [payment.id, payment.tenant_id, JSON.stringify({ checkout_reference: dto.checkout_reference, provider_transaction_id: dto.provider_transaction_id, invoice_number: invoiceNum })],
      );

      if (this.emailService && contact?.recipient_email) {
        await this.emailService
          .sendNotification({
            template: 'payment_confirmation',
            to: contact.recipient_email,
            tenantId: payment.tenant_id,
            idempotencyKey: `pay_ok:${dto.checkout_reference}`,
            payload: {
              recipientName: contact.recipient_name || 'Customer',
              companyName: contact.company_name || 'Your Company',
              planName,
              amountInr: Number(payment.amount),
              checkoutReference: dto.checkout_reference,
            },
            safeMetadata: { checkout_reference: dto.checkout_reference, invoice_number: invoiceNum },
          })
          .catch(() => {});
      }

      return {
        success: true,
        already_completed: false,
        checkout_reference: dto.checkout_reference,
        status: 'PAYMENT_COMPLETED',
        invoice_number: invoiceNum,
      };
    });
  }

  async listPlatformCheckouts(statusFilter?: string) {
    return this.db.executeAsSuperAdmin(async (client) => {
      const params: any[] = [];
      let where = '';
      if (statusFilter && statusFilter !== 'all') {
        params.push(statusFilter);
        where = `WHERE p.status = $1`;
      }
      const res = await client.query(
        `SELECT p.id, p.tenant_id, p.registration_id, p.checkout_reference, p.amount, p.currency,
                p.provider, p.status, p.verified_at, p.created_at, p.metadata,
                t.name AS tenant_name, t.status AS tenant_status
         FROM payments p
         JOIN tenants t ON t.id = p.tenant_id
         ${where}
         ORDER BY p.created_at DESC
         LIMIT 100`,
        params,
      );
      return res.rows;
    });
  }
}
