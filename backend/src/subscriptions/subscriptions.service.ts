import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActivateManualSubscriptionDto } from './dto/activate-manual.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Get all active paid subscription plans (Public)
   */
  async getPlans() {
    // Ensure canonical pricing tiers are synced
    const canonical = [
      {
        name: 'Starter Plan',
        slug: 'starter',
        description: '25 documents/month; 2 users; standard templates',
        monthly_price: 499.0,
        annual_price: 4990.0,
        max_agreements: 25,
        max_users: 2,
        features: JSON.stringify([
          '25 documents/month',
          '2 users',
          'Standard templates',
          'Email OTP verification & audit trail',
        ]),
      },
      {
        name: 'Business Plan',
        slug: 'business',
        description: '100 documents/month; 5 users; custom branding and templates',
        monthly_price: 1499.0,
        annual_price: 14990.0,
        max_agreements: 100,
        max_users: 5,
        features: JSON.stringify([
          '100 documents/month',
          '5 users',
          'Custom branding and templates',
          'Email OTP verification & audit trail',
        ]),
      },
      {
        name: 'Professional Plan',
        slug: 'professional',
        description: '300 documents/month; 15 users; advanced workflows and reports',
        monthly_price: 2999.0,
        annual_price: 29990.0,
        max_agreements: 300,
        max_users: 15,
        features: JSON.stringify([
          '300 documents/month',
          '15 users',
          'Advanced workflows and reports',
          'Email OTP verification & audit trail',
        ]),
      },
      {
        name: 'Enterprise Plan',
        slug: 'enterprise',
        description: 'Higher volume, custom domain, advanced branding, integrations and support',
        monthly_price: 0.0,
        annual_price: 0.0,
        max_agreements: -1,
        max_users: -1,
        features: JSON.stringify([
          'Custom document volume',
          'Unlimited team members',
          'Custom domain & advanced branding',
          'Dedicated integrations and priority support',
        ]),
      },
    ];

    const check = await this.db.query(
      `SELECT slug FROM subscription_plans WHERE slug = 'business' AND is_active = true`
    );
    if (check.rows.length === 0) {
      await this.db.query(`UPDATE subscription_plans SET is_active = false WHERE slug = 'growth'`);
      for (const p of canonical) {
        await this.db.query(
          `INSERT INTO subscription_plans (name, slug, description, monthly_price, annual_price, max_agreements_per_month, max_users, features, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             monthly_price = EXCLUDED.monthly_price,
             annual_price = EXCLUDED.annual_price,
             max_agreements_per_month = EXCLUDED.max_agreements_per_month,
             max_users = EXCLUDED.max_users,
             features = EXCLUDED.features,
             is_active = true;`,
          [p.name, p.slug, p.description, p.monthly_price, p.annual_price, p.max_agreements, p.max_users, p.features]
        );
      }
    }

    const res = await this.db.query(
      `SELECT id, name, slug, description, monthly_price, annual_price, max_agreements_per_month, max_users, features
       FROM subscription_plans
       WHERE is_active = true
       ORDER BY CASE WHEN slug = 'enterprise' THEN 1 ELSE 0 END, monthly_price ASC;`
    );
    return res.rows;
  }

  /**
   * Get active subscription for tenant
   */
  async getCurrentSubscription(tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('No tenant context provided');
    }

    const res = await this.db.executeWithTenantContext(tenantId, async (client) => {
      return client.query(
        `SELECT ts.id, ts.tenant_id, ts.billing_cycle, ts.status, ts.current_period_start, ts.current_period_end, ts.grace_period_end,
                sp.name as plan_name, sp.slug as plan_slug, sp.max_agreements_per_month, sp.max_users, sp.features
         FROM tenant_subscriptions ts
         JOIN subscription_plans sp ON ts.plan_id = sp.id
         WHERE ts.tenant_id = $1`,
        [tenantId]
      );
    });

    if (res.rows.length === 0) {
      return {
        has_subscription: false,
        status: 'NONE',
        message: 'No subscription record found. A paid subscription is required to access workspace features.',
      };
    }

    const sub = res.rows[0];
    return {
      has_subscription: true,
      ...sub,
    };
  }

  /**
   * Manual subscription activation by Platform Owner
   * Logs required audit trail record
   */
  async activateManual(actor: any, dto: ActivateManualSubscriptionDto) {
    if (!actor.isPlatformOwner && actor.role !== 'PLATFORM_OWNER') {
      throw new ForbiddenException('Only the GSIGN Platform Owner can manually activate company subscriptions.');
    }

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('A reason is mandatory for manual subscription activation.');
    }

    // Verify tenant
    const tenantRes = await this.db.query('SELECT id, name FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (tenantRes.rows.length === 0) {
      throw new NotFoundException(`Tenant with ID ${dto.tenant_id} not found.`);
    }
    const tenant = tenantRes.rows[0];

    // Verify plan
    const planRes = await this.db.query('SELECT id, name, monthly_price FROM subscription_plans WHERE id = $1', [dto.plan_id]);
    if (planRes.rows.length === 0) {
      throw new NotFoundException(`Plan with ID ${dto.plan_id} not found.`);
    }
    const plan = planRes.rows[0];

    const months = dto.duration_months || (dto.billing_cycle === 'annual' ? 12 : 1);

    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.is_super_admin = 'true';");

      // 1. Activate or upsert tenant subscription
      await client.query(
        `INSERT INTO tenant_subscriptions (
           tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end
         ) VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW() + ($4 || ' months')::interval)
         ON CONFLICT (tenant_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           billing_cycle = EXCLUDED.billing_cycle,
           status = 'ACTIVE',
           current_period_start = NOW(),
           current_period_end = NOW() + ($4 || ' months')::interval,
           updated_at = NOW();`,
        [dto.tenant_id, dto.plan_id, dto.billing_cycle, months.toString()]
      );

      // 2. Activate tenant status
      await client.query(`UPDATE tenants SET status = 'Active', updated_at = NOW() WHERE id = $1`, [dto.tenant_id]);

      // 3. Record Audit Log
      await client.query(
        `INSERT INTO audit_logs (
           actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, metadata
         ) VALUES ($1, $2, 'PLATFORM_OWNER', 'SUBSCRIPTION_MANUAL_ACTIVATION', 'TENANT', $3, $4, $5, $6);`,
        [
          actor.id,
          actor.email,
          dto.tenant_id,
          dto.tenant_id,
          dto.reason.trim(),
          JSON.stringify({
            tenant_name: tenant.name,
            plan_name: plan.name,
            billing_cycle: dto.billing_cycle,
            duration_months: months,
          }),
        ]
      );

      await client.query('COMMIT');

      return {
        success: true,
        message: `Subscription for ${tenant.name} has been manually activated on ${plan.name} for ${months} month(s).`,
        tenant_id: dto.tenant_id,
        plan_name: plan.name,
        status: 'ACTIVE',
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
