import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import * as crypto from 'crypto';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsService & DocumentsController — Integrity & Authorization (Mocked)', () => {
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const docId = '33333333-3333-4333-8333-333333333333';
  const versionId = '44444444-4444-4444-8444-444444444444';
  const userA = { id: '55555555-5555-4555-8555-555555555555', email: 'admin@tenanta.in' };

  const sampleBytes = Buffer.from('%PDF-1.7 sample vaulted bytes', 'utf8');
  const sampleSha256 = crypto.createHash('sha256').update(sampleBytes).digest('hex');

  function makeService(params: {
    versionRow: any | null;
    storageImpl?: () => Promise<Buffer>;
  }) {
    const queries: Array<{ sql: string; values: any[] }> = [];
    const dbMock: any = {
      executeWithTenantContext: jest.fn(async (tid: string, fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string, values: any[] = []) => {
            queries.push({ sql, values });
            if (sql.includes('FROM document_versions')) {
              // Enforce tenant filter in mock just like RLS + WHERE tenant_id = $3
              const requestedTenant = values[values.length - 1];
              if (!params.versionRow || params.versionRow.tenant_id !== requestedTenant) {
                return { rows: [] };
              }
              return { rows: [params.versionRow] };
            }
            return { rows: [] };
          }),
        }),
      ),
    };
    const storageMock: any = {
      getPrivateObjectBuffer: jest.fn(
        params.storageImpl ?? (async () => sampleBytes),
      ),
    };
    const pdfMock: any = {};
    const service = new DocumentsService(dbMock, storageMock, pdfMock);
    return { service, dbMock, storageMock, queries };
  }

  it('returns verified=true when server-hashed bytes match persisted version sha256_hash and logs VERIFY_INTEGRITY', async () => {
    const { service, queries } = makeService({
      versionRow: {
        id: versionId,
        document_id: docId,
        tenant_id: tenantA,
        version_number: 1,
        storage_provider: 'local',
        storage_bucket: 'gsign-private',
        storage_key: 'tenant/doc/v1.pdf',
        sha256_hash: sampleSha256,
      },
    });

    const res = await service.verifyDocumentIntegrity(tenantA, userA, docId, versionId, '127.0.0.1', 'jest');
    expect(res.verified).toBe(true);
    expect(res.expected_sha256).toBe(sampleSha256);
    expect(res.actual_sha256).toBe(sampleSha256);
    expect(res.version_id).toBe(versionId);
    expect(queries.some((q) => q.sql.includes("INSERT INTO document_access_logs") && q.sql.includes("'VERIFY_INTEGRITY'"))).toBe(true);
  });

  it('returns verified=false on SHA-256 mismatch', async () => {
    const { service } = makeService({
      versionRow: {
        id: versionId,
        document_id: docId,
        tenant_id: tenantA,
        version_number: 1,
        storage_provider: 'local',
        storage_bucket: 'gsign-private',
        storage_key: 'tenant/doc/v1.pdf',
        sha256_hash: '0'.repeat(64),
      },
    });

    const res = await service.verifyDocumentIntegrity(tenantA, userA, docId, versionId);
    expect(res.verified).toBe(false);
    expect(res.actual_sha256).toBe(sampleSha256);
    expect(res.expected_sha256).toBe('0'.repeat(64));
  });

  it('fails closed (verified=false) when persisted sha256_hash is null or empty', async () => {
    const { service } = makeService({
      versionRow: {
        id: versionId,
        document_id: docId,
        tenant_id: tenantA,
        version_number: 1,
        storage_provider: 'local',
        storage_bucket: 'gsign-private',
        storage_key: 'tenant/doc/v1.pdf',
        sha256_hash: null,
      },
    });

    const res = await service.verifyDocumentIntegrity(tenantA, userA, docId, versionId);
    expect(res.verified).toBe(false);
  });

  it('throws NotFoundException when document version is missing or belongs to another tenant', async () => {
    const { service: missingSvc } = makeService({ versionRow: null });
    await expect(missingSvc.verifyDocumentIntegrity(tenantA, userA, docId, versionId)).rejects.toThrow(
      NotFoundException,
    );

    const { service: crossTenantSvc } = makeService({
      versionRow: {
        id: versionId,
        document_id: docId,
        tenant_id: tenantA,
        version_number: 1,
        storage_provider: 'local',
        storage_bucket: 'gsign-private',
        storage_key: 'tenant/doc/v1.pdf',
        sha256_hash: sampleSha256,
      },
    });

    await expect(
      crossTenantSvc.verifyDocumentIntegrity(tenantB, { id: 'user-b', email: 'b@tenantb.in' }, docId, versionId),
    ).rejects.toThrow(NotFoundException);
  });

  it('propagates storage failure and never returns verified=true when storage object is inaccessible', async () => {
    const { service } = makeService({
      versionRow: {
        id: versionId,
        document_id: docId,
        tenant_id: tenantA,
        version_number: 1,
        storage_provider: 'r2',
        storage_bucket: 'gsign-private',
        storage_key: 'tenant/doc/v1.pdf',
        sha256_hash: sampleSha256,
      },
      storageImpl: async () => {
        throw new InternalServerErrorException('Object not found in private vault.');
      },
    });

    await expect(service.verifyDocumentIntegrity(tenantA, userA, docId, versionId)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('enforces AuthGuard, SubscriptionGuard, PermissionsGuard, and tenant context on DocumentsController.verify', async () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, DocumentsController);
    expect(classGuards).toEqual(expect.arrayContaining([AuthGuard, SubscriptionGuard, PermissionsGuard]));

    const permissions = Reflect.getMetadata('permissions', DocumentsController.prototype.verify);
    expect(permissions).toEqual(['agreement:read']);

    const controller = new DocumentsController({ verifyDocumentIntegrity: jest.fn() } as any);
    await expect(
      controller.verify(null, userA, docId, versionId, { ip: '127.0.0.1', headers: {} } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
