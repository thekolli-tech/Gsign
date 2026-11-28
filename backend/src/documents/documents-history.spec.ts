import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfGeneratorService } from './pdf-generator.service';

function extractPdfTextContent(pdfBytes: Buffer): string {
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
      // keep raw text
    }
    text = text.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) =>
      Buffer.from(hex, 'hex').toString('latin1'),
    );
    chunks.push(text);
  }
  return chunks.join('\n');
}

describe('Phase 5E — Document History, Completion Certificate & Access Control', () => {
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const docId = '33333333-3333-4333-8333-333333333333';
  const versionId = '44444444-4444-4444-8444-444444444444';
  const userA = { id: '55555555-5555-4555-8555-555555555555', email: 'admin@tenanta.in' };
  const samplePdfBytes = Buffer.from('%PDF-1.7 test', 'utf8');
  const samplePdfSha256 = crypto.createHash('sha256').update(samplePdfBytes).digest('hex');

  describe('PdfGeneratorService.generateCompletionCertificatePdf', () => {
    const pdfService = new PdfGeneratorService();
    const baseAgreement = {
      agreement_number: 'AGR-2026-0999',
      template_type: 'NDA',
      department: 'Legal',
      document_hash: 'sha256-content-hash-abc123',
      status: 'Completed',
    };

    it('distinguishes Fully Signed, Partially Signed, and Rejected certificates with non-legal-validity notice', async () => {
      const fullBytes = await pdfService.generateCompletionCertificatePdf({
        agreement: { ...baseAgreement, status: 'Completed' },
        tenantName: 'Acme Corp',
        certificateNumber: 'CERT-2026-0001',
        finalPdfSha256: 'final-hash-1',
        recipients: [
          { name: 'Alice', email: 'alice@acme.in', signing_order: 1, status: 'signed' },
          { name: 'Bob', email: 'bob@acme.in', signing_order: 2, status: 'signed' },
        ],
        signatures: [],
        consents: [],
      });
      const fullText = extractPdfTextContent(fullBytes);
      expect(fullText).toContain('Agreement Completion Status: Fully Signed (2/2 signed)');
      expect(fullText).toContain('not independent proof of legal validity');

      const partialBytes = await pdfService.generateCompletionCertificatePdf({
        agreement: { ...baseAgreement, status: 'Partially signed' },
        tenantName: 'Acme Corp',
        certificateNumber: 'CERT-2026-0002',
        finalPdfSha256: 'final-hash-2',
        recipients: [
          { name: 'Alice', email: 'alice@acme.in', signing_order: 1, status: 'signed' },
          { name: 'Bob', email: 'bob@acme.in', signing_order: 2, status: 'pending' },
        ],
        signatures: [],
        consents: [],
      });
      expect(extractPdfTextContent(partialBytes)).toContain(
        'Agreement Completion Status: Partially Signed (1/2 signed)',
      );

      const rejectedBytes = await pdfService.generateCompletionCertificatePdf({
        agreement: { ...baseAgreement, status: 'Rejected' },
        tenantName: 'Acme Corp',
        certificateNumber: 'CERT-2026-0003',
        finalPdfSha256: 'final-hash-3',
        recipients: [
          { name: 'Alice', email: 'alice@acme.in', signing_order: 1, status: 'signed' },
          { name: 'Bob', email: 'bob@acme.in', signing_order: 2, status: 'rejected' },
        ],
        signatures: [],
        consents: [],
      });
      expect(extractPdfTextContent(rejectedBytes)).toContain(
        'Agreement Completion Status: Rejected (1/2 signed)',
      );
    });
  });

  describe('DocumentsController & DocumentsService access control & download logging', () => {
    function makeService(ownerTenant: string) {
      const queries: Array<{ sql: string; values: any[] }> = [];
      const dbMock: any = {
        executeWithTenantContext: jest.fn(async (tid: string, fn: (client: any) => Promise<any>) =>
          fn({
            query: jest.fn(async (sql: string, values: any[] = []) => {
              queries.push({ sql, values });
              if (sql.includes('FROM document_access_logs')) {
                return values[0] === ownerTenant
                  ? {
                      rows: [
                        { id: 'log-2', action: 'DOWNLOAD', actor_email: 'admin@tenanta.in', created_at: '2026-02-02T10:00:00Z' },
                        { id: 'log-1', action: 'UPLOAD', actor_email: 'admin@tenanta.in', created_at: '2026-02-01T10:00:00Z' },
                      ],
                    }
                  : { rows: [] };
              }
              if (sql.includes('FROM document_versions')) {
                return values[values.length - 1] === ownerTenant
                  ? {
                      rows: [
                        {
                          id: versionId,
                          document_id: docId,
                          tenant_id: ownerTenant,
                          file_name: 'signed.pdf',
                          mime_type: 'application/pdf',
                          storage_provider: 'local',
                          storage_bucket: 'gsign-private',
                          storage_key: 'tenant/doc/signed.pdf',
                          sha256_hash: samplePdfSha256,
                        },
                      ],
                    }
                  : { rows: [] };
              }
              return { rows: [] };
            }),
          }),
        ),
      };
      const storageMock: any = {
        getPrivateObjectBuffer: jest.fn(async () => samplePdfBytes),
      };
      const service = new DocumentsService(dbMock, storageMock, {} as any);
      return { service, controller: new DocumentsController(service), queries };
    }

    it('rejects requests without tenant workspace context (e.g. Platform Owner or unauthenticated tenant)', async () => {
      const { controller } = makeService(tenantA);
      const req: any = { ip: '127.0.0.1', headers: {} };

      await expect(controller.list(null)).rejects.toThrow(ForbiddenException);
      await expect(controller.listCertificates(null)).rejects.toThrow(ForbiddenException);
      await expect(controller.auditLogs(null, docId)).rejects.toThrow(ForbiddenException);
      await expect(controller.download(null, userA, docId, undefined, undefined, req, {} as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('isolates cross-tenant audit log and download access', async () => {
      const { service } = makeService(tenantA);

      await expect(service.getDocumentAccessLogs(tenantB, docId)).resolves.toEqual([]);
      await expect(
        service.downloadDocument(tenantB, userA, docId, versionId, undefined, '127.0.0.1', 'jest'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns audit logs for owning tenant and records DOWNLOAD access on authorized download', async () => {
      const { service, queries } = makeService(tenantA);

      const logs = await service.getDocumentAccessLogs(tenantA, docId);
      expect(logs).toHaveLength(2);
      expect(logs[0].action).toBe('DOWNLOAD');

      const dl = await service.downloadDocument(tenantA, userA, docId, versionId, undefined, '127.0.0.1', 'jest');
      expect(dl.file_name).toBe('signed.pdf');
      expect(dl.buffer?.toString('utf8')).toContain('%PDF-1.7');
      expect(
        queries.some((q) => q.sql.includes('INSERT INTO document_access_logs') && q.sql.includes("'DOWNLOAD'")),
      ).toBe(true);
    });
  });
});
