import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService — Env-Configured Account Auto-Bootstrap', () => {
  const prevOwnerEmail = process.env.GSIGN_OWNER_EMAIL;
  const prevOwnerPass = process.env.GSIGN_OWNER_INITIAL_PASSWORD;
  const prevEmail = process.env.GSIGN_TEAM_ADMIN_EMAIL;
  const prevPass = process.env.GSIGN_TEAM_ADMIN_PASSWORD;
  const prevCompEmail = process.env.GSIGN_COMPANY_ADMIN_EMAIL;
  const prevCompPass = process.env.GSIGN_COMPANY_ADMIN_PASSWORD;

  afterEach(() => {
    if (prevOwnerEmail === undefined) delete process.env.GSIGN_OWNER_EMAIL;
    else process.env.GSIGN_OWNER_EMAIL = prevOwnerEmail;
    if (prevOwnerPass === undefined) delete process.env.GSIGN_OWNER_INITIAL_PASSWORD;
    else process.env.GSIGN_OWNER_INITIAL_PASSWORD = prevOwnerPass;
    if (prevEmail === undefined) delete process.env.GSIGN_TEAM_ADMIN_EMAIL;
    else process.env.GSIGN_TEAM_ADMIN_EMAIL = prevEmail;
    if (prevPass === undefined) delete process.env.GSIGN_TEAM_ADMIN_PASSWORD;
    else process.env.GSIGN_TEAM_ADMIN_PASSWORD = prevPass;
    if (prevCompEmail === undefined) delete process.env.GSIGN_COMPANY_ADMIN_EMAIL;
    else process.env.GSIGN_COMPANY_ADMIN_EMAIL = prevCompEmail;
    if (prevCompPass === undefined) delete process.env.GSIGN_COMPANY_ADMIN_PASSWORD;
    else process.env.GSIGN_COMPANY_ADMIN_PASSWORD = prevCompPass;
  });

  it('auto-provisions Platform Owner (GSIGN_OWNER_EMAIL) with super admin dashboard access', async () => {
    process.env.GSIGN_OWNER_EMAIL = 'genemaxitsolution@gmail.com';
    process.env.GSIGN_OWNER_INITIAL_PASSWORD = 'OwnerPassword@2026';

    let seededUser: any = null;
    const dbMock: any = {
      query: jest.fn(async () => ({ rows: seededUser ? [seededUser] : [] })),
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string, vals: any[]) => {
            if (sql.includes('INSERT INTO users')) {
              seededUser = {
                id: 'user-owner-1',
                email: vals[0],
                password_hash: vals[1],
                full_name: 'Genemax Platform Owner',
                is_super_admin: true,
                is_active: true,
              };
              return { rows: [{ id: 'user-owner-1' }] };
            }
            return { rows: [] };
          }),
        }),
      ),
    };
    const redisMock: any = { get: jest.fn(async () => null), incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
    const cryptoMock: any = {
      hashPassword: jest.fn(async (p: string) => `hashed:${p}`),
      verifyPassword: jest.fn(async (p: string, h: string) => h === `hashed:${p}`),
    };
    const mfaMock: any = { hasMfaEnabled: jest.fn(async () => false) };
    const sessionMock: any = {
      createSession: jest.fn(async () => ({
        sessionId: 'sess-owner',
        userId: 'user-owner-1',
        email: 'genemaxitsolution@gmail.com',
        fullName: 'Genemax Platform Owner',
        isSuperAdmin: true,
        isPlatformOwner: true,
        tenantId: null,
        role: 'PLATFORM_OWNER',
      })),
    };

    const service = new AuthService(dbMock, redisMock, cryptoMock, mfaMock, sessionMock);
    const res = await service.login(
      { email: 'genemaxitsolution@gmail.com', password: 'OwnerPassword@2026' },
      '127.0.0.1',
      'jest',
    );

    expect(res.session?.isSuperAdmin).toBe(true);
    expect(res.session?.isPlatformOwner).toBe(true);
    expect(res.session?.tenantId).toBeNull();
  });

  it('auto-provisions Team Admin (genemaxit@gmail.com) as a regular Company Admin workspace user', async () => {
    process.env.GSIGN_TEAM_ADMIN_EMAIL = 'genemaxit@gmail.com';
    process.env.GSIGN_TEAM_ADMIN_PASSWORD = 'TestEnvPassword@2026';

    let seededUser: any = null;
    const queries: string[] = [];
    const dbMock: any = {
      query: jest.fn(async () => ({ rows: seededUser ? [seededUser] : [] })),
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string, vals: any[]) => {
            queries.push(sql);
            if (sql.includes('INSERT INTO tenants')) return { rows: [{ id: 'tenant-gmax-1' }] };
            if (sql.includes('SELECT id, is_super_admin FROM users')) return { rows: [] };
            if (sql.includes('INSERT INTO users')) {
              seededUser = {
                id: 'user-team-1',
                email: vals[0],
                password_hash: vals[1],
                full_name: vals[2],
                is_super_admin: false,
                is_active: true,
              };
              return { rows: [{ id: 'user-team-1' }] };
            }
            if (sql.includes('FROM roles')) return { rows: [{ id: 'role-ca' }] };
            if (sql.includes('FROM subscription_plans')) return { rows: [{ id: 'plan-ent' }] };
            return { rows: [] };
          }),
        }),
      ),
    };
    const redisMock: any = { get: jest.fn(async () => null), incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
    const cryptoMock: any = {
      hashPassword: jest.fn(async (p: string) => `hashed:${p}`),
      verifyPassword: jest.fn(async (p: string, h: string) => h === `hashed:${p}`),
    };
    const mfaMock: any = { hasMfaEnabled: jest.fn(async () => false) };
    const sessionMock: any = {
      createSession: jest.fn(async () => ({
        sessionId: 'sess-team',
        userId: 'user-team-1',
        email: 'genemaxit@gmail.com',
        fullName: 'Genemax IT Solution Team',
        isSuperAdmin: false,
        isPlatformOwner: false,
        tenantId: 'tenant-gmax-1',
        role: 'Company Admin',
      })),
    };

    const service = new AuthService(dbMock, redisMock, cryptoMock, mfaMock, sessionMock);
    const res = await service.login(
      { email: 'genemaxit@gmail.com', password: 'TestEnvPassword@2026' },
      '127.0.0.1',
      'jest',
    );

    expect(res.session?.isSuperAdmin).toBe(false);
    expect(res.session?.tenantId).toBe('tenant-gmax-1');
    expect(res.session?.role).toBe('Company Admin');
    expect(queries.some((q) => q.includes('INSERT INTO tenant_memberships'))).toBe(true);
    expect(queries.some((q) => q.includes('INSERT INTO tenant_subscriptions'))).toBe(true);
  });

  it('rejects unknown email when no matching env account is configured', async () => {
    delete process.env.GSIGN_OWNER_EMAIL;
    delete process.env.GSIGN_TEAM_ADMIN_EMAIL;
    delete process.env.GSIGN_COMPANY_ADMIN_EMAIL;

    const dbMock: any = {
      query: jest.fn(async () => ({ rows: [] })),
      executeAsSuperAdmin: jest.fn(),
    };
    const redisMock: any = { get: jest.fn(async () => null), incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
    const service = new AuthService(dbMock, redisMock, {} as any, {} as any, {} as any);

    await expect(
      service.login({ email: 'unknown@example.com', password: 'pw' }, '127.0.0.1', 'jest'),
    ).rejects.toThrow(UnauthorizedException);
    expect(dbMock.executeAsSuperAdmin).not.toHaveBeenCalled();
  });
});
