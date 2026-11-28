import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService — Env-Configured Super Admin Auto-Bootstrap', () => {
  const prevEmail = process.env.GSIGN_TEAM_ADMIN_EMAIL;
  const prevPass = process.env.GSIGN_TEAM_ADMIN_PASSWORD;

  afterEach(() => {
    if (prevEmail === undefined) delete process.env.GSIGN_TEAM_ADMIN_EMAIL;
    else process.env.GSIGN_TEAM_ADMIN_EMAIL = prevEmail;
    if (prevPass === undefined) delete process.env.GSIGN_TEAM_ADMIN_PASSWORD;
    else process.env.GSIGN_TEAM_ADMIN_PASSWORD = prevPass;
  });

  it('auto-provisions env-configured super admin on first login without manual seed', async () => {
    process.env.GSIGN_TEAM_ADMIN_EMAIL = 'genemaxit@gmail.com';
    process.env.GSIGN_TEAM_ADMIN_PASSWORD = 'TestEnvPassword@2026';

    let seededUser: any = null;
    const dbMock: any = {
      query: jest.fn(async () => ({ rows: seededUser ? [seededUser] : [] })),
      executeAsSuperAdmin: jest.fn(async (fn: (c: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string, vals: any[]) => {
            if (sql.includes('INSERT INTO users')) {
              seededUser = {
                id: 'user-admin-1',
                email: vals[0],
                password_hash: vals[1],
                full_name: vals[2],
                is_super_admin: true,
                is_active: true,
              };
              return { rows: [{ id: 'user-admin-1' }] };
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
        sessionId: 'sess-1',
        userId: 'user-admin-1',
        email: 'genemaxit@gmail.com',
        fullName: 'Genemax IT Solution Admin',
        isSuperAdmin: true,
        isPlatformOwner: true,
        tenantId: null,
        role: 'PLATFORM_OWNER',
      })),
    };

    const service = new AuthService(dbMock, redisMock, cryptoMock, mfaMock, sessionMock);
    const res = await service.login(
      { email: 'genemaxit@gmail.com', password: 'TestEnvPassword@2026' },
      '127.0.0.1',
      'jest',
    );

    expect(res.mfa_required).toBe(false);
    expect(res.session?.email).toBe('genemaxit@gmail.com');
    expect(res.session?.isSuperAdmin).toBe(true);
    expect(cryptoMock.hashPassword).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown email when no matching env super admin is configured', async () => {
    delete process.env.GSIGN_TEAM_ADMIN_EMAIL;
    delete process.env.GSIGN_TEAM_ADMIN_PASSWORD;

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
