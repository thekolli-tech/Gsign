import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { CryptoService } from '../auth/crypto.service';
import { SessionService } from '../auth/session.service';
import { DatabaseService } from '../database/database.service';

describe('Safe Tenant Soft-Deletion / Archival & Access Denial (HTTP Integration)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let sessionService: SessionService;
  let cryptoService: CryptoService;

  let cookieOwner: string;
  let cookieTenantAAdmin: string;
  let tempTenantId: string;
  let tempUserId: string;
  let tempRegId: string;
  let tempEmail: string;
  const tempPassword = 'TenantArchive@2026!';
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    db = app.get(DatabaseService);
    sessionService = app.get(SessionService);
    cryptoService = app.get(CryptoService);

    const poRes = await db.query(
      `SELECT id FROM users WHERE is_platform_owner = true LIMIT 1`,
    );
    const sOwner = await sessionService.createSession(
      poRes.rows[0].id,
      null,
      '127.0.0.1',
      'Supertest',
    );
    createdSessionIds.push(sOwner.sessionId);
    cookieOwner = `gsign_session=${sOwner.sessionId}`;

    const tARes = await db.query(`SELECT id FROM tenants WHERE slug = 'gsign' LIMIT 1`);
    const uARes = await db.query(`SELECT id FROM users WHERE email = 'priya@gsign.in' LIMIT 1`);
    const sA = await sessionService.createSession(
      uARes.rows[0].id,
      tARes.rows[0].id,
      '127.0.0.1',
      'Supertest',
    );
    createdSessionIds.push(sA.sessionId);
    cookieTenantAAdmin = `gsign_session=${sA.sessionId}`;
  });

  afterAll(async () => {
    for (const sid of createdSessionIds) {
      await sessionService.revokeSession(sid);
    }
    if (tempTenantId) {
      await db.executeAsSuperAdmin(async (client) => {
        if (tempRegId) {
          await client.query(`DELETE FROM company_registrations WHERE id = $1::uuid`, [tempRegId]);
        }
        await client.query(`DELETE FROM tenants WHERE id = $1::uuid`, [tempTenantId]);
      });
    }
    if (tempUserId) {
      await db.executeAsSuperAdmin(async (client) => {
        await client.query(`DELETE FROM users WHERE id = $1::uuid`, [tempUserId]);
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('Soft-deletes tenant with company_registrations/payments, revokes sessions, denies login/invites, preserves history & is idempotent', async () => {
    const ts = Date.now();
    tempEmail = `archive-admin-${ts}@example.com`;
    const passwordHash = await cryptoService.hashPassword(tempPassword);
    const inviteToken = `inv_${ts}_${crypto.randomBytes(8).toString('hex')}`;
    const inviteTokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');

    const provisioned = await db.executeAsSuperAdmin(async (client) => {
      const tRes = await client.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, '+91 90000 11111', 'Active') RETURNING id`,
        [`Archive Test Corp ${ts}`, `archive-corp-${ts}`, tempEmail],
      );
      const tId = tRes.rows[0].id;

      const uRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, is_active, email_verified_at)
         VALUES ($1, $2, 'Archive Admin', true, NOW()) RETURNING id`,
        [tempEmail, passwordHash],
      );
      const uId = uRes.rows[0].id;

      const rRes = await client.query(`SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`);
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Executive', 'Active')`,
        [tId, uId, rRes.rows[0].id],
      );

      const pRes = await client.query(`SELECT id FROM subscription_plans WHERE slug = 'starter' LIMIT 1`);
      const subRes = await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end)
         VALUES ($1::uuid, $2::uuid, 'monthly', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days') RETURNING id`,
        [tId, pRes.rows[0].id],
      );

      await client.query(
        `INSERT INTO payments (tenant_id, subscription_id, amount, currency, provider, status, verified_at)
         VALUES ($1::uuid, $2::uuid, 499.00, 'INR', 'SIMULATED', 'COMPLETED', NOW())`,
        [tId, subRes.rows[0].id],
      );

      // Foreign key on company_registrations that previously caused DELETE FROM tenants to fail
      const regRes = await client.query(
        `INSERT INTO company_registrations (
           company_name, display_name, business_email, business_phone,
           country, state, city, address, admin_full_name, admin_email,
           admin_password_hash, status, tenant_id, admin_user_id, selected_plan_id
         ) VALUES (
           $1, $1, $2, '+91 90000 11111',
           'India', 'Karnataka', 'Bengaluru', '100 MG Road', 'Archive Admin', $2,
           $3, 'ACTIVE', $4::uuid, $5::uuid, $6::uuid
         ) RETURNING id`,
        [`Archive Test Corp ${ts}`, tempEmail, passwordHash, tId, uId, pRes.rows[0].id],
      );

      await client.query(
        `INSERT INTO invitations (tenant_id, email, role_id, department, token_hash, expires_at, created_by)
         VALUES ($1::uuid, $2, $3::uuid, 'Legal', $4, NOW() + INTERVAL '7 days', $5::uuid)`,
        [tId, `invitee-${ts}@example.com`, rRes.rows[0].id, inviteTokenHash, uId],
      );

      return { tId, uId, regId: regRes.rows[0].id };
    });

    tempTenantId = provisioned.tId;
    tempUserId = provisioned.uId;
    tempRegId = provisioned.regId;

    const tenantSession = await sessionService.createSession(
      tempUserId,
      tempTenantId,
      '127.0.0.1',
      'Supertest',
    );
    const cookieTempAdmin = `gsign_session=${tenantSession.sessionId}`;

    // 1. Unauthorized non-SuperAdmin cannot remove tenant (403)
    await request(app.getHttpServer())
      .delete(`/api/v1/tenants/${tempTenantId}?confirm=true`)
      .set('Cookie', cookieTenantAAdmin)
      .expect(403);

    // 2. Missing explicit confirmation rejected (400)
    await request(app.getHttpServer())
      .delete(`/api/v1/tenants/${tempTenantId}`)
      .set('Cookie', cookieOwner)
      .expect(400);

    // 3. Platform Owner archives tenant with explicit confirmation -> 200 OK
    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/tenants/${tempTenantId}?confirm=true`)
      .set('Cookie', cookieOwner)
      .expect(200);
    expect(delRes.body.success).toBe(true);
    expect(delRes.body.already_archived).toBe(false);
    expect(delRes.body.status).toBe('Archived');

    // 4. Repeated removal request is idempotent -> 200 OK (already_archived: true)
    const repeatRes = await request(app.getHttpServer())
      .delete(`/api/v1/tenants/${tempTenantId}?confirm=true`)
      .set('Cookie', cookieOwner)
      .expect(200);
    expect(repeatRes.body.already_archived).toBe(true);

    // 5. Existing session immediately revoked -> 401
    await request(app.getHttpServer())
      .get('/api/v1/agreements')
      .set('Cookie', cookieTempAdmin)
      .expect(401);

    // 6. Login denied for archived tenant -> 403
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: tempEmail, password: tempPassword })
      .expect(403);

    // 7. Pending invitation acceptance denied for archived tenant -> 403
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({
        token: inviteToken,
        full_name: 'Late Invitee',
        password: 'StrongPassword@2026!',
      })
      .expect(403);

    // 8. Active listing excludes archived tenant; include_archived=true includes it
    const activeList = await request(app.getHttpServer())
      .get('/api/v1/tenants')
      .set('Cookie', cookieOwner)
      .expect(200);
    expect(activeList.body.some((t: any) => t.id === tempTenantId)).toBe(false);

    const allList = await request(app.getHttpServer())
      .get('/api/v1/tenants?include_archived=true')
      .set('Cookie', cookieOwner)
      .expect(200);
    const archivedRow = allList.body.find((t: any) => t.id === tempTenantId);
    expect(archivedRow).toBeTruthy();
    expect(archivedRow.status).toBe('Archived');
    expect(archivedRow.deleted_at).toBeTruthy();

    // 9. Historical records preserved in DB + TENANT_REMOVED audit log recorded
    const history = await db.executeAsSuperAdmin(async (client) => {
      const reg = await client.query(`SELECT id FROM company_registrations WHERE id = $1::uuid`, [tempRegId]);
      const pay = await client.query(`SELECT id FROM payments WHERE tenant_id = $1::uuid`, [tempTenantId]);
      const sub = await client.query(`SELECT status FROM tenant_subscriptions WHERE tenant_id = $1::uuid`, [tempTenantId]);
      const aud = await client.query(
        `SELECT action FROM audit_logs WHERE target_id = $1 AND action = 'TENANT_REMOVED'`,
        [tempTenantId],
      );
      return {
        regCount: reg.rows.length,
        payCount: pay.rows.length,
        subStatus: sub.rows[0]?.status,
        auditCount: aud.rows.length,
      };
    });
    expect(history.regCount).toBe(1);
    expect(history.payCount).toBe(1);
    expect(history.subStatus).toBe('CANCELLED');
    expect(history.auditCount).toBe(1);
  });
});
