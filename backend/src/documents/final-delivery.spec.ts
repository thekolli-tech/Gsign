import { BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { DocumentsService } from './documents.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { SigningController } from '../signing/signing.controller';
import { SigningService } from '../signing/signing.service';

function extractPdfText(pdfBytes: Buffer): string {
  const raw = pdfBytes.toString('latin1');
  const chunks: string[] = [];
  const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const streamBuf = Buffer.from(match[1], 'latin1');
    let text = match[1];
    try {
      text = zlib.inflateSync(streamBuf).toString('latin1');
    } catch {
      // keep raw
    }
    text = text.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) =>
      Buffer.from(hex, 'hex').toString('latin1'),
    );
    chunks.push(text);
  }
  return chunks.join('\n');
}

describe('Phase 5F — Final Signed PDF Generation, Recipient Download & Integrity Verification', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const agreementId = '22222222-2222-4222-8222-222222222222';
  const reqId = '33333333-3333-4333-8333-333333333333';
  const rec1Id = '44444444-4444-4444-8444-444444444444';
  const rec2Id = '55555555-5555-4555-8555-555555555555';

  // Valid 1x1 transparent PNG data URL
  const samplePngDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const pdfGenerator = new PdfGeneratorService();

  it('generates real signed PDF bytes with sequential recipients, embedded signature/thumb PNGs, and SHA-256 hash', async () => {
    const pdfBytes = await pdfGenerator.generateSignedAgreementPdf({
      agreement: {
        agreement_number: 'AGR-2026-5001',
        template_type: 'Service Contract',
        department: 'Legal',
        status: 'Completed',
        recipient_name: 'Alice',
        recipient_email: 'alice@acme.in',
        content: 'Master services terms between Acme Corp and Vendor.',
        document_hash: 'root-content-hash-xyz',
        completed_at: '2026-03-10T12:00:00.000Z',
      },
      tenantName: 'Acme Corp',
      recipients: [
        {
          id: rec1Id,
          name: 'Alice',
          email: 'alice@acme.in',
          signing_order: 1,
          status: 'signed',
          sign_method: 'otp_verified',
          otp_verified_at: '2026-03-10T11:50:00.000Z',
        },
        {
          id: rec2Id,
          name: 'Bob',
          email: 'bob@vendor.in',
          signing_order: 2,
          status: 'signed',
          sign_method: 'digital_thumb_impression',
          otp_verified_at: '2026-03-10T11:55:00.000Z',
        },
      ],
      signatures: [
        {
          recipient_id: rec1Id,
          signature_data_url: samplePngDataUrl,
          signed_at: '2026-03-10T11:52:00.000Z',
          ip_address: '10.1.1.1',
        },
        {
          recipient_id: rec2Id,
          signature_data_url: samplePngDataUrl,
          signed_at: '2026-03-10T11:58:00.000Z',
          ip_address: '10.1.1.2',
        },
      ],
      consents: [
        { recipient_id: rec1Id, accepted: true, consented_at: '2026-03-10T11:51:00.000Z' },
        { recipient_id: rec2Id, accepted: true, consented_at: '2026-03-10T11:57:00.000Z' },
      ],
      fields: [
        { id: 'f1', type: 'Signature', label: 'Primary Signature', page: 1, x: 10, y: 80, width: 25, height: 8, value: 'Alice' },
      ],
    });

    expect(Buffer.isBuffer(pdfBytes)).toBe(true);
    expect(pdfBytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = extractPdfText(pdfBytes);
    expect(text).toContain('Service Contract');
    expect(text).toContain('AGR-2026-5001');
    expect(text).toContain('#1 Alice (alice@acme.in)');
    expect(text).toContain('#2 Bob (bob@vendor.in)');
    expect(text).toContain('digital_thumb_impression');
    expect(text).toContain('Root Agreement SHA-256: root-content-hash-xyz');
  });

  it('delivers vaulted Completed PDF with byte-level SHA-256 verification and rejects tampered bytes', async () => {
    const validPdf = await pdfGenerator.generateSignedAgreementPdf({
      agreement: {
        agreement_number: 'AGR-2026-5002',
        template_type: 'NDA',
        department: 'Legal',
        status: 'Completed',
        recipient_name: 'Alice',
        recipient_email: 'alice@acme.in',
        content: 'Confidentiality terms.',
        document_hash: 'root-hash-2',
      },
      tenantName: 'Acme Corp',
      recipients: [{ id: rec1Id, name: 'Alice', email: 'alice@acme.in', signing_order: 1, status: 'signed', sign_method: 'basic_drawn' }],
      signatures: [{ recipient_id: rec1Id, signature_data_url: samplePngDataUrl, signed_at: '2026-03-10T12:00:00Z' }],
      consents: [{ recipient_id: rec1Id, accepted: true }],
    });
    const expectedSha = crypto.createHash('sha256').update(validPdf).digest('hex');

    const queries: string[] = [];
    const dbMock: any = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string) => {
            queries.push(sql);
            if (sql.includes('FROM agreements')) {
              return { rows: [{ id: agreementId, agreement_number: 'AGR-2026-5002', status: 'Completed' }] };
            }
            if (sql.includes('FROM document_versions')) {
              return {
                rows: [
                  {
                    version_id: 'ver-1',
                    document_id: 'doc-1',
                    file_name: 'AGR-2026-5002_signed_final.pdf',
                    mime_type: 'application/pdf',
                    sha256_hash: expectedSha,
                    storage_provider: 'local',
                    storage_bucket: 'gsign-private',
                    storage_key: 'tenant/agr/final.pdf',
                  },
                ],
              };
            }
            return { rows: [] };
          }),
        }),
      ),
    };

    const storageOk: any = { getPrivateObjectBuffer: jest.fn(async () => validPdf) };
    const serviceOk = new DocumentsService(dbMock, storageOk, pdfGenerator);
    const res = await serviceOk.prepareRecipientDocumentDownload({
      tenantId,
      agreementId,
      signingRequestId: reqId,
      recipientEmail: 'alice@acme.in',
      kind: 'signed_pdf',
      ip: '127.0.0.1',
    });
    expect(res.integrityVerified).toBe(true);
    expect(res.sha256Hash).toBe(expectedSha);
    expect(res.documentStatus).toBe('Completed');
    expect(res.buffer.equals(validPdf)).toBe(true);
    expect(queries.some((q) => q.includes('INSERT INTO document_access_logs'))).toBe(true);

    // Tampered storage bytes must fail SHA-256 check
    const storageTampered: any = { getPrivateObjectBuffer: jest.fn(async () => Buffer.from('tampered-bytes')) };
    const serviceTampered = new DocumentsService(dbMock, storageTampered, pdfGenerator);
    await expect(
      serviceTampered.prepareRecipientDocumentDownload({
        tenantId,
        agreementId,
        signingRequestId: reqId,
        recipientEmail: 'alice@acme.in',
        kind: 'signed_pdf',
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('generates server-side Partially signed PDF (never Completed) and blocks certificates/downloads on Rejected or Cancelled agreements', async () => {
    const partialDb: any = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM agreements')) {
              return {
                rows: [
                  {
                    id: agreementId,
                    agreement_number: 'AGR-2026-5003',
                    template_type: 'Offer Letter',
                    department: 'HR',
                    status: 'Partially signed',
                    recipient_name: 'Alice',
                    recipient_email: 'alice@acme.in',
                    content: 'Offer details.',
                    document_hash: 'root-hash-3',
                  },
                ],
              };
            }
            if (sql.includes('FROM tenants')) return { rows: [{ name: 'Acme Corp' }] };
            if (sql.includes('FROM signing_recipients')) {
              return {
                rows: [
                  { id: rec1Id, name: 'Alice', email: 'alice@acme.in', signing_order: 1, status: 'signed', sign_method: 'basic_drawn' },
                  { id: rec2Id, name: 'Bob', email: 'bob@acme.in', signing_order: 2, status: 'PENDING', sign_method: 'otp_verified' },
                ],
              };
            }
            if (sql.includes('FROM signature_records')) {
              return { rows: [{ recipient_id: rec1Id, signature_data_url: samplePngDataUrl, signed_at: '2026-03-10T10:00:00Z' }] };
            }
            if (sql.includes('FROM consent_records')) {
              return { rows: [{ recipient_id: rec1Id, accepted: true }] };
            }
            return { rows: [] };
          }),
        }),
      ),
    };

    const docService = new DocumentsService(partialDb, {} as any, pdfGenerator);
    const partialPdf = await docService.prepareRecipientDocumentDownload({
      tenantId,
      agreementId,
      signingRequestId: reqId,
      recipientEmail: 'alice@acme.in',
      kind: 'signed_pdf',
    });
    expect(partialPdf.documentStatus).toBe('Partially signed');
    expect(partialPdf.fileName).toBe('AGR-2026-5003_partially_signed.pdf');
    expect(extractPdfText(partialPdf.buffer)).toContain('Status: Partially signed');

    // Certificate must be blocked for partially signed agreement
    await expect(
      docService.prepareRecipientDocumentDownload({
        tenantId,
        agreementId,
        signingRequestId: reqId,
        recipientEmail: 'alice@acme.in',
        kind: 'certificate',
      }),
    ).rejects.toThrow(BadRequestException);

    // Rejected & Cancelled agreements must block both signed_pdf and certificate downloads
    for (const blockedStatus of ['Rejected', 'Cancelled']) {
      const blockedDb: any = {
        executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
          fn({
            query: jest.fn(async () => ({ rows: [{ id: agreementId, status: blockedStatus }] })),
          }),
        ),
      };
      const blockedService = new DocumentsService(blockedDb, {} as any, pdfGenerator);
      await expect(
        blockedService.prepareRecipientDocumentDownload({
          tenantId,
          agreementId,
          signingRequestId: reqId,
          recipientEmail: 'alice@acme.in',
          kind: 'certificate',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        blockedService.prepareRecipientDocumentDownload({
          tenantId,
          agreementId,
          signingRequestId: reqId,
          recipientEmail: 'alice@acme.in',
          kind: 'signed_pdf',
        }),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('rejects expired or revoked recipient tokens on download and streams headers on valid download', async () => {
    const expiredDb: any = {
      executeAsSuperAdmin: jest.fn(async (fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async () => ({
            rows: [{ id: rec1Id, tenant_id: tenantId, signing_request_id: reqId, agreement_id: agreementId }],
          })),
        }),
      ),
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM signing_recipients')) {
              return {
                rows: [
                  {
                    id: rec1Id,
                    email: 'alice@acme.in',
                    token_expires_at: '2020-01-01T00:00:00Z',
                    revoked_at: null,
                  },
                ],
              };
            }
            if (sql.includes('FROM signing_requests')) {
              return { rows: [{ id: reqId, status: 'ACTIVE', expires_at: '2020-01-01T00:00:00Z', revoked_at: null }] };
            }
            return { rows: [] };
          }),
        }),
      ),
    };
    const signingService = new SigningService(
      expiredDb,
      { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) } as any,
      { prepareRecipientDocumentDownload: jest.fn() } as any,
    );
    await expect(signingService.downloadRecipientDocument('expired-token-1234567890', 'signed_pdf')).rejects.toThrow(
      BadRequestException,
    );

    // Controller header streaming check
    const headers: Record<string, string> = {};
    const resMock: any = {
      setHeader: jest.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      send: jest.fn((buf: Buffer) => buf),
    };
    const controller = new SigningController({
      downloadRecipientDocument: jest.fn(async () => ({
        buffer: Buffer.from('%PDF-1.7 ok'),
        fileName: 'final.pdf',
        mimeType: 'application/pdf',
        sha256Hash: 'abc123',
        documentStatus: 'Completed',
        integrityVerified: true,
      })),
    } as any);
    await controller.downloadDocument('tok', 'signed_pdf', { ip: '127.0.0.1', headers: {} } as any, resMock);
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['X-Document-SHA256']).toBe('abc123');
    expect(headers['X-Document-Status']).toBe('Completed');
    expect(headers['X-Integrity-Verified']).toBe('true');
  });
});
