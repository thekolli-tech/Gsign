import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../database/database.service';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';

export const SKIP_SUBSCRIPTION_KEY = 'skipSubscriptionCheck';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const skipSubscription = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipSubscription) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.tenantId || request.session?.tenantId;

    if (!user) {
      throw new ForbiddenException('Unauthenticated request');
    }

    // RULE 1: Platform Owner and Super Admin NEVER require a subscription and are NEVER blocked
    if (user.isPlatformOwner || user.isSuperAdmin || user.role === 'PLATFORM_OWNER') {
      return true;
    }

    // If user has no tenant attached, subscription check cannot be evaluated here
    if (!tenantId) {
      return true;
    }

    // Query active subscription & tenant status within RLS tenant context
    const subRes = await this.db.executeWithTenantContext(tenantId, async (client) => {
      return client.query(
        `SELECT ts.id, ts.status, ts.current_period_start, ts.current_period_end, ts.grace_period_end,
                p.name as plan_name, t.status as tenant_status, (to_jsonb(t)->>'deleted_at') as tenant_deleted_at
         FROM tenant_subscriptions ts
         JOIN tenants t ON ts.tenant_id = t.id
         JOIN subscription_plans p ON ts.plan_id = p.id
         WHERE ts.tenant_id = $1`,
        [tenantId]
      );
    });

    if (subRes.rows.length === 0) {
      throw new ForbiddenException(
        'Workspace access blocked: No subscription record found. GSIGN requires an active paid subscription plan (No free trials permitted).'
      );
    }

    const sub = subRes.rows[0];
    if (sub.tenant_deleted_at || sub.tenant_status === 'Archived') {
      throw new ForbiddenException(
        'Workspace access blocked: This company workspace has been archived.'
      );
    }
    const now = new Date();

    switch (sub.status) {
      case 'ACTIVE': {
        if (sub.current_period_end && new Date(sub.current_period_end) < now) {
          // Check grace period
          if (sub.grace_period_end && new Date(sub.grace_period_end) > now) {
            // Within grace period
            return true;
          }
          // Mark subscription EXPIRED so status reflects reality and deny access immediately
          await this.db.executeWithTenantContext(tenantId, async (client) => {
            await client.query(
              `UPDATE tenant_subscriptions SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
              [sub.id],
            );
          });
          // Expired
          throw new ForbiddenException(
            'Paid workspace access blocked: Your company subscription has expired. Please renew your subscription.'
          );
        }
        return true;
      }
      case 'PENDING':
      case 'PAYMENT_PENDING':
        throw new ForbiddenException(
          'Paid workspace access blocked: Company registration is awaiting payment verification.'
        );
      case 'PAST_DUE': {
        if (sub.grace_period_end && new Date(sub.grace_period_end) > now) {
          return true;
        }
        throw new ForbiddenException(
          'Paid workspace access blocked: Subscription payment is overdue and grace period has lapsed.'
        );
      }
      case 'SUSPENDED':
        throw new ForbiddenException(
          'Workspace access blocked: Company workspace has been suspended by platform administration.'
        );
      case 'EXPIRED':
        throw new ForbiddenException(
          'Paid workspace access blocked: Company subscription has expired. Please renew to regain access.'
        );
      case 'CANCELLED': {
        if (sub.current_period_end && new Date(sub.current_period_end) > now) {
          return true; // Still within pre-paid period
        }
        throw new ForbiddenException(
          'Workspace access blocked: Subscription was cancelled and the billing period has concluded.'
        );
      }
      default:
        throw new ForbiddenException(
          `Workspace access blocked: Subscription status is '${sub.status}'. Paid subscription required.`
        );
    }
  }
}
