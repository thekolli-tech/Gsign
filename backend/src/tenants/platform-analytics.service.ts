import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface PlatformAnalyticsResponse {
  range: {
    from: string;
    to: string;
    days: number;
  };
  tenants: {
    total: number;
    active: number;
    suspended: number;
    archived: number;
  };
  users: {
    total: number;
    active: number;
  };
  agreements: {
    total: number;
    draft: number;
    pending: number;
    completed: number;
    rejected: number;
    expired: number;
    cancelled: number;
  };
  subscriptionsByPlan: Array<{
    plan_id: string;
    plan_name: string;
    plan_slug: string;
    active_count: number;
  }>;
  revenue: {
    currency: 'INR';
    collected_actual_inr: number;
    collected_actual_count: number;
    simulated_inr: number;
    simulated_count: number;
    has_actual_payments: boolean;
  };
  storage: {
    total_bytes: number;
    total_objects: number;
    s3_bytes: number;
    s3_objects: number;
    local_private_bytes: number;
    local_private_objects: number;
  };
  trends: {
    agreements: Array<{ date: string; created_count: number; completed_count: number }>;
    tenants: Array<{ date: string; new_tenants: number }>;
  };
}

@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly db: DatabaseService) {}

  resolveDateRange(from?: string, to?: string, days?: string): { fromDate: Date; toDate: Date; spanDays: number } {
    const now = new Date();
    let toDate = to ? new Date(to) : new Date(now);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to.trim())) {
      toDate = new Date(`${to.trim()}T23:59:59.999Z`);
    }
    if (Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid "to" date parameter.');
    }

    let fromDate: Date;
    if (from) {
      fromDate = /^\d{4}-\d{2}-\d{2}$/.test(from.trim())
        ? new Date(`${from.trim()}T00:00:00.000Z`)
        : new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('Invalid "from" date parameter.');
      }
    } else {
      const parsedDays = days !== undefined ? Number.parseInt(days, 10) : 30;
      if (!Number.isFinite(parsedDays) || parsedDays < 1 || parsedDays > 366) {
        throw new BadRequestException('Parameter "days" must be an integer between 1 and 366.');
      }
      fromDate = new Date(toDate.getTime() - parsedDays * 24 * 60 * 60 * 1000);
    }

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('"from" date must be earlier than or equal to "to" date.');
    }

    const spanDays = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)));
    if (spanDays > 366) {
      throw new BadRequestException('Date range cannot exceed 366 days.');
    }

    return { fromDate, toDate, spanDays };
  }

  async getPlatformAnalytics(params: {
    from?: string;
    to?: string;
    days?: string;
  }): Promise<PlatformAnalyticsResponse> {
    const { fromDate, toDate, spanDays } = this.resolveDateRange(params.from, params.to, params.days);
    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    return this.db.executeAsSuperAdmin(async (client) => {
      const [tenantRes, userRes, agreementRes, planRes, revenueRes, storageRes, agreementTrendRes, tenantTrendRes] =
        await Promise.all([
          client.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'Active' AND deleted_at IS NULL)::int AS active,
               COUNT(*) FILTER (WHERE status = 'Suspended' AND deleted_at IS NULL)::int AS suspended,
               COUNT(*) FILTER (WHERE status = 'Archived' OR deleted_at IS NOT NULL)::int AS archived
             FROM tenants`,
          ),
          client.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE is_active = true)::int AS active
             FROM users`,
          ),
          client.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'Draft')::int AS draft,
               COUNT(*) FILTER (WHERE status IN ('Awaiting OTP', 'Awaiting signature', 'Partially signed', 'Finalizing'))::int AS pending,
               COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed,
               COUNT(*) FILTER (WHERE status = 'Rejected')::int AS rejected,
               COUNT(*) FILTER (WHERE status = 'Expired')::int AS expired,
               COUNT(*) FILTER (WHERE status = 'Cancelled')::int AS cancelled
             FROM agreements
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
            [fromIso, toIso],
          ),
          client.query(
            `SELECT
               sp.id AS plan_id,
               sp.name AS plan_name,
               sp.slug AS plan_slug,
               COUNT(ts.id) FILTER (WHERE ts.status = 'ACTIVE')::int AS active_count
             FROM subscription_plans sp
             LEFT JOIN tenant_subscriptions ts ON ts.plan_id = sp.id
             GROUP BY sp.id, sp.name, sp.slug, sp.monthly_price
             ORDER BY sp.monthly_price ASC`,
          ),
          client.query(
            `SELECT
               COALESCE(SUM(amount) FILTER (WHERE status IN ('COMPLETED', 'PAYMENT_COMPLETED') AND provider <> 'SIMULATED'), 0)::float8 AS collected_actual_inr,
               COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PAYMENT_COMPLETED') AND provider <> 'SIMULATED')::int AS collected_actual_count,
               COALESCE(SUM(amount) FILTER (WHERE status IN ('COMPLETED', 'PAYMENT_COMPLETED') AND provider = 'SIMULATED'), 0)::float8 AS simulated_inr,
               COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PAYMENT_COMPLETED') AND provider = 'SIMULATED')::int AS simulated_count
             FROM payments
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
            [fromIso, toIso],
          ),
          client.query(
            `SELECT
               COALESCE(SUM(byte_size), 0)::float8 AS total_bytes,
               COUNT(*)::int AS total_objects,
               COALESCE(SUM(byte_size) FILTER (WHERE storage_provider = 's3'), 0)::float8 AS s3_bytes,
               COUNT(*) FILTER (WHERE storage_provider = 's3')::int AS s3_objects,
               COALESCE(SUM(byte_size) FILTER (WHERE storage_provider = 'local_private'), 0)::float8 AS local_private_bytes,
               COUNT(*) FILTER (WHERE storage_provider = 'local_private')::int AS local_private_objects
             FROM document_versions`,
          ),
          client.query(
            `SELECT
               TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS created_count,
               COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed_count
             FROM agreements
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
             GROUP BY 1
             ORDER BY 1 ASC`,
            [fromIso, toIso],
          ),
          client.query(
            `SELECT
               TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS new_tenants
             FROM tenants
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
             GROUP BY 1
             ORDER BY 1 ASC`,
            [fromIso, toIso],
          ),
        ]);

      const tRow = tenantRes.rows[0] || {};
      const uRow = userRes.rows[0] || {};
      const aRow = agreementRes.rows[0] || {};
      const rRow = revenueRes.rows[0] || {};
      const sRow = storageRes.rows[0] || {};

      const collectedActualCount = Number(rRow.collected_actual_count || 0);

      return {
        range: {
          from: fromIso,
          to: toIso,
          days: spanDays,
        },
        tenants: {
          total: Number(tRow.total || 0),
          active: Number(tRow.active || 0),
          suspended: Number(tRow.suspended || 0),
          archived: Number(tRow.archived || 0),
        },
        users: {
          total: Number(uRow.total || 0),
          active: Number(uRow.active || 0),
        },
        agreements: {
          total: Number(aRow.total || 0),
          draft: Number(aRow.draft || 0),
          pending: Number(aRow.pending || 0),
          completed: Number(aRow.completed || 0),
          rejected: Number(aRow.rejected || 0),
          expired: Number(aRow.expired || 0),
          cancelled: Number(aRow.cancelled || 0),
        },
        subscriptionsByPlan: planRes.rows.map((p) => ({
          plan_id: p.plan_id,
          plan_name: p.plan_name,
          plan_slug: p.plan_slug,
          active_count: Number(p.active_count || 0),
        })),
        revenue: {
          currency: 'INR',
          collected_actual_inr: Number(rRow.collected_actual_inr || 0),
          collected_actual_count: collectedActualCount,
          simulated_inr: Number(rRow.simulated_inr || 0),
          simulated_count: Number(rRow.simulated_count || 0),
          has_actual_payments: collectedActualCount > 0,
        },
        storage: {
          total_bytes: Number(sRow.total_bytes || 0),
          total_objects: Number(sRow.total_objects || 0),
          s3_bytes: Number(sRow.s3_bytes || 0),
          s3_objects: Number(sRow.s3_objects || 0),
          local_private_bytes: Number(sRow.local_private_bytes || 0),
          local_private_objects: Number(sRow.local_private_objects || 0),
        },
        trends: {
          agreements: agreementTrendRes.rows.map((r) => ({
            date: r.date,
            created_count: Number(r.created_count || 0),
            completed_count: Number(r.completed_count || 0),
          })),
          tenants: tenantTrendRes.rows.map((r) => ({
            date: r.date,
            new_tenants: Number(r.new_tenants || 0),
          })),
        },
      };
    });
  }
}
