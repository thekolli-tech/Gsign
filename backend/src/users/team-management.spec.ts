import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersController } from './users.controller';
import { RolesController } from '../roles/roles.controller';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';

describe('Task 1: Company Admin & Employee Management + Hardening (Mocked Unit Tests)', () => {
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const adminId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const staffId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  it('rejects unauthorized users lacking team:manage permission via PermissionsGuard', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['team:manage']);
    const guard = new PermissionsGuard(reflector);

    const ctx: any = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: staffId, role: 'HR Manager', permissions: ['agreement:read'] },
        }),
      }),
    };

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects self-deactivation, self-reactivation, and self-role modification', async () => {
    const controller = new UsersController({} as any, {} as any);

    await expect(
      controller.updateMemberStatus(
        adminId,
        { status: 'Deactivated' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      controller.updateMemberStatus(
        adminId,
        { status: 'Active' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      controller.updateMemberRole(
        adminId,
        { role_name: 'HR Manager' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents cross-tenant user status or role modification (NotFoundException)', async () => {
    const mockClient = {
      query: jest
        .fn()
        // tenant lock
        .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
        // target lookup -> empty
        .mockResolvedValueOnce({ rows: [] })
        // second call tenant lock
        .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
        // second call target lookup -> empty
        .mockResolvedValueOnce({ rows: [] }),
    };
    const mockDb: any = {
      executeWithTenantContext: jest.fn((_tid: string, cb: any) => cb(mockClient)),
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'role-hr', name: 'HR Manager' }] }),
    };
    const controller = new UsersController(mockDb, { revokeUserTenantSessions: jest.fn() } as any);

    await expect(
      controller.updateMemberStatus(
        staffId,
        { status: 'Deactivated' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      controller.updateMemberRole(
        staffId,
        { role_name: 'HR Manager', department: 'HR' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('prevents Company Admin from assigning PLATFORM_OWNER or Super Admin roles', async () => {
    const controller = new UsersController({} as any, {} as any);

    await expect(
      controller.updateMemberRole(
        staffId,
        { role_name: 'PLATFORM_OWNER' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      controller.updateMemberRole(
        staffId,
        { role_name: 'Super Admin' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('locks tenant row FOR UPDATE before checking last active Company Admin on deactivation and demotion', async () => {
    const otherAdminId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const mockClient = {
      query: jest
        .fn()
        // 1. Tenant FOR UPDATE lock
        .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
        // 2. Target lookup
        .mockResolvedValueOnce({
          rows: [
            {
              membership_id: 'mem-1',
              membership_status: 'Active',
              role_id: 'role-admin',
              role_name: 'Company Admin',
              user_id: otherAdminId,
              email: 'admin2@a.com',
              full_name: 'Admin 2',
              is_super_admin: false,
              is_platform_owner: false,
            },
          ],
        })
        // 3. Remaining active admin count = 0
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }),
    };
    const mockDb: any = {
      executeWithTenantContext: jest.fn((_tid: string, cb: any) => cb(mockClient)),
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'role-hr', name: 'HR Manager' }] }),
    };
    const controller = new UsersController(mockDb, { revokeUserTenantSessions: jest.fn() } as any);

    await expect(
      controller.updateMemberStatus(
        otherAdminId,
        { status: 'Deactivated' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockClient.query.mock.calls[0][0]).toContain('SELECT id FROM tenants WHERE id = $1::uuid FOR UPDATE');

    // Demotion path
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
      .mockResolvedValueOnce({
        rows: [
          {
            membership_id: 'mem-1',
            membership_status: 'Active',
            role_id: 'role-admin',
            role_name: 'Company Admin',
            department: 'Executive',
            user_id: otherAdminId,
            email: 'admin2@a.com',
            full_name: 'Admin 2',
            is_super_admin: false,
            is_platform_owner: false,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    await expect(
      controller.updateMemberRole(
        otherAdminId,
        { role_name: 'HR Manager' },
        tenantA,
        { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
        { ip: '127.0.0.1' } as any,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockClient.query.mock.calls[0][0]).toContain('SELECT id FROM tenants WHERE id = $1::uuid FOR UPDATE');
  });

  it('deactivates member, revokes tenant sessions via SessionService, and allows reactivation', async () => {
    const mockClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
        .mockResolvedValueOnce({
          rows: [
            {
              membership_id: 'mem-2',
              membership_status: 'Active',
              role_id: 'role-hr',
              role_name: 'HR Manager',
              user_id: staffId,
              email: 'staff@a.com',
              full_name: 'Staff User',
              is_super_admin: false,
              is_platform_owner: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        // Reactivate
        .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
        .mockResolvedValueOnce({
          rows: [
            {
              membership_id: 'mem-2',
              membership_status: 'Inactive',
              role_id: 'role-hr',
              role_name: 'HR Manager',
              user_id: staffId,
              email: 'staff@a.com',
              full_name: 'Staff User',
              is_super_admin: false,
              is_platform_owner: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ plan_name: 'Business', max_users: 5 }] })
        .mockResolvedValueOnce({ rows: [{ active_users: 1, pending_invites: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    const mockDb: any = {
      executeWithTenantContext: jest.fn((_tid: string, cb: any) => cb(mockClient)),
    };
    const mockSessionSvc: any = {
      revokeUserTenantSessions: jest.fn().mockResolvedValue(2),
    };
    const controller = new UsersController(mockDb, mockSessionSvc);

    const deactRes = await controller.updateMemberStatus(
      staffId,
      { status: 'Deactivated' },
      tenantA,
      { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
      { ip: '127.0.0.1' } as any,
    );
    expect(deactRes.status).toBe('Deactivated');
    expect(deactRes.revoked_sessions).toBe(2);
    expect(mockSessionSvc.revokeUserTenantSessions).toHaveBeenCalledWith(staffId, tenantA);

    const reactRes = await controller.updateMemberStatus(
      staffId,
      { status: 'Active' },
      tenantA,
      { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
      { ip: '127.0.0.1' } as any,
    );
    expect(reactRes.status).toBe('Active');
  });

  it('updates member role, writes audit log, and immediately revokes PG + Redis sessions for that tenant', async () => {
    const mockClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
        .mockResolvedValueOnce({
          rows: [
            {
              membership_id: 'mem-2',
              membership_status: 'Active',
              role_id: 'role-sales',
              role_name: 'Sales Executive',
              department: 'Sales',
              user_id: staffId,
              email: 'staff@a.com',
              full_name: 'Staff User',
              is_super_admin: false,
              is_platform_owner: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const mockDb: any = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'role-legal', name: 'Legal Reviewer' }] }),
      executeWithTenantContext: jest.fn((_tid: string, cb: any) => cb(mockClient)),
    };
    const mockSessionSvc: any = {
      revokeUserTenantSessions: jest.fn().mockResolvedValue(1),
    };
    const controller = new UsersController(mockDb, mockSessionSvc);

    const res = await controller.updateMemberRole(
      staffId,
      { role_name: 'Legal Reviewer', department: 'Legal' },
      tenantA,
      { id: adminId, email: 'admin@a.com', role: 'Company Admin' },
      { ip: '127.0.0.1' } as any,
    );
    expect(res.role_name).toBe('Legal Reviewer');
    expect(res.revoked_sessions).toBe(1);
    expect(mockSessionSvc.revokeUserTenantSessions).toHaveBeenCalledWith(staffId, tenantA);
    expect(mockClient.query.mock.calls[3][0]).toContain('TEAM_MEMBER_ROLE_UPDATED');
  });

  it('SessionService.revokeUserTenantSessions revokes PG sessions, deletes Redis keys, and rejects old cookies', async () => {
    const mockDb: any = {
      executeAsSuperAdmin: jest
        .fn()
        .mockImplementationOnce(async (cb: any) =>
          cb({
            query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'sess-old-1' }] }),
          }),
        )
        .mockImplementationOnce(async (cb: any) =>
          cb({
            query: jest.fn().mockResolvedValueOnce({
              rows: [{ id: 'sess-old-1', revoked_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), is_active: true }],
            }),
          }),
        ),
    };
    const mockRedis: any = {
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
    };
    const svc = new SessionService(mockDb, mockRedis, {} as any, { get: () => 3600 } as any);

    const count = await svc.revokeUserTenantSessions(staffId, tenantA);
    expect(count).toBe(1);
    expect(mockRedis.del).toHaveBeenCalledWith(['session:sess-old-1']);

    const sessionAfter = await svc.getSession('sess-old-1');
    expect(sessionAfter).toBeNull();
  });

  it('blocks disabled existing user, enforces MFA, preserves existing password, and recovers if Redis session creation fails', async () => {
    const hashSpy = jest.fn();

    // 1. Disabled existing user
    const mockDbDisabled: any = {
      executeAsSuperAdmin: jest.fn().mockResolvedValueOnce({
        rows: [{ id: 'inv-d', tenant_id: tenantA, email: 'disabled@a.com', role_id: 'r1', department: 'HR', tenant_status: 'Active', tenant_deleted_at: null }],
      }),
      executeWithTenantContext: jest.fn((_tid: string, cb: any) =>
        cb({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
            .mockResolvedValueOnce({
              rows: [{ id: 'inv-d', tenant_id: tenantA, email: 'disabled@a.com', role_id: 'r1', department: 'HR', expires_at: new Date(Date.now() + 60_000).toISOString(), accepted_at: null }],
            })
            .mockResolvedValueOnce({ rows: [{ id: staffId, is_active: false }] }),
        }),
      ),
    };
    const authDisabled = new AuthService(mockDbDisabled, {} as any, { hashPassword: hashSpy } as any, {} as any, {} as any);
    await expect(
      authDisabled.acceptInvite({ token: 'c'.repeat(32), full_name: 'Disabled', password: 'StrongPassword123!' }),
    ).rejects.toThrow(ForbiddenException);
    expect(hashSpy).not.toHaveBeenCalled();

    // 2. Existing active user with MFA enabled -> does not overwrite password & returns mfa_required
    const mockRedisMfa: any = { setex: jest.fn().mockResolvedValue('OK') };
    const createSessionSpy = jest.fn();
    const mockDbMfa: any = {
      executeAsSuperAdmin: jest.fn().mockResolvedValueOnce({
        rows: [{ id: 'inv-m', tenant_id: tenantA, email: 'mfa@a.com', role_id: 'r1', department: 'HR', tenant_status: 'Active', tenant_deleted_at: null }],
      }),
      executeWithTenantContext: jest.fn((_tid: string, cb: any) =>
        cb({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
            .mockResolvedValueOnce({
              rows: [{ id: 'inv-m', tenant_id: tenantA, email: 'mfa@a.com', role_id: 'r1', department: 'HR', expires_at: new Date(Date.now() + 60_000).toISOString(), accepted_at: null }],
            })
            .mockResolvedValueOnce({ rows: [{ id: staffId, is_active: true }] })
            .mockResolvedValueOnce({ rows: [{ plan_name: 'Business', max_users: 5 }] })
            .mockResolvedValueOnce({ rows: [{ active_users: 1 }] })
            .mockResolvedValue({ rows: [] }),
        }),
      ),
      query: jest.fn().mockResolvedValueOnce({ rows: [{ is_enabled: true }] }),
    };
    const authMfa = new AuthService(
      mockDbMfa,
      mockRedisMfa,
      { hashPassword: hashSpy, generateToken: () => 'tok123' } as any,
      {} as any,
      { createSession: createSessionSpy } as any,
    );
    const mfaRes: any = await authMfa.acceptInvite({ token: 'd'.repeat(32), full_name: 'MFA User', password: 'NewAttemptedPassword1!' });
    expect(mfaRes.mfa_required).toBe(true);
    expect(mfaRes.mfa_token).toBe('mfa_tok_tok123');
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();

    // 3. Redis session creation failure after DB commit -> recoverable session_pending response
    const mockDbFailSess: any = {
      executeAsSuperAdmin: jest.fn().mockResolvedValueOnce({
        rows: [{ id: 'inv-s', tenant_id: tenantA, email: 'new@a.com', role_id: 'r1', department: 'HR', tenant_status: 'Active', tenant_deleted_at: null }],
      }),
      executeWithTenantContext: jest.fn((_tid: string, cb: any) =>
        cb({
          query: jest
            .fn()
            .mockResolvedValueOnce({ rows: [{ id: tenantA }] })
            .mockResolvedValueOnce({
              rows: [{ id: 'inv-s', tenant_id: tenantA, email: 'new@a.com', role_id: 'r1', department: 'HR', expires_at: new Date(Date.now() + 60_000).toISOString(), accepted_at: null }],
            })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: staffId }] })
            .mockResolvedValueOnce({ rows: [{ plan_name: 'Business', max_users: 5 }] })
            .mockResolvedValueOnce({ rows: [{ active_users: 1 }] })
            .mockResolvedValue({ rows: [] }),
        }),
      ),
    };
    const authFailSess = new AuthService(
      mockDbFailSess,
      {} as any,
      { hashPassword: jest.fn().mockResolvedValue('$argon2id$hash') } as any,
      {} as any,
      { createSession: jest.fn().mockRejectedValue(new Error('Redis down')) } as any,
    );
    const recRes: any = await authFailSess.acceptInvite({ token: 'e'.repeat(32), full_name: 'New User', password: 'StrongPassword123!' });
    expect(recRes.success).toBe(true);
    expect(recRes.session_pending).toBe(true);
    expect(recRes.session).toBeUndefined();
  });

  it('AuthController passes request.tenantId to inviteMember on both /invite and /team/invite', async () => {
    const inviteSpy = jest.fn().mockResolvedValue({ success: true, invitation_id: 'inv-1' });
    const authController = new AuthController(
      { inviteMember: inviteSpy } as any,
      { get: (_k: string, d?: any) => d } as any,
    );

    // Matches AuthGuard's request.user (which does NOT contain tenantId) + request.tenantId
    const guardUser = { id: adminId, email: 'admin@a.com', role: 'Company Admin', isPlatformOwner: false };
    const dto: any = { email: 'staff@a.com', role_name: 'HR Manager', department: 'HR' };

    await authController.inviteEmployee(guardUser, tenantA, dto);
    expect(inviteSpy).toHaveBeenCalledWith(expect.objectContaining({ id: adminId, tenantId: tenantA }), dto);

    await authController.inviteMember(guardUser, tenantA, dto);
    expect(inviteSpy).toHaveBeenLastCalledWith(expect.objectContaining({ id: adminId, tenantId: tenantA }), dto);
  });

  it('AuthService.inviteMember restricts role lookup to system roles or current tenant roles', async () => {
    const dbMock: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        expect(sql).toContain('is_system_role = true OR tenant_id = $2::uuid');
        expect(params).toEqual(['OtherTenantCustomRole', tenantA]);
        return { rows: [] };
      }),
    };
    const authSvc = new AuthService(dbMock, {} as any, {} as any, {} as any, {} as any);

    await expect(
      authSvc.inviteMember(
        { id: adminId, tenantId: tenantA, email: 'admin@a.com', role: 'Company Admin' },
        { email: 'new@a.com', role_name: 'OtherTenantCustomRole', department: 'Sales' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('SessionService hardens against Redis get/del failures, rejects stale cached revoked/expired sessions, and verifies valid sessions during Redis outage', async () => {
    const validRow = {
      id: 'sess-1',
      user_id: staffId,
      tenant_id: tenantA,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
      email: 'staff@a.com',
      full_name: 'Staff',
      is_super_admin: false,
      is_platform_owner: false,
      must_change_password: false,
      is_active: true,
      tenant_status: 'Active',
      tenant_deleted_at: null,
    };

    // 1. Stale cached session in Redis whose PG row is revoked -> rejected & purged
    const redisStale: any = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ sessionId: 'sess-1', userId: staffId })),
      del: jest.fn().mockResolvedValue(1),
    };
    const dbRevoked: any = {
      executeAsSuperAdmin: jest.fn(async (cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [{ ...validRow, revoked_at: new Date().toISOString() }] }) }),
      ),
    };
    const svcStale = new SessionService(dbRevoked, redisStale, {} as any, { get: () => 3600 } as any);
    expect(await svcStale.getSession('sess-1')).toBeNull();
    expect(redisStale.del).toHaveBeenCalledWith('session:sess-1');

    // 2. Expired PG session even if cached in Redis -> rejected
    const dbExpired: any = {
      executeAsSuperAdmin: jest.fn(async (cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [{ ...validRow, expires_at: new Date(Date.now() - 10_000).toISOString() }] }) }),
      ),
    };
    const svcExpired = new SessionService(dbExpired, redisStale, {} as any, { get: () => 3600 } as any);
    expect(await svcExpired.getSession('sess-1')).toBeNull();

    // 2b. Suspended tenant in PG even if cached in Redis -> rejected & purged
    const dbSuspended: any = {
      executeAsSuperAdmin: jest.fn(async (cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [{ ...validRow, tenant_status: 'Suspended' }] }) }),
      ),
    };
    const svcSuspended = new SessionService(dbSuspended, redisStale, {} as any, { get: () => 3600 } as any);
    expect(await svcSuspended.getSession('sess-1')).toBeNull();

    // 3. Redis get outage -> falls back to PG and verifies valid session
    const redisDown: any = {
      get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      setex: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      del: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const dbValid: any = {
      executeAsSuperAdmin: jest.fn(async (cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [validRow] }) }),
      ),
      executeWithTenantContext: jest.fn(async (_t: string, cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [{ role_name: 'HR Manager', code: 'agreement:read' }] }) }),
      ),
    };
    const svcOutage = new SessionService(dbValid, redisDown, {} as any, { get: () => 3600 } as any);
    const verified = await svcOutage.getSession('sess-1');
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(staffId);

    // 4. Redis del failure after PG revocation -> completes without throwing
    const dbRevokeOk: any = {
      executeAsSuperAdmin: jest.fn(async (cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [{ id: 'sess-1' }] }) }),
      ),
    };
    const svcRevoke = new SessionService(dbRevokeOk, redisDown, {} as any, { get: () => 3600 } as any);
    await expect(svcRevoke.revokeUserTenantSessions(staffId, tenantA)).resolves.toBe(1);
  });

  it('RolesController.getRoleById allows system/same-tenant roles and blocks cross-tenant custom role lookup', async () => {
    const roleId = '22222222-2222-2222-2222-222222222222';

    const dbTenant: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        expect(sql).toContain('(r.is_system_role = true OR r.tenant_id = $2::uuid)');
        expect(params).toEqual([roleId, tenantA]);
        return { rows: [{ id: roleId, name: 'Company Admin', is_system_role: true, permissions: [] }] };
      }),
    };
    const ctrlTenant = new RolesController(dbTenant);
    const found = await ctrlTenant.getRoleById(roleId, tenantA);
    expect(found.name).toBe('Company Admin');

    const dbCrossTenant: any = {
      query: jest.fn(async () => ({ rows: [] })),
    };
    const ctrlCross = new RolesController(dbCrossTenant);
    await expect(ctrlCross.getRoleById(roleId, tenantA)).rejects.toThrow(NotFoundException);

    const dbNoTenant: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        expect(sql).toContain('r.is_system_role = true');
        expect(sql).not.toContain('r.tenant_id = $2');
        expect(params).toEqual([roleId]);
        return { rows: [] };
      }),
    };
    const ctrlNoTenant = new RolesController(dbNoTenant);
    await expect(ctrlNoTenant.getRoleById(roleId, null)).rejects.toThrow(NotFoundException);
  });
});
