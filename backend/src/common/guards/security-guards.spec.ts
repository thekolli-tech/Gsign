import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { PermissionsGuard } from './permissions.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { SessionService, ActiveSession } from '../../auth/session.service';

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
});
