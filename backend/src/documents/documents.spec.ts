import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { AgreementsService } from '../agreements/agreements.service';
import { SigningService } from '../signing/signing.service';
import { DocumentsService } from './documents.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { StorageService } from './storage.service';

describe('DocumentsService, Storage, PDF Generation, Integrity & Signing Integration', () => {
  let db: DatabaseService;
  let redis: RedisService;
  let agreementsService: AgreementsService;
  let signingService: SigningService;
  let documentsService: DocumentsService;
  let storageService: StorageService;
  let tenantAId: string;
  let tenantBId: string;
  let userA: any;
  let userB: any;
  const createdAgreementUuids: string[] = [];
  const createdStandaloneDocIds: string[] = [];

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
        StorageService,
        PdfGeneratorService,
        DocumentsService,
        AgreementsService,
        SigningService,
      ],
    }).compile();

    db = module.get<DatabaseService>(DatabaseService);
    redis = module.get<RedisService>(RedisService);
    agreementsService = module.get<AgreementsService>(AgreementsService);
    signingService = module.get<SigningService>(SigningService);
    documentsService = module.get<DocumentsService>(DocumentsService);
    storageService = module.get<StorageService>(StorageService);
    await db.onModuleInit();

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
    userA = { ...uARes.rows[0], fullName: uARes.rows[0].full_name, role: 'Company Admin' };
    userB = { ...uBRes.rows[0], fullName: uBRes.rows[0].full_name, role: 'Company Admin' };
  });

  afterAll(async () => {
    for (const uuid of createdAgreementUuids) {
      await db.executeAsSuperAdmin(async (client) => {
        await client.query(`DELETE FROM agreements WHERE id = $1::uuid`, [uuid]);
      });
    }
    for (const docId of createdStandaloneDocIds) {
      await db.executeAsSuperAdmin(async (client) => {
        await client.query(`DELETE FROM documents WHERE id = $1::uuid`, [docId]);
      });
    }
    await db.onModuleDestroy();
    await redis.onModuleDestroy();
  });

  it('Uploads original document, preserves versions, generates server PDF, verifies SHA-256, and enforces RLS isolation', async () => {
    const draft = await agreementsService.createAgreement(tenantAId, userA, {
      recipient_name: 'Doc Tester',
      recipient_email: 'doctester@example.com',
      template_type: 'NDA',
      department: 'Legal',
      fee_amount: 0,
      period: '12 months',
      content: 'Document Management Engine verification NDA.',
      sign_method: 'basic_drawn',
      initial_status: 'Draft',
    });
    createdAgreementUuids.push(draft.uuid);

    const originalBytes = Buffer.from('%PDF-1.4\n%Original uploaded test payload\n', 'utf8');
    const mockFile = {
      originalname: 'original_nda.pdf',
      mimetype: 'application/pdf',
      size: originalBytes.length,
      buffer: originalBytes,
    } as Express.Multer.File;

    const uploaded = await documentsService.uploadOriginalDocument(
      tenantAId,
      userA,
      mockFile,
      { agreement_id: draft.uuid, title: 'Original NDA Attachment' },
      '127.0.0.1',
      'JestTest',
    );
    expect(uploaded.document.doc_kind).toBe('original');
    expect(uploaded.version.version_number).toBe(1);
    expect(uploaded.version.is_immutable).toBe(true);
    expect(
      await storageService.headPrivateObject(
        uploaded.version.storage_provider,
        uploaded.version.storage_bucket,
        uploaded.version.storage_key,
      ),
    ).toBe(true);

    // Server-side PDF generation v1 & v2 (never overwrites original or v1)
    const gen1 = await documentsService.generateAgreementPdf(tenantAId, userA, draft.uuid, undefined, '127.0.0.1', 'JestTest');
    const gen2 = await documentsService.generateAgreementPdf(tenantAId, userA, draft.uuid, undefined, '127.0.0.1', 'JestTest');
    expect(gen1.version.version_number).toBe(1);
    expect(gen2.version.version_number).toBe(2);
    expect(gen1.version.storage_key).not.toBe(gen2.version.storage_key);

    // Download returns real PDF buffer
    const downloaded = await documentsService.downloadDocument(
      tenantAId,
      userA,
      gen2.document.id,
      gen2.version.id,
      undefined,
      '127.0.0.1',
      'JestTest',
    );
    expect(downloaded.buffer?.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    // Integrity check passes
    const verifyOk = await documentsService.verifyDocumentIntegrity(
      tenantAId,
      userA,
      uploaded.document.id,
      uploaded.version.id,
      '127.0.0.1',
      'JestTest',
    );
    expect(verifyOk.verified).toBe(true);
    expect(verifyOk.actual_sha256).toBe(uploaded.version.sha256_hash);

    // Access audit logs recorded
    const logs = await documentsService.getDocumentAccessLogs(tenantAId, uploaded.document.id);
    expect(logs.some((l) => l.action === 'UPLOAD')).toBe(true);
    expect(logs.some((l) => l.action === 'VERIFY_INTEGRITY')).toBe(true);

    // Cross-tenant RLS isolation: Tenant B cannot see or download Tenant A's documents
    const tenantBDocs = await documentsService.listDocuments(tenantBId, draft.uuid);
    expect(tenantBDocs.length).toBe(0);
    await expect(
      documentsService.downloadDocument(tenantBId, userB, uploaded.document.id),
    ).rejects.toThrow(NotFoundException);
    await expect(
      documentsService.verifyDocumentIntegrity(tenantBId, userB, uploaded.document.id),
    ).rejects.toThrow(NotFoundException);
  });

  it('Automatically generates final signed PDF & completion certificate when Signing Engine completes agreement, and detects tampering', async () => {
    const draft = await agreementsService.createAgreement(tenantAId, userA, {
      recipient_name: 'Final Signer',
      recipient_email: 'finalsigner@example.com',
      template_type: 'MSA',
      department: 'Sales',
      fee_amount: 5000,
      period: '24 months',
      content: 'Master Services Agreement for final signed PDF & certificate test.',
      sign_method: 'basic_drawn',
      initial_status: 'Draft',
    });
    createdAgreementUuids.push(draft.uuid);

    const req = await signingService.createSigningRequest(
      tenantAId,
      userA,
      {
        agreement_id: draft.uuid,
        sequential: true,
        recipients: [{ name: 'Final Signer', email: 'finalsigner@example.com', signing_order: 1, is_required: true }],
      },
      'https://gsign01.vercel.app',
    );
    const rec = req.recipients[0];

    // Insert known OTP directly & verify
    const otpHash = crypto.createHash('sha256').update('777888').digest('hex');
    await db.executeWithTenantContext(tenantAId, async (client) => {
      await client.query(
        `INSERT INTO signing_otp_attempts (tenant_id, recipient_id, otp_hash, attempts, max_attempts, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::varchar, 0, 5, NOW() + INTERVAL '10 minutes')`,
        [tenantAId, rec.id, otpHash],
      );
    });
    await signingService.verifyOtp(rec.signing_token, '777888', '127.0.0.1');

    // Submit signature -> completes agreement & auto-generates signed PDF + completion certificate
    const signRes: any = await signingService.submitSignature(
      rec.signing_token,
      {
        signature_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        consent_accepted: true,
        consent_text: 'I consent to sign electronically.',
      },
      '127.0.0.1',
      'JestTest',
    );
    expect(signRes.agreement_completed).toBe(true);
    expect(signRes.certificate_number).toMatch(/^CERT-/);
    expect(signRes.signed_document_id).toBeTruthy();

    // Verify certificate and signed PDF exist and pass integrity verification
    const certs = await documentsService.listCertificates(tenantAId, draft.uuid);
    expect(certs.length).toBe(1);
    expect(certs[0].certificate_number).toBe(signRes.certificate_number);

    const verifySigned = await documentsService.verifyDocumentIntegrity(
      tenantAId,
      userA,
      signRes.signed_document_id,
    );
    expect(verifySigned.verified).toBe(true);

    // Tamper detection test on local_private vault file
    const docs = await documentsService.listDocuments(tenantAId, draft.uuid);
    const signedDoc = docs.find((d) => d.id === signRes.signed_document_id);
    expect(signedDoc).toBeTruthy();
    const versionRow = await db.executeWithTenantContext(tenantAId, async (client) => {
      const r = await client.query(`SELECT * FROM document_versions WHERE document_id = $1::uuid LIMIT 1`, [signedDoc.id]);
      return r.rows[0];
    });
    if (versionRow.storage_provider === 'local_private') {
      const localRoot = process.env.LOCAL_STORAGE_ROOT?.trim() || path.resolve(process.cwd(), '.local_storage');
      const fullPath = path.resolve(localRoot, versionRow.storage_key);
      await fs.appendFile(fullPath, Buffer.from('\n%TAMPERED'));

      const tamperedCheck = await documentsService.verifyDocumentIntegrity(tenantAId, userA, signedDoc.id);
      expect(tamperedCheck.verified).toBe(false);

      await expect(
        documentsService.downloadDocument(tenantAId, userA, signedDoc.id),
      ).rejects.toThrow(InternalServerErrorException);
    }
  });
});
