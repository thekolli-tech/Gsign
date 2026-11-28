import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../common/guards/auth.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { TenantsController } from './tenants.controller';

describe('PlatformAnalyticsService & PlatformOwnerGuard (Mocked DB)', () => {
  function makeMockDb(responses: Array<{ rows: any[] }>) {
    let idx = 0;
    const query = jest.fn(async () => responses[idx++] ?? { rows: [] });
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query })),
    } as any;
    return { db, query };
  }

  it('aggregates platform-wide metrics and separates actual collected payments from simulated payments', async () => {
    const { db, query } = makeMockDb([
      { rows: [{ total: 12, active: 9, suspended: 2, archived: 1 }] },
      { rows: [{ total: 48, active: 45 }] },
      { rows: [{ total: 120, draft: 10, pending: 25, completed: 75, rejected: 5, expired: 3, cancelled: 2 }] },
      {
        rows: [
          { plan_id: 'p1', plan_name: 'Starter Plan', plan_slug: 'starter', active_count: 5 },
          { plan_id: 'p2', plan_name: 'Growth Plan', plan_slug: 'growth', active_count: 4 },
        ],
      },
      {
        rows: [
          {
            collected_actual_inr: 49990,
            collected_actual_count: 2,
            simulated_inr: 19999,
            simulated_count: 1,
          },
        ],
      },
      {
        rows: [
          {
            total_bytes: 5242880,
            total_objects: 14,
            s3_bytes: 4194304,
            s3_objects: 10,
            local_private_bytes: 1048576,
            local_private_objects: 4,
          },
        ],
      },
      { rows: [{ date: '2026-11-26', created_count: 6, completed_count: 4 }] },
      { rows: [{ date: '2026-11-26', new_tenants: 2 }] },
    ]);

    const service = new PlatformAnalyticsService(db);
    const result = await service.getPlatformAnalytics({ days: '30' });

    expect(db.executeAsSuperAdmin).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(8);
    expect(result.tenants).toEqual({ total: 12, active: 9, suspended: 2, archived: 1 });
    expect(result.users).toEqual({ total: 48, active: 45 });
    expect(result.agreements).toEqual({
      total: 120,
      draft: 10,
      pending: 25,
      completed: 75,
      rejected: 5,
      expired: 3,
      cancelled: 2,
    });
    expect(result.subscriptionsByPlan).toHaveLength(2);
    expect(result.revenue).toEqual({
      currency: 'INR',
      collected_actual_inr: 49990,
      collected_actual_count: 2,
      simulated_inr: 19999,
      simulated_count: 1,
      has_actual_payments: true,
    });
    expect(result.storage.total_bytes).toBe(5242880);
    expect(result.trends.agreements).toEqual([
      { date: '2026-11-26', created_count: 6, completed_count: 4 },
    ]);
    expect(result.trends.tenants).toEqual([{ date: '2026-11-26', new_tenants: 2 }]);
  });

  it('handles empty datasets cleanly without inventing metrics', async () => {
    const { db } = makeMockDb([
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [] },
      { rows: [] },
    ]);

    const service = new PlatformAnalyticsService(db);
    const result = await service.getPlatformAnalytics({});

    expect(result.tenants).toEqual({ total: 0, active: 0, suspended: 0, archived: 0 });
    expect(result.users).toEqual({ total: 0, active: 0 });
    expect(result.agreements.total).toBe(0);
    expect(result.subscriptionsByPlan).toEqual([]);
    expect(result.revenue).toEqual({
      currency: 'INR',
      collected_actual_inr: 0,
      collected_actual_count: 0,
      simulated_inr: 0,
      simulated_count: 0,
      has_actual_payments: false,
    });
    expect(result.storage.total_bytes).toBe(0);
    expect(result.trends).toEqual({ agreements: [], tenants: [] });
  });

  it('validates date filters and rejects invalid or oversized ranges', () => {
    const { db } = makeMockDb([]);
    const service = new PlatformAnalyticsService(db);

    const valid = service.resolveDateRange('2026-11-01', '2026-11-15');
    expect(valid.fromDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(valid.toDate.toISOString()).toBe('2026-11-15T23:59:59.999Z');
    expect(valid.spanDays).toBe(15);

    expect(() => service.resolveDateRange('not-a-date', '2026-11-15')).toThrow(BadRequestException);
    expect(() => service.resolveDateRange('2026-11-20', '2026-11-10')).toThrow(BadRequestException);
    expect(() => service.resolveDateRange('2025-01-01', '2026-11-20')).toThrow(BadRequestException);
    expect(() => service.resolveDateRange(undefined, undefined, '400')).toThrow(BadRequestException);
  });

  it('restricts GET /tenants/platform/analytics exclusively to Platform Owner via AuthGuard & PlatformOwnerGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TenantsController.prototype.getPlatformAnalytics);
    expect(guards).toEqual([AuthGuard, PlatformOwnerGuard]);

    const guard = new PlatformOwnerGuard();
    const makeCtx = (user: any) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as unknown as ExecutionContext;

    expect(guard.canActivate(makeCtx({ isPlatformOwner: true, role: 'PLATFORM_OWNER' }))).toBe(true);
    expect(() => guard.canActivate(makeCtx({ isPlatformOwner: false, isSuperAdmin: true, role: 'SUPER_ADMIN' }))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(makeCtx({ isPlatformOwner: false, role: 'Company Admin' }))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(makeCtx(null))).toThrow(ForbiddenException);
  });
});
