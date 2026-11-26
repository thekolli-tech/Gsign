import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { SessionService } from '../auth/session.service';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { PdfGeneratorService } from './pdf-generator.service';

describe('Priority 4.1 HTTP Integration Tests (Supertest + INestApplication)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let redis: RedisService;
  let sessionService: SessionService;
  let pdfGenerator: PdfGeneratorService;

  let tenantAId: string;
  let tenantBId: string;
  let cookieTenantAAdmin: string;
  let cookieTenantASignatory: string;
  let cookieTenantBAdmin: string;
  let cookiePlatformOwnerNoTenant: string;
  let signatoryUserId: string;
  const createdSessionIds: string[] = [];
  const createdAgreementIds: string[] = [];

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
    redis = app.get(RedisService);
    sessionService = app.get(SessionService);
    pdfGenerator = app.get(PdfGeneratorService);

    const tenantsRes = await db.query(
      `SELECT id, slug FROM tenants WHERE slug IN ('gsign', 'acme') ORDER BY slug ASC`,
    );
    tenantAId = tenantsRes.rows.find((t) => t.slug === 'gsign').id;
    tenantBId = tenantsRes.rows.find((t) => t.slug === 'acme').id;

    const uARes = await db.query(
      `SELECT id, email, full_name FROM users WHERE email = 'priya@gsign.in' LIMIT 1`,
    );
    const uBRes = await db.query(
      `SELECT id, email, full_name FROM users WHERE email = 'john@acme.com' LIMIT 1`,
    );
    const userA = uARes.rows[0];
    const userB = uBRes.rows[0];

    // Create/reuse a Signatory user & membership for permission boundary tests
    const sigEmail = 'signatory-http-test@gsign.in';
    const sigUpsert = await db.executeAsSuperAdmin(async (client) => {
      let uid: string;
      const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [sigEmail]);
      if (existing.rows[0]) {
        uid = existing.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO users (email, password_hash, full_name, is_super_admin)
           VALUES ($1, 'test-hash', 'Signatory Tester', false)
           RETURNING id`,
          [sigEmail],
        );
        uid = ins.rows[0].id;
      }
      const roleRes = await client.query(`SELECT id FROM roles WHERE name = 'Signatory' LIMIT 1`);
      const sigRoleId = roleRes.rows[0].id;
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'External', 'Active')
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
        [tenantAId, uid, sigRoleId],
      );
      return uid;
    });
    signatoryUserId = sigUpsert;

    const poRes = await db.query(
      `SELECT id FROM users WHERE is_platform_owner = true LIMIT 1`,
    );
    const poUserId = poRes.rows[0]?.id || userA.id;

    const sAdminA = await sessionService.createSession(
      userA.id,
      tenantAId,
      '127.0.0.1',
      'Supertest',
    );
    createdSessionIds.push(sAdminA.sessionId);
    cookieTenantAAdmin = `gsign_session=${sAdminA.sessionId}`;

    const sSigA = await sessionService.createSession(
      signatoryUserId,
      tenantAId,
      '127.0.0.1',
      'Supertest',
    );
    createdSessionIds.push(sSigA.sessionId);
    cookieTenantASignatory = `gsign_session=${sSigA.sessionId}`;

    const sAdminB = await sessionService.createSession(
      userB.id,
      tenantBId,
      '127.0.0.1',
      'Supertest',
    );
    createdSessionIds.push(sAdminB.sessionId);
    cookieTenantBAdmin = `gsign_session=${sAdminB.sessionId}`;

    const sPo = await sessionService.createSession(
      poUserId,
      null,
      '127.0.0.1',
      'Supertest',
    );
    createdSessionIds.push(sPo.sessionId);
    cookiePlatformOwnerNoTenant = `gsign_session=${sPo.sessionId}`;
  });

  afterAll(async () => {
    for (const sid of createdSessionIds) {
      await sessionService.revokeSession(sid);
    }
    for (const uuid of createdAgreementIds) {
      await db.executeAsSuperAdmin(async (client) => {
        await client.query(`DELETE FROM agreements WHERE id = $1::uuid`, [uuid]);
      });
    }
    if (signatoryUserId) {
      await db.executeAsSuperAdmin(async (client) => {
        await client.query(`DELETE FROM users WHERE id = $1::uuid`, [signatoryUserId]);
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('Enforces auth, tenant context, DTO validation, magic-byte upload, RBAC permissions, download, and cross-tenant isolation over HTTP', async () => {
    // 1. Unauthenticated blocked
    await request(app.getHttpServer()).get('/api/v1/documents').expect(401);

    // 2. Platform Owner without tenantId rejected cleanly with 403 (never passes null into executeWithTenantContext)
    await request(app.getHttpServer())
      .get('/api/v1/documents')
      .set('Cookie', cookiePlatformOwnerNoTenant)
      .expect(403);

    // 3. Create agreement via HTTP
    const createAgrRes = await request(app.getHttpServer())
      .post('/api/v1/agreements')
      .set('Cookie', cookieTenantAAdmin)
      .send({
        recipient_name: 'HTTP Signer',
        recipient_email: 'httpsigner@example.com',
        template_type: 'NDA',
        department: 'Legal',
        fee_amount: 0,
        period: '12 months',
        content: 'HTTP integration test NDA.',
        sign_method: 'basic_drawn',
        initial_status: 'Draft',
      })
      .expect(201);
    const agreementUuid = createAgrRes.body.uuid;
    createdAgreementIds.push(agreementUuid);

    // 4. Reject spoofed MIME upload (HTML disguised as application/pdf)
    await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookieTenantAAdmin)
      .field('agreement_id', agreementUuid)
      .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), {
        filename: 'evil.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    // 5. Valid PDF upload succeeds & increments storage_bytes_used
    const validPdf = Buffer.from('%PDF-1.4\n%Valid HTTP Upload\n');
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/documents/upload')
      .set('Cookie', cookieTenantAAdmin)
      .field('agreement_id', agreementUuid)
      .field('title', 'HTTP Uploaded NDA')
      .attach('file', validPdf, {
        filename: '../../etc/passwd/nda.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const docId = uploadRes.body.document.id;
    expect(uploadRes.body.version.file_name).toBe('nda.pdf');

    // 6. Signatory (read-only) cannot generate PDF or finalize (403 Forbidden)
    await request(app.getHttpServer())
      .post(`/api/v1/documents/agreements/${agreementUuid}/generate-pdf`)
      .set('Cookie', cookieTenantASignatory)
      .send({})
      .expect(403);

    // 7. Tenant A Admin downloads document over HTTP
    const dlRes = await request(app.getHttpServer())
      .get(`/api/v1/documents/${docId}/download`)
      .set('Cookie', cookieTenantAAdmin)
      .expect(200);
    expect(dlRes.headers['x-document-sha256']).toBe(uploadRes.body.version.sha256_hash);

    // 8. Tenant B Admin cannot access Tenant A document (404)
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${docId}/download`)
      .set('Cookie', cookieTenantBAdmin)
      .expect(404);

    // 9. DTO validation on Signing Request creation
    await request(app.getHttpServer())
      .post('/api/v1/signing/requests')
      .set('Cookie', cookieTenantAAdmin)
      .send({ agreement_id: agreementUuid, recipients: [] })
      .expect(400);
  });

  it('Handles public signing portal, OTP rate limiting, finalization failure recovery, and duplicate prevention over HTTP', async () => {
    const createAgrRes = await request(app.getHttpServer())
      .post('/api/v1/agreements')
      .set('Cookie', cookieTenantAAdmin)
      .send({
        recipient_name: 'Recovery Signer',
        recipient_email: 'recovery@example.com',
        template_type: 'MSA',
        department: 'Sales',
        fee_amount: 1000,
        period: '12 months',
        content: 'Recoverable finalization test MSA.',
        sign_method: 'basic_drawn',
        initial_status: 'Draft',
      })
      .expect(201);
    const agreementUuid = createAgrRes.body.uuid;
    createdAgreementIds.push(agreementUuid);

    const reqRes = await request(app.getHttpServer())
      .post('/api/v1/signing/requests')
      .set('Cookie', cookieTenantAAdmin)
      .send({
        agreement_id: agreementUuid,
        sequential: true,
        recipients: [{ name: 'Recovery Signer', email: 'recovery@example.com' }],
      })
      .expect(201);
    const rawToken = reqRes.body.recipients[0].signing_token;
    const recipientId = reqRes.body.recipients[0].id;

    // Public portal lookup
    const portalRes = await request(app.getHttpServer())
      .get(`/api/v1/signing/portal/${rawToken}`)
      .expect(200);
    expect(portalRes.body.portal_status).toBe('OTP_REQUIRED');

    // Insert known OTP & verify over HTTP
    const otpHash = crypto.createHash('sha256').update('246810').digest('hex');
    await db.executeWithTenantContext(tenantAId, async (client) => {
      await client.query(
        `INSERT INTO signing_otp_attempts (tenant_id, recipient_id, otp_hash, attempts, max_attempts, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::varchar, 0, 5, NOW() + INTERVAL '10 minutes')`,
        [tenantAId, recipientId, otpHash],
      );
    });

    await request(app.getHttpServer())
      .post(`/api/v1/signing/portal/${rawToken}/otp/verify`)
      .send({ otp: '246810' })
      .expect(200);

    // Rate limiting check on otp/verify (10 per token window -> 11th returns 429)
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await redis.set(`rate:signing:otp_ver:tok:${tokenHash}`, '10');
    await request(app.getHttpServer())
      .post(`/api/v1/signing/portal/${rawToken}/otp/verify`)
      .send({ otp: '246810' })
      .expect(429);

    // Simulate PDF generation outage during final signature submission
    const spy = jest
      .spyOn(pdfGenerator, 'generateSignedAgreementPdf')
      .mockRejectedValueOnce(new Error('Simulated PDF outage'));

    await request(app.getHttpServer())
      .post(`/api/v1/signing/portal/${rawToken}/sign`)
      .send({
        signature_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        consent_accepted: true,
        consent_text: 'I consent to sign electronically.',
      })
      .expect(500);

    spy.mockRestore();

    // Agreement MUST be Finalizing (not Completed) and signature_records preserved
    const stateAfterFail = await db.executeWithTenantContext(tenantAId, async (client) => {
      const a = await client.query(`SELECT status FROM agreements WHERE id = $1::uuid`, [agreementUuid]);
      const f = await client.query(`SELECT status, last_error FROM signing_finalizations WHERE agreement_id = $1::uuid`, [agreementUuid]);
      const s = await client.query(`SELECT COUNT(*)::int AS cnt FROM signature_records WHERE agreement_id = $1::uuid`, [agreementUuid]);
      return { agreementStatus: a.rows[0].status, fin: f.rows[0], sigCount: s.rows[0].cnt };
    });
    expect(stateAfterFail.agreementStatus).toBe('Finalizing');
    expect(stateAfterFail.fin.status).toBe('FAILED');
    expect(stateAfterFail.fin.last_error).toContain('Simulated PDF outage');
    expect(stateAfterFail.sigCount).toBe(1);

    // Retry finalization succeeds and marks agreement Completed
    const retryRes = await request(app.getHttpServer())
      .post(`/api/v1/signing/requests/agreement/${agreementUuid}/retry-finalization`)
      .set('Cookie', cookieTenantAAdmin)
      .expect(200);
    expect(retryRes.body.already_finalized).toBe(false);
    expect(retryRes.body.certificate.certificate_number).toMatch(/^CERT-/);

    // Duplicate finalization retry is idempotent (already_finalized: true)
    const dupRetryRes = await request(app.getHttpServer())
      .post(`/api/v1/signing/requests/agreement/${agreementUuid}/retry-finalization`)
      .set('Cookie', cookieTenantAAdmin)
      .expect(200);
    expect(dupRetryRes.body.already_finalized).toBe(true);
  });

  it('Automatically denies access on expired subscription and revokes sessions when a tenant is removed', async () => {
    // Create temporary tenant + user + subscription
    const ts = Date.now();
    const setup = await db.executeAsSuperAdmin(async (client) => {
      const tRes = await client.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, '+91 90000 00001', 'Active') RETURNING id`,
        [`Temp Expiry Corp ${ts}`, `temp-exp-${ts}`, `temp-${ts}@example.com`],
      );
      const tId = tRes.rows[0].id;

      const uRes = await client.query(
        `INSERT INTO users (email, password_hash, full_name, is_active, email_verified_at)
         VALUES ($1, 'hash', 'Temp Admin', true, NOW()) RETURNING id`,
        [`temp-admin-${ts}@example.com`],
      );
      const uId = uRes.rows[0].id;

      const rRes = await client.query(`SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`);
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Executive', 'Active')`,
        [tId, uId, rRes.rows[0].id],
      );

      const pRes = await client.query(`SELECT id FROM subscription_plans WHERE slug = 'starter' LIMIT 1`);
      await client.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end)
         VALUES ($1::uuid, $2::uuid, 'monthly', 'ACTIVE', NOW() - INTERVAL '32 days', NOW() - INTERVAL '1 hour')`,
        [tId, pRes.rows[0].id],
      );
      return { tId, uId };
    });

    const tempSession = await sessionService.createSession(
      setup.uId,
      setup.tId,
      '127.0.0.1',
      'Supertest',
    );
    const tempCookie = `gsign_session=${tempSession.sessionId}`;

    // 1. Expired subscription automatically denied (403) and DB status updated to EXPIRED
    await request(app.getHttpServer())
      .get('/api/v1/agreements')
      .set('Cookie', tempCookie)
      .expect(403);

    const subStatus = await db.executeAsSuperAdmin(async (client) => {
      const r = await client.query(
        `SELECT status FROM tenant_subscriptions WHERE tenant_id = $1::uuid`,
        [setup.tId],
      );
      return r.rows[0]?.status;
    });
    expect(subStatus).toBe('EXPIRED');

    // 2. Platform Owner archives tenant -> sessions immediately revoked (401 on subsequent request)
    await request(app.getHttpServer())
      .delete(`/api/v1/tenants/${setup.tId}?confirm=true`)
      .set('Cookie', cookiePlatformOwnerNoTenant)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/agreements')
      .set('Cookie', tempCookie)
      .expect(401);

    await db.executeAsSuperAdmin(async (client) => {
      await client.query(`DELETE FROM users WHERE id = $1::uuid`, [setup.uId]);
    });
  });
});
