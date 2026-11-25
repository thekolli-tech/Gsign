import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SimulateCheckoutDto } from './dto/simulate-checkout.dto';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Simulates checkout and payment verification for a company subscription
   * Activates paid workspace after verified transaction
   */
  async simulateCheckout(dto: SimulateCheckoutDto) {
    // 1. Verify tenant exists
    const tenantRes = await this.db.query('SELECT id, name FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (tenantRes.rows.length === 0) {
      throw new NotFoundException(`Tenant with ID ${dto.tenant_id} not found.`);
    }
    const tenant = tenantRes.rows[0];

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

    const res = await this.db.query(
      `SELECT id, invoice_number, amount, tax_amount, total_amount, status, created_at
       FROM invoices
       WHERE tenant_id = $1
       ORDER BY created_at DESC;`,
      [tenantId]
    );

    return res.rows;
  }
}
