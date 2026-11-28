import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActivateManualSubscriptionDto } from './dto/activate-manual.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-plan.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Get all active paid subscription plans (Public)
   */
  async getPlans(includeInactive = false) {
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

    const whereClause = includeInactive ? '' : 'WHERE is_active = true';
    const res = await this.db.query(
      `SELECT id, name, slug, description, monthly_price, annual_price, max_agreements_per_month, max_users, features, is_active, updated_at
       FROM subscription_plans
       ${whereClause}
       ORDER BY CASE WHEN slug = 'enterprise' THEN 1 ELSE 0 END, monthly_price ASC;`
    );
    return res.rows;
  }

  /**
   * Update an existing subscription plan (Platform Owner only).
   * Preserves plan IDs and slugs, rejects invalid negative limits (other than -1), and records an audit log.
   */
  async updatePlan(actor: any, planId: string, dto: UpdateSubscriptionPlanDto) {
    if (!actor?.isPlatformOwner && actor?.role !== 'PLATFORM_OWNER') {
      throw new ForbiddenException('Only the GSIGN Platform Owner can update subscription plans.');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(planId)) {
      throw new BadRequestException('Invalid subscription plan ID.');
    }

    if (dto.monthly_price !== undefined && dto.monthly_price < 0) {
      throw new BadRequestException('Monthly price cannot be negative.');
    }
    if (dto.annual_price !== undefined && dto.annual_price < 0) {
      throw new BadRequestException('Annual price cannot be negative.');
    }
    if (
      dto.max_agreements_per_month !== undefined &&
      dto.max_agreements_per_month !== -1 &&
      dto.max_agreements_per_month < 0
    ) {
      throw new BadRequestException('Monthly agreement limit must be -1 (unlimited) or a non-negative integer.');
    }
    if (dto.max_users !== undefined && dto.max_users !== -1 && dto.max_users < 0) {
      throw new BadRequestException('User seat limit must be -1 (unlimited) or a non-negative integer.');
    }

    const hasUpdates =
      dto.name !== undefined ||
      dto.description !== undefined ||
      dto.monthly_price !== undefined ||
      dto.annual_price !== undefined ||
      dto.max_agreements_per_month !== undefined ||
      dto.max_users !== undefined ||
      dto.features !== undefined ||
      dto.is_active !== undefined;

    if (!hasUpdates) {
      throw new BadRequestException('At least one updatable plan field must be provided.');
    }

    return this.db.executeAsSuperAdmin(async (client) => {
      const existingRes = await client.query(
        `SELECT id, name, slug, description, monthly_price, annual_price,
                max_agreements_per_month, max_users, features, is_active
         FROM subscription_plans
         WHERE id = $1::uuid
         FOR UPDATE`,
        [planId],
      );
      if (existingRes.rows.length === 0) {
        throw new NotFoundException(`Subscription plan ${planId} not found.`);
      }
      const before = existingRes.rows[0];

      const nextName = dto.name !== undefined ? dto.name.trim() : before.name;
      if (!nextName) {
        throw new BadRequestException('Plan name cannot be empty.');
      }
      const nextDescription = dto.description !== undefined ? dto.description.trim() : before.description;
      const nextMonthly = dto.monthly_price !== undefined ? Number(dto.monthly_price) : Number(before.monthly_price);
      const nextAnnual = dto.annual_price !== undefined ? Number(dto.annual_price) : Number(before.annual_price);
      const nextMaxAgreements =
        dto.max_agreements_per_month !== undefined
          ? Number(dto.max_agreements_per_month)
          : Number(before.max_agreements_per_month);
      const nextMaxUsers = dto.max_users !== undefined ? Number(dto.max_users) : Number(before.max_users);
      const nextFeatures =
        dto.features !== undefined
          ? JSON.stringify(dto.features.map((f) => f.trim()).filter(Boolean))
          : JSON.stringify(Array.isArray(before.features) ? before.features : []);
      const nextIsActive = dto.is_active !== undefined ? Boolean(dto.is_active) : Boolean(before.is_active);

      const updateRes = await client.query(
        `UPDATE subscription_plans
         SET name = $1,
             description = $2,
             monthly_price = $3,
             annual_price = $4,
             max_agreements_per_month = $5,
             max_users = $6,
             features = $7::jsonb,
             is_active = $8,
             updated_at = NOW()
         WHERE id = $9::uuid
         RETURNING id, name, slug, description, monthly_price, annual_price,
                   max_agreements_per_month, max_users, features, is_active, updated_at`,
        [
          nextName,
          nextDescription,
          nextMonthly,
          nextAnnual,
          nextMaxAgreements,
          nextMaxUsers,
          nextFeatures,
          nextIsActive,
          planId,
        ],
      );
      const after = updateRes.rows[0];

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, reason, metadata)
         VALUES ($1::uuid, $2, 'PLATFORM_OWNER', 'SUBSCRIPTION_PLAN_UPDATED', 'SUBSCRIPTION_PLAN', $3, $4, $5::jsonb)`,
        [
          actor.id || null,
          actor.email || 'platform-owner@gsign.in',
          planId,
          `Updated subscription plan ${after.name} (${after.slug})`,
          JSON.stringify({ before, after }),
        ],
      );

      return after;
    });
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
   * Live tenant-scoped usage and quota summary (UTC calendar month boundaries)
   */
  async getCurrentUsage(tenantId: string | null, user?: any) {
    if (!tenantId) {
      if (user?.isPlatformOwner || user?.isSuperAdmin || user?.role === 'PLATFORM_OWNER') {
        return {
          is_platform_owner: true,
          exempt_from_quotas: true,
          has_subscription: false,
          status: 'EXEMPT',
          message: 'Platform Owner is exempt from tenant subscription and quota restrictions.',
        };
      }
      throw new BadRequestException('No tenant context provided');
    }

    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const subRes = await client.query(
        `SELECT ts.id, ts.tenant_id, ts.billing_cycle, ts.status, ts.current_period_start, ts.current_period_end,
                ts.grace_period_end,
                sp.name AS plan_name, sp.slug AS plan_slug, sp.monthly_price, sp.annual_price,
                sp.max_agreements_per_month, sp.max_users
         FROM tenant_subscriptions ts
         JOIN subscription_plans sp ON ts.plan_id = sp.id
         WHERE ts.tenant_id = $1::uuid
         LIMIT 1`,
        [tenantId],
      );

      const periodRes = await client.query(
        `SELECT date_trunc('month', NOW() AT TIME ZONE 'UTC')::date AS period_start,
                (date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date AS period_end`,
      );
      const { period_start: periodStart, period_end: periodEnd } = periodRes.rows[0];

      const usageRes = await client.query(
        `SELECT agreements_created, agreements_completed
         FROM usage_records
         WHERE tenant_id = $1::uuid AND period_start = $2::date
         LIMIT 1`,
        [tenantId, periodStart],
      );

      // Calculate actual retained storage across all non-deleted document versions for this tenant
      const storageRes = await client.query(
        `SELECT COALESCE(SUM(dv.byte_size), 0)::bigint AS retained_bytes
         FROM document_versions dv
         JOIN documents d ON d.id = dv.document_id
         WHERE dv.tenant_id = $1::uuid
           AND d.status <> 'DELETED'`,
        [tenantId],
      );

      const agCountRes = await client.query(
        `SELECT COUNT(*)::int AS created_cnt,
                COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed_cnt
         FROM agreements
         WHERE tenant_id = $1::uuid
           AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')`,
        [tenantId],
      );

      const seatRes = await client.query(
        `SELECT COUNT(*)::int AS active_users
         FROM tenant_memberships
         WHERE tenant_id = $1::uuid AND status = 'Active'`,
        [tenantId],
      );

      const pendingInvRes = await client.query(
        `SELECT COUNT(*)::int AS pending_invitations
         FROM invitations
         WHERE tenant_id = $1::uuid AND accepted_at IS NULL AND expires_at > NOW()`,
        [tenantId],
      );

      const usageRow = usageRes.rows[0];
      const agreementsCreated = Math.max(
        Number(usageRow?.agreements_created || 0),
        Number(agCountRes.rows[0]?.created_cnt || 0),
      );
      const agreementsCompleted = Math.max(
        Number(usageRow?.agreements_completed || 0),
        Number(agCountRes.rows[0]?.completed_cnt || 0),
      );
      const storageBytesUsed = Number(storageRes.rows[0]?.retained_bytes || 0);
      const activeUsers = Number(seatRes.rows[0]?.active_users || 0);
      const pendingInvitations = Number(pendingInvRes.rows[0]?.pending_invitations || 0);

      if (subRes.rows.length === 0) {
        return {
          has_subscription: false,
          status: 'NONE',
          period_start: periodStart,
          period_end: periodEnd,
          agreements_created: agreementsCreated,
          agreements_completed: agreementsCompleted,
          max_agreements_per_month: 0,
          remaining_agreements: 0,
          active_users: activeUsers,
          pending_invitations: pendingInvitations,
          max_users: 0,
          remaining_users: 0,
          storage_bytes_used: storageBytesUsed,
          storage_allowance_bytes: null,
        };
      }

      const sub = subRes.rows[0];
      const maxAgreements = Number(sub.max_agreements_per_month);
      const maxUsers = Number(sub.max_users);

      return {
        has_subscription: true,
        plan_name: sub.plan_name,
        plan_slug: sub.plan_slug,
        status: sub.status,
        billing_cycle: sub.billing_cycle,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        grace_period_end: sub.grace_period_end,
        period_start: periodStart,
        period_end: periodEnd,
        agreements_created: agreementsCreated,
        agreements_completed: agreementsCompleted,
        max_agreements_per_month: maxAgreements,
        remaining_agreements:
          maxAgreements === -1 ? null : Math.max(0, maxAgreements - agreementsCreated),
        active_users: activeUsers,
        pending_invitations: pendingInvitations,
        max_users: maxUsers,
        remaining_users:
          maxUsers === -1 ? null : Math.max(0, maxUsers - (activeUsers + pendingInvitations)),
        storage_bytes_used: storageBytesUsed,
        storage_allowance_bytes: null,
      };
    });
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

      // Idempotency check: if already ACTIVE on the same plan & billing cycle with active period
      const existingSubRes = await client.query(
        `SELECT id, plan_id, billing_cycle, status, current_period_end
         FROM tenant_subscriptions
         WHERE tenant_id = $1::uuid
         FOR UPDATE`,
        [dto.tenant_id],
      );
      const existingSub = existingSubRes.rows[0];
      if (
        existingSub &&
        existingSub.status === 'ACTIVE' &&
        existingSub.plan_id === dto.plan_id &&
        existingSub.billing_cycle === dto.billing_cycle &&
        existingSub.current_period_end &&
        new Date(existingSub.current_period_end).getTime() > Date.now()
      ) {
        await client.query('COMMIT');
        return {
          success: true,
          already_active: true,
          message: `Subscription for ${tenant.name} is already active on ${plan.name}.`,
          tenant_id: dto.tenant_id,
          plan_name: plan.name,
          status: 'ACTIVE',
        };
      }

      // 1. Activate or upsert tenant subscription
      const subUpsertRes = await client.query(
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
        [dto.tenant_id, dto.plan_id, dto.billing_cycle, months.toString()]
      );
      const subscriptionId = subUpsertRes.rows[0]?.id || existingSub?.id || null;

      // 2. Activate tenant status & complete pending company registration (if any)
      await client.query(`UPDATE tenants SET status = 'Active', updated_at = NOW() WHERE id = $1`, [dto.tenant_id]);
      const regUpdRes = await client.query(
        `UPDATE company_registrations
         SET status = 'COMPLETED', updated_at = NOW()
         WHERE tenant_id = $1::uuid AND status IN ('EMAIL_VERIFIED', 'PAYMENT_PENDING')
         RETURNING id`,
        [dto.tenant_id],
      );
      const registrationId = regUpdRes.rows[0]?.id || null;

      // 3. Annotate open checkout metadata without marking unpaid checkout as verified gateway revenue
      const payMetaRes = await client.query(
        `UPDATE payments
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('manual_activation', true, 'manual_activated_at', NOW())
         WHERE tenant_id = $1::uuid AND status IN ('PAYMENT_PENDING', 'PAYMENT_PROCESSING')
         RETURNING checkout_reference`,
        [dto.tenant_id],
      );
      const checkoutReference = payMetaRes.rows[0]?.checkout_reference || null;

      // 4. Record Audit Log
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
            subscription_id: subscriptionId,
            registration_id: registrationId,
            checkout_reference: checkoutReference,
          }),
        ]
      );

      await client.query('COMMIT');

      return {
        success: true,
        already_active: false,
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
