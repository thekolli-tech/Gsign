import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { PermissionsGuard } from './permissions.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { SessionService, ActiveSession } from '../../auth/session.service';
import { DatabaseService } from '../../database/database.service';
import { TemplatesService } from '../../templates/templates.service';

describe('Security Guards & RBAC Enforcement (Milestone 1)', () => {
  let reflector: Reflector;
  let sessionService: jest.Mocked<SessionService>;
  let authGuard: AuthGuard;
  let rolesGuard: RolesGuard;
  let permissionsGuard: PermissionsGuard;
  let superAdminGuard: SuperAdminGuard;

  beforeEach(() => {
    reflector = new Reflector();
    sessionService = {
      getSession: jest.fn(),
    } as any;

    authGuard = new AuthGuard(reflector, sessionService);
    rolesGuard = new RolesGuard(reflector);
    permissionsGuard = new PermissionsGuard(reflector);
    superAdminGuard = new SuperAdminGuard();
  });

  function createMockContext(request: any, handlerMetadata: any = {}): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => handlerMetadata.handler || (() => {}),
      getClass: () => handlerMetadata.class || class {},
    } as any;
  }

  // TEST 9: Unauthorized API Access
  describe('Requirement 9: Unauthorized API Access Rejection', () => {
    it('Should reject requests with missing session token', async () => {
      const context = createMockContext({ cookies: {}, headers: {} });
      await expect(authGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('Should reject requests with invalid or expired session token', async () => {
      sessionService.getSession.mockResolvedValue(null);
      const context = createMockContext({
        headers: { authorization: 'Bearer invalid_or_expired_session_token' },
      });
      await expect(authGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('Should grant access and attach user context when valid session cookie is provided', async () => {
      const mockSession: ActiveSession = {
        sessionId: 'valid_sess_123',
        userId: 'u-1',
        email: 'user@gsign.in',
        fullName: 'Test User',
        isSuperAdmin: false,
        isPlatformOwner: false,
        mustChangePassword: false,
        tenantId: 't-1',
        role: 'Company Admin',
        permissions: ['agreement:create'],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      sessionService.getSession.mockResolvedValue(mockSession);

      const req: any = {
        cookies: { gsign_session: 'valid_sess_123' },
        headers: {},
      };
      const context = createMockContext(req);

      const result = await authGuard.canActivate(context);
      expect(result).toBe(true);
      expect(req.user.id).toBe('u-1');
      expect(req.tenantId).toBe('t-1');
    });
  });

  // TEST 10: Role and Permission Enforcement
  describe('Requirement 10: Role and Permission Enforcement', () => {
    it('RolesGuard: Should allow user with matching role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Company Admin']);

      const context = createMockContext({
        user: { id: 'u-1', isSuperAdmin: false },
        session: { role: 'Company Admin' },
      });

      expect(rolesGuard.canActivate(context)).toBe(true);
    });

    it('RolesGuard: Should reject user without required role', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Company Admin']);

      const context = createMockContext({
        user: { id: 'u-2', isSuperAdmin: false },
        session: { role: 'Sales Executive' },
      });

      expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('PermissionsGuard: Should allow user with all required permissions', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['agreement:create', 'receipt:issue']);

      const context = createMockContext({
        user: { id: 'u-1', isSuperAdmin: false },
        session: { permissions: ['agreement:create', 'receipt:issue', 'team:invite'] },
      });

      expect(permissionsGuard.canActivate(context)).toBe(true);
    });

    it('PermissionsGuard: Should reject user missing a required permission', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['receipt:issue']);

      const context = createMockContext({
        user: { id: 'u-1', isSuperAdmin: false },
        session: { permissions: ['agreement:create', 'agreement:read'] },
      });

      expect(() => permissionsGuard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('SuperAdminGuard: Should allow Super Admin to access root routes', () => {
      const context = createMockContext({
        user: { id: 'super-1', isSuperAdmin: true },
      });

      expect(superAdminGuard.canActivate(context)).toBe(true);
    });

    it('SuperAdminGuard: Should reject standard tenant admins from root routes', () => {
      const context = createMockContext({
        user: { id: 'user-1', isSuperAdmin: false },
      });

      expect(() => superAdminGuard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('DatabaseService transaction-local context & no-runtime-DDL readiness', () => {
    it('executeWithTenantContext uses transaction-local set_config and rolls back on error', async () => {
      const queries: Array<{ sql: string; params?: any[] }> = [];
      const mockClient = {
        query: jest.fn(async (sql: string, params?: any[]) => {
          queries.push({ sql, params });
          return { rows: [] };
        }),
        release: jest.fn(),
      };
      const db = new DatabaseService({ get: () => undefined } as any);
      (db as any).pool = { connect: jest.fn().mockResolvedValue(mockClient) };

      await expect(
        db.executeWithTenantContext('11111111-1111-1111-1111-111111111111', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(queries[0].sql).toBe('BEGIN');
      expect(queries[1].sql).toContain("set_config('app.current_tenant_id', $1, true)");
      expect(queries[2].sql).toContain("set_config('app.is_super_admin', 'false', true)");
      expect(queries[3].sql).toBe('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('executeAsSuperAdmin uses transaction-local set_config and commits on success', async () => {
      const queries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
          return { rows: [] };
        }),
        release: jest.fn(),
      };
      const db = new DatabaseService({ get: () => undefined } as any);
      (db as any).pool = { connect: jest.fn().mockResolvedValue(mockClient) };

      await db.executeAsSuperAdmin(async (client) => client.query('SELECT 1'));

      expect(queries).toEqual([
        'BEGIN',
        "SELECT set_config('app.is_super_admin', 'true', true)",
        "SELECT set_config('app.current_tenant_id', '', true)",
        'SELECT 1',
        'COMMIT',
      ]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('TemplatesService.listTemplates does not execute runtime DDL', async () => {
      const executedSql: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          executedSql.push(sql);
          return { rows: [] };
        }),
      };
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (_t: string, cb: any) => cb(mockClient)),
      };
      const svc = new TemplatesService(dbMock);
      await svc.listTemplates('11111111-1111-1111-1111-111111111111', false, { isSuperAdmin: false });

      const joined = executedSql.join('\n');
      expect(joined).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP POLICY|CREATE POLICY/i);
    });
  });
});
