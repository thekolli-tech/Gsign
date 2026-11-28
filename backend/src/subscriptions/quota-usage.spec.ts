import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../common/guards/auth.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { SubscriptionsService } from './subscriptions.service';
import { AgreementsService } from '../agreements/agreements.service';
import { AuthService } from '../auth/auth.service';
import { UsersController } from '../users/users.controller';

describe('Task 2A: Usage Tracking, Quota Enforcement & Checkout Security (Mocked Unit Tests)', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const targetUserId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  describe('Checkout security', () => {
    it('requires AuthGuard and PlatformOwnerGuard on POST /payments/simulate-checkout', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, PaymentsController.prototype.simulateCheckout);
      expect(guards).toBeDefined();
      expect(guards).toContain(AuthGuard);
      expect(guards).toContain(PlatformOwnerGuard);
    });

    it('blocks simulateCheckout in production and Vercel environments', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origVercel = process.env.VERCEL;
      const svc = new PaymentsService({} as any);

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.VERCEL;
        await expect(
          svc.simulateCheckout({ tenant_id: tenantId, plan_id: 'plan-1', billing_cycle: 'monthly' } as any),
        ).rejects.toThrow(ForbiddenException);

        process.env.NODE_ENV = 'development';
        process.env.VERCEL = '1';
        await expect(
          svc.simulateCheckout({ tenant_id: tenantId, plan_id: 'plan-1', billing_cycle: 'monthly' } as any),
        ).rejects.toThrow(ForbiddenException);
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        if (origVercel === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = origVercel;
      }
    });
  });

  describe('Agreement monthly quota enforcement', () => {
    const baseDto: any = {
      title: 'NDA',
      recipient_name: 'Alice',
      recipient_email: 'alice@example.com',
      template_type: 'NDA',
      department: 'Legal',
      content: 'Agreement body',
      status: 'Pending',
    };

    it('rejects agreement creation when monthly quota is exhausted', async () => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM tenants WHERE id')) return { rows: [{ id: tenantId }] };
          if (sql.includes('FROM tenant_subscriptions')) {
            return { rows: [{ plan_name: 'Starter', max_agreements_per_month: 25 }] };
          }
          if (sql.includes('INSERT INTO usage_records')) return { rows: [] };
          if (sql.includes('FROM usage_records ur')) {
            return { rows: [{ recorded_created: 25, actual_created: 25 }] };
          }
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const svc = new AgreementsService(dbMock);

      await expect(
        svc.createAgreement(tenantId, { id: adminId, email: 'admin@a.com', isPlatformOwner: false }, baseDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows agreement creation and increments usage_records when under quota', async () => {
      const queries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
          if (sql.includes('FROM tenants WHERE id')) return { rows: [{ id: tenantId }] };
          if (sql.includes('FROM tenant_subscriptions')) {
            return { rows: [{ plan_name: 'Starter', max_agreements_per_month: 25 }] };
          }
          if (sql.includes('FROM usage_records ur')) {
            return { rows: [{ recorded_created: 10, actual_created: 10 }] };
          }
          if (sql.includes('SELECT COUNT(*)::int as cnt FROM agreements')) {
            return { rows: [{ cnt: 10 }] };
          }
          if (sql.includes('INSERT INTO agreements')) {
            return { rows: [{ id: 'ag-1', agreement_number: 'GS-2026-0011', status: 'Pending' }] };
          }
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const svc = new AgreementsService(dbMock);

      const created = await svc.createAgreement(
        tenantId,
        { id: adminId, email: 'admin@a.com', fullName: 'Admin', isPlatformOwner: false },
        baseDto,
      );

      expect(created.id).toBe('GS-2026-0011');
      expect(queries.some((q) => q.includes('agreements_created = usage_records.agreements_created + 1'))).toBe(true);
    });

    it('exempts Platform Owner from agreement quota limits', async () => {
      const queries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
          if (sql.includes('SELECT COUNT(*)::int as cnt FROM agreements')) return { rows: [{ cnt: 999 }] };
          if (sql.includes('INSERT INTO agreements')) {
            return { rows: [{ id: 'ag-po', agreement_number: 'GS-2026-1000', status: 'Pending' }] };
          }
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const svc = new AgreementsService(dbMock);

      const created = await svc.createAgreement(
        tenantId,
        { id: adminId, email: 'owner@gsign.in', isPlatformOwner: true },
        baseDto,
      );

      expect(created.id).toBe('GS-2026-1000');
      expect(queries.some((q) => q.includes('FROM tenant_subscriptions'))).toBe(false);
    });
  });

  describe('Seat quota enforcement (max_users)', () => {
    it('blocks inviteMember when active users + pending invitations reach max_users', async () => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM tenants t')) return { rows: [{ name: 'Acme', status: 'Active', deleted_at: null }] };
          if (sql.includes('FROM tenant_subscriptions')) return { rows: [{ plan_name: 'Starter', max_users: 2 }] };
          if (sql.includes('AS active_users')) return { rows: [{ active_users: 1, pending_invites: 1 }] };
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM roles')) return { rows: [{ id: 'role-1', name: 'HR Manager' }] };
          return { rows: [] };
        }),
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const authSvc = new AuthService(
        dbMock,
        { hashOpaqueToken: jest.fn(() => 'hash') } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await expect(
        authSvc.inviteMember(
          { id: adminId, tenantId, email: 'admin@a.com', role: 'Company Admin', isPlatformOwner: false },
          { email: 'new@a.com', role_name: 'HR Manager', department: 'HR' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects inviteMember when the invitee email is already an active member of the workspace', async () => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM tenants t')) return { rows: [{ name: 'Acme', status: 'Active', deleted_at: null }] };
          if (sql.includes('FROM tenant_memberships tm')) return { rows: [{ id: 'mem-existing' }] };
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM roles')) return { rows: [{ id: 'role-1', name: 'HR Manager' }] };
          return { rows: [] };
        }),
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const authSvc = new AuthService(
        dbMock,
        { hashOpaqueToken: jest.fn(() => 'hash') } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await expect(
        authSvc.inviteMember(
          { id: adminId, tenantId, email: 'admin@a.com', role: 'Company Admin', isPlatformOwner: false },
          { email: 'active@a.com', role_name: 'HR Manager', department: 'HR' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks acceptInvite when active workspace seats already reached max_users', async () => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM invitations')) {
            return {
              rows: [
                {
                  id: 'inv-1',
                  tenant_id: tenantId,
                  email: 'new@a.com',
                  role_id: 'role-1',
                  department: 'HR',
                  expires_at: new Date(Date.now() + 3600_000),
                  accepted_at: null,
                },
              ],
            };
          }
          if (sql.includes('SELECT id, is_active FROM users')) return { rows: [{ id: targetUserId, is_active: true }] };
          if (sql.includes('FROM tenant_subscriptions')) return { rows: [{ plan_name: 'Starter', max_users: 2 }] };
          if (sql.includes('AS active_users')) return { rows: [{ active_users: 2 }] };
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeAsSuperAdmin: jest.fn(async () => ({
          rows: [{ id: 'inv-1', tenant_id: tenantId, tenant_status: 'Active', tenant_deleted_at: null }],
        })),
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const authSvc = new AuthService(
        dbMock,
        { hashOpaqueToken: jest.fn(() => 'hash') } as any,
        {} as any,
        {} as any,
        {} as any,
      );

      await expect(
        authSvc.acceptInvite({ token: 'raw-token', full_name: 'New User', password: 'Password123!' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks reactivating an Inactive member when seat quota is full', async () => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM tenant_memberships tm')) {
            return {
              rows: [
                {
                  membership_id: 'mem-1',
                  membership_status: 'Inactive',
                  role_id: 'role-1',
                  role_name: 'HR Manager',
                  user_id: targetUserId,
                  email: 'staff@a.com',
                  full_name: 'Staff',
                  is_super_admin: false,
                  is_platform_owner: false,
                },
              ],
            };
          }
          if (sql.includes('FROM tenant_subscriptions')) return { rows: [{ plan_name: 'Starter', max_users: 2 }] };
          if (sql.includes('AS active_users')) return { rows: [{ active_users: 2, pending_invites: 0 }] };
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const controller = new UsersController(dbMock, { revokeAllTenantSessionsForUser: jest.fn() } as any);

      await expect(
        controller.updateMemberStatus(
          targetUserId,
          { status: 'Active' },
          tenantId,
          { id: adminId, email: 'admin@a.com', role: 'Company Admin', isPlatformOwner: false },
          { ip: '127.0.0.1' } as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Live usage & Platform Owner exemption', () => {
    it('returns exempt response for Platform Owner without tenant context', async () => {
      const svc = new SubscriptionsService({} as any);
      const res: any = await svc.getCurrentUsage(null, { isPlatformOwner: true, role: 'PLATFORM_OWNER' });
      expect(res.exempt_from_quotas).toBe(true);
      expect(res.is_platform_owner).toBe(true);
    });

    it('throws BadRequestException for non-owner without tenant context', async () => {
      const svc = new SubscriptionsService({} as any);
      await expect(svc.getCurrentUsage(null, { isPlatformOwner: false, role: 'Company Admin' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns reconciled UTC usage with null storage_allowance_bytes and null remaining for -1', async () => {
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          if (sql.includes('FROM tenant_subscriptions')) {
            return {
              rows: [
                {
                  id: 'sub-1',
                  tenant_id: tenantId,
                  billing_cycle: 'monthly',
                  status: 'active',
                  current_period_start: '2026-11-01',
                  current_period_end: '2026-12-01',
                  plan_name: 'Enterprise',
                  plan_slug: 'enterprise',
                  monthly_price: 0,
                  annual_price: 0,
                  max_agreements_per_month: -1,
                  max_users: 15,
                },
              ],
            };
          }
          if (sql.includes('AS period_start')) return { rows: [{ period_start: '2026-11-01', period_end: '2026-11-30' }] };
          if (sql.includes('FROM usage_records')) {
            return { rows: [{ agreements_created: 12, agreements_completed: 5 }] };
          }
          if (sql.includes('FROM document_versions dv')) {
            return { rows: [{ retained_bytes: 204800 }] };
          }
          if (sql.includes('FROM agreements')) return { rows: [{ created_cnt: 14, completed_cnt: 6 }] };
          if (sql.includes('FROM tenant_memberships')) return { rows: [{ active_users: 4 }] };
          if (sql.includes('FROM invitations')) return { rows: [{ pending_invitations: 2 }] };
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (_t: string, fn: any) => fn(mockClient)),
      };
      const svc = new SubscriptionsService(dbMock);

      const res: any = await svc.getCurrentUsage(tenantId, { isPlatformOwner: false });
      expect(res.has_subscription).toBe(true);
      expect(res.agreements_created).toBe(14);
      expect(res.agreements_completed).toBe(6);
      expect(res.remaining_agreements).toBeNull();
      expect(res.active_users).toBe(4);
      expect(res.pending_invitations).toBe(2);
      expect(res.remaining_users).toBe(9);
      expect(res.storage_bytes_used).toBe(204800);
      expect(res.storage_allowance_bytes).toBeNull();
    });
  });
});
