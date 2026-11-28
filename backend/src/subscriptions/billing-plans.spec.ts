import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../common/guards/auth.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

describe('Task 2B: Billing History & Platform Owner Plan Management (Mocked Unit Tests)', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const planId = '22222222-2222-2222-2222-222222222222';
  const ownerActor = { id: '366e4b85-3c57-4ec0-a467-5955d243f614', email: 'genemaxitsolution@gmail.com', isPlatformOwner: true, role: 'PLATFORM_OWNER' };

  describe('Tenant isolation of invoices and payment history', () => {
    it('requires AuthGuard on GET /payments/invoices and GET /payments/history', () => {
      const invGuards = Reflect.getMetadata(GUARDS_METADATA, PaymentsController.prototype.getInvoices);
      const histGuards = Reflect.getMetadata(GUARDS_METADATA, PaymentsController.prototype.getPaymentHistory);
      expect(invGuards).toContain(AuthGuard);
      expect(histGuards).toContain(AuthGuard);
    });

    it('queries invoices and payment history strictly inside tenant RLS context without exposing metadata', async () => {
      const queries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
          if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1 }] };
          if (sql.includes('FROM payments p')) {
            return {
              rows: [
                {
                  id: 'pay-1',
                  amount: 1499,
                  currency: 'INR',
                  provider: 'SIMULATED',
                  provider_transaction_id: 'sim_123',
                  status: 'COMPLETED',
                  payment_method: 'SIMULATED_CARD',
                  is_simulated: true,
                  plan_name: 'Business Plan',
                  invoice_number: 'INV-001',
                },
              ],
            };
          }
          if (sql.includes('FROM invoices')) {
            return { rows: [{ id: 'inv-1', invoice_number: 'INV-001', amount: 1499, tax_amount: 269.82, total_amount: 1768.82, status: 'PAID' }] };
          }
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (tid: string, fn: any) => {
          expect(tid).toBe(tenantId);
          return fn(mockClient);
        }),
      };
      const svc = new PaymentsService(dbMock);

      const invoices = await svc.getInvoices(tenantId);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].invoice_number).toBe('INV-001');

      const history = await svc.getPaymentHistory(tenantId, 1, 20);
      expect(history.total).toBe(1);
      expect(history.items[0].is_simulated).toBe(true);
      expect(queries.some((q) => q.includes('p.metadata'))).toBe(false);
      expect(queries.some((q) => q.includes('WHERE p.tenant_id = $1::uuid'))).toBe(true);

      const emptyHist = await svc.getPaymentHistory('', 1, 20);
      expect(emptyHist.items).toEqual([]);
      expect(emptyHist.total).toBe(0);
    });
  });

  describe('Platform Owner-only plan updates', () => {
    it('guards GET /subscriptions/plans/manage and PATCH /subscriptions/plans/:id with AuthGuard + PlatformOwnerGuard', () => {
      const manageGuards = Reflect.getMetadata(GUARDS_METADATA, SubscriptionsController.prototype.getManageablePlans);
      const patchGuards = Reflect.getMetadata(GUARDS_METADATA, SubscriptionsController.prototype.updatePlan);
      expect(manageGuards).toEqual(expect.arrayContaining([AuthGuard, PlatformOwnerGuard]));
      expect(patchGuards).toEqual(expect.arrayContaining([AuthGuard, PlatformOwnerGuard]));
    });

    it('rejects non-Platform-Owner, invalid UUID, negative prices, and invalid negative limits other than -1', async () => {
      const svc = new SubscriptionsService({} as any);

      await expect(
        svc.updatePlan({ id: 'u1', isPlatformOwner: false, role: 'Company Admin' }, planId, { monthly_price: 999 }),
      ).rejects.toThrow(ForbiddenException);

      await expect(svc.updatePlan(ownerActor, 'not-a-uuid', { monthly_price: 999 })).rejects.toThrow(BadRequestException);
      await expect(svc.updatePlan(ownerActor, planId, { monthly_price: -10 })).rejects.toThrow(BadRequestException);
      await expect(svc.updatePlan(ownerActor, planId, { max_agreements_per_month: -2 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(svc.updatePlan(ownerActor, planId, { max_users: -5 })).rejects.toThrow(BadRequestException);
      await expect(svc.updatePlan(ownerActor, planId, {})).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when plan does not exist', async () => {
      const dbMock: any = {
        executeAsSuperAdmin: jest.fn(async (fn: any) =>
          fn({ query: jest.fn(async () => ({ rows: [] })) }),
        ),
      };
      const svc = new SubscriptionsService(dbMock);
      await expect(svc.updatePlan(ownerActor, planId, { monthly_price: 1999 })).rejects.toThrow(NotFoundException);
    });

    it('persists valid plan updates including -1 unlimited limits, preserves slug, and writes audit log', async () => {
      const queries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
          if (sql.includes('FROM subscription_plans')) {
            return {
              rows: [
                {
                  id: planId,
                  name: 'Business Plan',
                  slug: 'business',
                  description: 'Old',
                  monthly_price: 1499,
                  annual_price: 14990,
                  max_agreements_per_month: 100,
                  max_users: 5,
                  features: ['Custom branding'],
                  is_active: true,
                },
              ],
            };
          }
          if (sql.includes('UPDATE subscription_plans')) {
            return {
              rows: [
                {
                  id: planId,
                  name: 'Business Pro',
                  slug: 'business',
                  description: 'Updated',
                  monthly_price: 1999,
                  annual_price: 19990,
                  max_agreements_per_month: -1,
                  max_users: 10,
                  features: ['Custom branding', 'Priority SLA'],
                  is_active: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeAsSuperAdmin: jest.fn(async (fn: any) => fn(mockClient)),
      };
      const svc = new SubscriptionsService(dbMock);

      const updated = await svc.updatePlan(ownerActor, planId, {
        name: 'Business Pro',
        description: 'Updated',
        monthly_price: 1999,
        annual_price: 19990,
        max_agreements_per_month: -1,
        max_users: 10,
        features: ['Custom branding', 'Priority SLA'],
      });

      expect(updated.slug).toBe('business');
      expect(updated.max_agreements_per_month).toBe(-1);
      expect(updated.monthly_price).toBe(1999);
      expect(queries.some((q) => q.includes('SUBSCRIPTION_PLAN_UPDATED'))).toBe(true);
    });
  });
});
