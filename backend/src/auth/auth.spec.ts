import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { authenticator } from 'otplib';

describe('AuthService & Security Integration Tests (Milestone 1)', () => {
  let authService: AuthService;
  let sessionService: SessionService;
  let cryptoService: CryptoService;
  let mfaService: MfaService;
  let db: DatabaseService;
  let redis: RedisService;
  let testUserId: string;
  let testTenantId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '../.env'],
        }),
        DatabaseModule,
        RedisModule,
      ],
      providers: [
        AuthService,
        SessionService,
        CryptoService,
        MfaService,
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    sessionService = module.get<SessionService>(SessionService);
    cryptoService = module.get<CryptoService>(CryptoService);
    mfaService = module.get<MfaService>(MfaService);
    db = module.get<DatabaseService>(DatabaseService);
    redis = module.get<RedisService>(RedisService);

    // Initialize module connections
    await db.onModuleInit();
    await redis.onModuleInit();

    // Create a dedicated test user and tenant
    const passwordHash = await cryptoService.hashPassword('StrongPassword123!');
    const userRes = await db.query(
      `INSERT INTO users (email, password_hash, full_name, is_super_admin, is_active)
       VALUES ($1, $2, 'Test Suite User', false, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id;`,
      ['test-suite@gsign.in', passwordHash]
    );
    testUserId = userRes.rows[0].id;

    const tenantRes = await db.query(
      `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
       VALUES ('Test Suite Tenant', 'test-tenant-suite', 'suite@gsign.in', '+91 90000 00000', 'Active')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id;`
    );
    testTenantId = tenantRes.rows[0].id;

    // Link user to tenant with Company Admin role
    const roleRes = await db.query(`SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1;`);
    const roleId = roleRes.rows[0].id;

    await db.query("SELECT set_config('app.is_super_admin', 'true', true);");
    await db.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
       VALUES ($1, $2, $3, 'QA', 'Active')
       ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
      [testTenantId, testUserId, roleId]
    );
  }, 30000);

  afterAll(async () => {
    // Clean up test user and tenant
    if (testUserId) {
      await db.query(`DELETE FROM users WHERE id = $1;`, [testUserId]);
    }
    if (testTenantId) {
      await db.query(`DELETE FROM tenants WHERE id = $1;`, [testTenantId]);
    }
    await redis.onModuleDestroy();
    await db.onModuleDestroy();
  });

  // TEST 1: Successful Login
  it('Requirement 1: Should authenticate successfully with correct credentials', async () => {
    const result = await authService.login(
      { email: 'test-suite@gsign.in', password: 'StrongPassword123!' },
      '127.0.0.1',
      'Jest-Test-Runner'
    );

    expect(result.mfa_required).toBe(false);
    expect(result.session).toBeDefined();
    expect(result.session!.userId).toBe(testUserId);
    expect(result.session!.email).toBe('test-suite@gsign.in');
    expect(result.session!.tenantId).toBe(testTenantId);
    expect(result.session!.role).toBe('Company Admin');
  });

  // TEST 2: Incorrect Password Rejection
  it('Requirement 2: Should reject incorrect password with UnauthorizedException', async () => {
    await expect(
      authService.login(
        { email: 'test-suite@gsign.in', password: 'WrongPassword999!' },
        '127.0.0.1',
        'Jest-Test-Runner'
      )
    ).rejects.toThrow(UnauthorizedException);
  });

  // TEST 3: Session Creation
  it('Requirement 3: Should generate a valid 256-bit session persisted in DB and cached in Redis', async () => {
    const session = await sessionService.createSession(
      testUserId,
      testTenantId,
      '127.0.0.1',
      'Session-Test-Agent'
    );

    expect(session.sessionId).toHaveLength(64); // 32 bytes in hex = 64 characters

    // Verify session in Redis
    const cached = await redis.get(`session:${session.sessionId}`);
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached!);
    expect(parsed.userId).toBe(testUserId);

    // Verify session in Database
    const dbRes = await db.query(`SELECT * FROM sessions WHERE id = $1;`, [session.sessionId]);
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].user_id).toBe(testUserId);
  });

  // TEST 4: Session Expiration
  it('Requirement 4: Should reject expired session', async () => {
    const session = await sessionService.createSession(
      testUserId,
      testTenantId,
      '127.0.0.1',
      'Expire-Test-Agent'
    );

    // Manually backdate the session expiry in DB to simulate expiration
    await db.query(
      `UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1;`,
      [session.sessionId]
    );
    // Delete from Redis so it falls back to DB expiration check
    await redis.del(`session:${session.sessionId}`);

    const verified = await sessionService.getSession(session.sessionId);
    expect(verified).toBeNull();
  });

  // TEST 5: Logout and Session Revocation
  it('Requirement 5: Should revoke session immediately upon logout', async () => {
    const session = await sessionService.createSession(
      testUserId,
      testTenantId,
      '127.0.0.1',
      'Revoke-Test-Agent'
    );

    // Verify session is active before logout
    const active = await sessionService.getSession(session.sessionId);
    expect(active).not.toBeNull();

    // Perform logout
    await authService.logout(session.sessionId);

    // Verify session is removed from Redis
    const cached = await redis.get(`session:${session.sessionId}`);
    expect(cached).toBeNull();

    // Verify session is revoked in DB
    const dbRes = await db.query(`SELECT revoked_at FROM sessions WHERE id = $1;`, [session.sessionId]);
    expect(dbRes.rows[0].revoked_at).not.toBeNull();

    // Verify getSession returns null
    const revoked = await sessionService.getSession(session.sessionId);
    expect(revoked).toBeNull();
  });

  // TEST 6: MFA Enrollment and Verification
  it('Requirement 6: Should enroll TOTP MFA, verify 6-digit code, and enable MFA', async () => {
    // 1. Enroll MFA
    const enrollment = await authService.enrollMfa(testUserId);
    expect(enrollment.secret).toBeDefined();
    expect(enrollment.qr_code_data_url).toContain('data:image/png;base64');
    expect(enrollment.otpauth_uri).toContain('otpauth://totp/');

    // 2. Generate valid TOTP code
    const validCode = authenticator.generate(enrollment.secret);

    // 3. Confirm enrollment
    const confirmation = await authService.verifyMfaEnrollment(testUserId, validCode);
    expect(confirmation.success).toBe(true);
    expect(confirmation.recovery_codes).toHaveLength(8);

    // 4. Verify in DB that MFA is now enabled
    const mfaDb = await db.query(
      `SELECT is_enabled, confirmed_at FROM user_mfa_configs WHERE user_id = $1;`,
      [testUserId]
    );
    expect(mfaDb.rows[0].is_enabled).toBe(true);
    expect(mfaDb.rows[0].confirmed_at).not.toBeNull();

    // 5. Verify that login now requires MFA
    const loginAttempt = await authService.login(
      { email: 'test-suite@gsign.in', password: 'StrongPassword123!' },
      '127.0.0.1',
      'MFA-Login-Agent'
    );
    expect(loginAttempt.mfa_required).toBe(true);
    expect(loginAttempt.mfa_token).toBeDefined();
    expect(loginAttempt.mfa_token!.startsWith('mfa_tok_')).toBe(true);

    // 6. Complete login with current TOTP code (clear previous enrollment code from redis to simulate fresh window)
    const nextCode = authenticator.generate(enrollment.secret);
    await redis.del(`mfa:used:${testUserId}:${nextCode}`);
    const mfaLoginResult = await authService.verifyMfaLogin(
      { mfa_token: loginAttempt.mfa_token!, code: nextCode },
      '127.0.0.1',
      'MFA-Login-Agent'
    );
    expect(mfaLoginResult.sessionId).toBeDefined();
    expect(mfaLoginResult.userId).toBe(testUserId);
  });

  // TEST 7: Invalid MFA Code Rejection
  it('Requirement 7: Should reject invalid MFA codes and prevent replay attacks', async () => {
    const loginAttempt = await authService.login(
      { email: 'test-suite@gsign.in', password: 'StrongPassword123!' },
      '127.0.0.1',
      'Replay-Test-Agent'
    );

    // Invalid code
    await expect(
      authService.verifyMfaLogin(
        { mfa_token: loginAttempt.mfa_token!, code: '000000' },
        '127.0.0.1',
        'Replay-Test-Agent'
      )
    ).rejects.toThrow(UnauthorizedException);

    // Get valid secret to test replay
    const mfaDb = await db.query(
      `SELECT secret_encrypted FROM user_mfa_configs WHERE user_id = $1;`,
      [testUserId]
    );
    const secret = cryptoService.decryptAes256Gcm(mfaDb.rows[0].secret_encrypted);
    const validCode = authenticator.generate(secret);
    // Ensure clean replay state for first use
    await redis.del(`mfa:used:${testUserId}:${validCode}`);

    // First use: succeeds
    const session = await authService.verifyMfaLogin(
      { mfa_token: loginAttempt.mfa_token!, code: validCode },
      '127.0.0.1',
      'Replay-Test-Agent'
    );
    expect(session.sessionId).toBeDefined();

    // Second login attempt within same window with the same code: must be rejected as replay
    const loginAttempt2 = await authService.login(
      { email: 'test-suite@gsign.in', password: 'StrongPassword123!' },
      '127.0.0.1',
      'Replay-Test-Agent'
    );

    await expect(
      authService.verifyMfaLogin(
        { mfa_token: loginAttempt2.mfa_token!, code: validCode },
        '127.0.0.1',
        'Replay-Test-Agent'
      )
    ).rejects.toThrow(BadRequestException);
  });

  // TEST 8: Recovery Code Single-Use Enforcement
  it('Requirement 8: Should allow emergency login with recovery code and enforce single-use revocation', async () => {
    // Generate fresh recovery codes
    const recoveryCodes = cryptoService.generateRecoveryCodes(2);
    await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1;`, [testUserId]);

    for (const code of recoveryCodes) {
      const hash = await cryptoService.hashRecoveryCode(code);
      await db.query(
        `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2);`,
        [testUserId, hash]
      );
    }

    const testCode = recoveryCodes[0];

    // Attempt 1 with recovery code: succeeds
    const login1 = await authService.login(
      { email: 'test-suite@gsign.in', password: 'StrongPassword123!' },
      '127.0.0.1',
      'Recovery-Agent'
    );
    const session1 = await authService.loginWithRecoveryCode(
      { mfa_token: login1.mfa_token!, recovery_code: testCode },
      '127.0.0.1',
      'Recovery-Agent'
    );
    expect(session1.sessionId).toBeDefined();

    // Verify in DB that testCode was marked as used
    const checkUsed = await db.query(
      `SELECT used_at FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NOT NULL;`,
      [testUserId]
    );
    expect(checkUsed.rows).toHaveLength(1);

    // Attempt 2 with the same recovery code: must be rejected
    const login2 = await authService.login(
      { email: 'test-suite@gsign.in', password: 'StrongPassword123!' },
      '127.0.0.1',
      'Recovery-Agent'
    );
    await expect(
      authService.loginWithRecoveryCode(
        { mfa_token: login2.mfa_token!, recovery_code: testCode },
        '127.0.0.1',
        'Recovery-Agent'
      )
    ).rejects.toThrow(UnauthorizedException);
  });
});
