import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { UploadDocumentDto } from './dto/documents.dto';
import { PdfGeneratorService } from './pdf-generator.service';
import { StorageService, StoredObjectResult } from './storage.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  private sha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private sanitizeFileName(name: string): string {
    const base = (name || 'document.pdf').split(/[\\/]/).pop() || 'document.pdf';
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }

  private buildStorageKey(tenantId: string, scopeId: string, fileName: string): string {
    return `${tenantId}/${scopeId}/${crypto.randomUUID()}-${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Validates actual file magic bytes rather than trusting client-supplied Content-Type.
   */
  private detectAndValidateMimeType(
    buffer: Buffer,
    declaredMime: string,
    originalName: string,
  ): string {
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
      return 'application/pdf';
    }
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      buffer.length >= 4 &&
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
      originalName.toLowerCase().endsWith('.docx')
    ) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (declaredMime === 'text/plain' && !buffer.includes(0)) {
      return 'text/plain';
    }

    throw new BadRequestException(
      'File content failed magic-byte validation. Allowed formats: valid PDF, PNG, JPEG, DOCX, or UTF-8 TXT.',
    );
  }

  private async incrementStorageUsage(
    client: PoolClient,
    tenantId: string,
    bytes: number,
  ): Promise<void> {
    if (bytes <= 0) return;
    await client.query(
      `INSERT INTO usage_records (tenant_id, period_start, period_end, storage_bytes_used)
       VALUES (
         $1::uuid,
         date_trunc('month', CURRENT_DATE)::date,
         (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
         $2::bigint
       )
       ON CONFLICT (tenant_id, period_start)
       DO UPDATE SET
         storage_bytes_used = usage_records.storage_bytes_used + EXCLUDED.storage_bytes_used,
         updated_at = NOW()`,
      [tenantId, bytes],
    );
  }

  private async compensateStorageObjects(
    tenantId: string,
    objects: StoredObjectResult[],
    reason: string,
  ): Promise<void> {
    for (const obj of objects) {
      try {
        // Never delete an object that is already referenced by another document version
        const refCheck = await this.db.executeWithTenantContext(tenantId, async (client) => {
          const res = await client.query(
            `SELECT 1 FROM document_versions WHERE storage_key = $1::text LIMIT 1`,
            [obj.key],
          );
          return res.rows.length > 0;
        });

        if (refCheck) {
          continue;
        }

        await this.storage.deletePrivateObject(obj.provider, obj.bucket, obj.key);
      } catch (cleanupErr) {
        const message = (cleanupErr as Error).message || 'Unknown cleanup error';
        this.logger.error(
          `Compensating storage cleanup failed for ${obj.key}: ${message}`,
        );
        try {
          await this.db.executeWithTenantContext(tenantId, async (client) => {
            await client.query(
              `INSERT INTO storage_cleanup_tasks (
                 tenant_id, storage_provider, storage_bucket, storage_key, reason, status, attempts, last_error
               ) VALUES ($1::uuid, $2::varchar, $3::varchar, $4::text, $5::text, 'FAILED', 1, $6::text)`,
              [tenantId, obj.provider, obj.bucket, obj.key, reason, message],
            );
          });
        } catch (dbLogErr) {
          this.logger.error(
            `Failed to persist storage_cleanup_tasks record for ${obj.key}: ${(dbLogErr as Error).message}`,
          );
        }
      }
    }
  }

  async uploadOriginalDocument(
    tenantId: string,
    user: { id: string; email?: string; role?: string },
    file: Express.Multer.File,
    dto: UploadDocumentDto,
    ip?: string,
    userAgent?: string,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('A non-empty file is required.');
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new BadRequestException('Maximum file size is 15 MB.');
    }

    const verifiedMimeType = this.detectAndValidateMimeType(
      file.buffer,
      file.mimetype,
      file.originalname,
    );

    // Validate DB reference & authorization BEFORE uploading to storage
    if (dto.agreement_id) {
      await this.db.executeWithTenantContext(tenantId, async (client) => {
        const agrCheck = await client.query(
          `SELECT id FROM agreements WHERE id = $1::uuid AND tenant_id = $2::uuid`,
          [dto.agreement_id, tenantId],
        );
        if (agrCheck.rows.length === 0) {
          throw new NotFoundException('Target agreement not found in this tenant.');
        }
      });
    }

    const sha256Hash = this.sha256(file.buffer);
    const scopeId = dto.agreement_id || 'standalone';
    const key = this.buildStorageKey(tenantId, scopeId, file.originalname);
    const stored = await this.storage.putPrivateObject(key, file.buffer, verifiedMimeType, {
      tenantId,
      sha256: sha256Hash,
    });

    try {
      return await this.db.executeWithTenantContext(tenantId, async (client) => {
        const docTitle = dto.title?.trim() || this.sanitizeFileName(file.originalname);
        const docKind = dto.doc_kind?.trim() || 'original';

        const docRes = await client.query(
          `INSERT INTO documents (tenant_id, agreement_id, created_by, title, doc_kind, current_version, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::varchar, $5::varchar, 1, 'ACTIVE')
           RETURNING *`,
          [tenantId, dto.agreement_id || null, user.id, docTitle, docKind],
        );
        const doc = docRes.rows[0];

        const verRes = await client.query(
          `INSERT INTO document_versions (
             tenant_id, document_id, agreement_id, version_number, version_kind,
             file_name, mime_type, byte_size, sha256_hash,
             storage_provider, storage_bucket, storage_key, is_immutable, created_by
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, 1, $4::varchar,
             $5::varchar, $6::varchar, $7::bigint, $8::varchar,
             $9::varchar, $10::varchar, $11::text, TRUE, $12::uuid
           )
           RETURNING *`,
          [
            tenantId,
            doc.id,
            dto.agreement_id || null,
            docKind,
            this.sanitizeFileName(file.originalname),
            verifiedMimeType,
            stored.byteSize,
            sha256Hash,
            stored.provider,
            stored.bucket,
            stored.key,
            user.id,
          ],
        );
        const version = verRes.rows[0];

        await this.incrementStorageUsage(client, tenantId, stored.byteSize);

        await client.query(
          `INSERT INTO document_access_logs (tenant_id, document_id, document_version_id, actor_id, actor_email, action, ip_address, user_agent)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, 'UPLOAD', $6::varchar, $7::text)`,
          [
            tenantId,
            doc.id,
            version.id,
            user.id,
            user.email || 'system@gsign.in',
            ip || null,
            userAgent || null,
          ],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, metadata, ip_address, user_agent)
           VALUES ($1::uuid, $2::varchar, $3::varchar, 'DOCUMENT_UPLOADED', 'document', $4::varchar, $5::uuid, $6::jsonb, $7::varchar, $8::text)`,
          [
            user.id,
            user.email || 'system@gsign.in',
            user.role || 'Company Admin',
            doc.id,
            tenantId,
            JSON.stringify({
              agreement_id: dto.agreement_id || null,
              sha256_hash: sha256Hash,
              byte_size: stored.byteSize,
              storage_provider: stored.provider,
              verified_mime: verifiedMimeType,
            }),
            ip || null,
            userAgent || null,
          ],
        );

        if (dto.agreement_id) {
          await client.query(
            `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'Original Document Uploaded', $4::text, 'pdf', $5::varchar, $6::varchar)`,
            [
              tenantId,
              dto.agreement_id,
              user.id,
              `Uploaded ${this.sanitizeFileName(file.originalname)} (${stored.byteSize} bytes)`,
              ip || null,
              sha256Hash,
            ],
          );
        }

        return { document: doc, version };
      });
    } catch (err) {
      await this.compensateStorageObjects(
        tenantId,
        [stored],
        `uploadOriginalDocument DB failure: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async generateAgreementPdf(
    tenantId: string,
    user: { id: string; email?: string; role?: string },
    agreementId: string,
    customTitle?: string,
    ip?: string,
    userAgent?: string,
  ) {
    const context = await this.db.executeWithTenantContext(tenantId, async (client) => {
      const agrRes = await client.query(
        `SELECT * FROM agreements WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [agreementId, tenantId],
      );
      const agreement = agrRes.rows[0];
      if (!agreement) {
        throw new NotFoundException('Agreement not found.');
      }

      const tenantRes = await client.query(
        `SELECT name FROM tenants WHERE id = $1::uuid`,
        [tenantId],
      );
      const tenantName = tenantRes.rows[0]?.name || 'GSIGN Enterprise';

      const existingDocRes = await client.query(
        `SELECT * FROM documents
         WHERE agreement_id = $1::uuid AND tenant_id = $2::uuid AND doc_kind = 'generated_pdf'
         ORDER BY created_at ASC LIMIT 1`,
        [agreementId, tenantId],
      );

      return {
        agreement,
        tenantName,
        existingDoc: existingDocRes.rows[0] || null,
      };
    });

    const pdfBuffer = await this.pdfGenerator.generateAgreementPdf({
      agreement: context.agreement,
      tenantName: context.tenantName,
    });
    const sha256Hash = this.sha256(pdfBuffer);
    const fileName = `${context.agreement.agreement_number}_agreement.pdf`;
    const key = this.buildStorageKey(tenantId, agreementId, fileName);
    const stored = await this.storage.putPrivateObject(key, pdfBuffer, 'application/pdf', {
      tenantId,
      agreementId,
      sha256: sha256Hash,
    });

    try {
      return await this.db.executeWithTenantContext(tenantId, async (client) => {
        let doc = context.existingDoc;
        let nextVersion = 1;

        if (!doc) {
          const docRes = await client.query(
            `INSERT INTO documents (tenant_id, agreement_id, created_by, title, doc_kind, current_version, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::varchar, 'generated_pdf', 1, 'ACTIVE')
             RETURNING *`,
            [
              tenantId,
              agreementId,
              user.id,
              customTitle?.trim() || `${context.agreement.agreement_number} — Agreement PDF`,
            ],
          );
          doc = docRes.rows[0];
        } else {
          const updRes = await client.query(
            `UPDATE documents
             SET current_version = current_version + 1, updated_at = NOW()
             WHERE id = $1::uuid
             RETURNING *`,
            [doc.id],
          );
          doc = updRes.rows[0];
          nextVersion = doc.current_version;
        }

        const verRes = await client.query(
          `INSERT INTO document_versions (
             tenant_id, document_id, agreement_id, version_number, version_kind,
             file_name, mime_type, byte_size, sha256_hash,
             storage_provider, storage_bucket, storage_key, is_immutable, created_by
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::integer, 'generated_pdf',
             $5::varchar, 'application/pdf', $6::bigint, $7::varchar,
             $8::varchar, $9::varchar, $10::text, TRUE, $11::uuid
           )
           RETURNING *`,
          [
            tenantId,
            doc.id,
            agreementId,
            nextVersion,
            fileName,
            stored.byteSize,
            sha256Hash,
            stored.provider,
            stored.bucket,
            stored.key,
            user.id,
          ],
        );
        const version = verRes.rows[0];

        await this.incrementStorageUsage(client, tenantId, stored.byteSize);

        await client.query(
          `INSERT INTO document_access_logs (tenant_id, document_id, document_version_id, actor_id, actor_email, action, ip_address, user_agent)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, 'GENERATE_PDF', $6::varchar, $7::text)`,
          [
            tenantId,
            doc.id,
            version.id,
            user.id,
            user.email || 'system@gsign.in',
            ip || null,
            userAgent || null,
          ],
        );

        await client.query(
          `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'Agreement PDF Generated', $4::text, 'pdf', $5::varchar, $6::varchar)`,
          [
            tenantId,
            agreementId,
            user.id,
            `Server-side PDF v${nextVersion} generated (${stored.byteSize} bytes)`,
            ip || null,
            sha256Hash,
          ],
        );

        return { document: doc, version };
      });
    } catch (err) {
      await this.compensateStorageObjects(
        tenantId,
        [stored],
        `generateAgreementPdf DB failure: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async generateFinalSignedPackage(
    tenantId: string,
    agreementId: string,
    signingRequestId?: string,
    actor?: { id?: string; email?: string; role?: string },
    ip?: string,
    userAgent?: string,
  ) {
    const lockResult = await this.db.executeWithTenantContext(tenantId, async (client) => {
      const agrRes = await client.query(
        `SELECT * FROM agreements WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE`,
        [agreementId, tenantId],
      );
      const agreement = agrRes.rows[0];
      if (!agreement) {
        throw new NotFoundException('Agreement not found.');
      }
      if (!['Finalizing', 'Completed'].includes(agreement.status)) {
        throw new BadRequestException(
          'Final signed PDF and completion certificate can only be generated once all required signatures are collected (Finalizing/Completed).',
        );
      }

      const existingCertRes = await client.query(
        `SELECT * FROM signing_certificates WHERE agreement_id = $1::uuid ORDER BY issued_at DESC LIMIT 1`,
        [agreementId],
      );

      await client.query(
        `INSERT INTO signing_finalizations (tenant_id, agreement_id, signing_request_id, status, attempts)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'PENDING', 0)
         ON CONFLICT (agreement_id) DO NOTHING`,
        [tenantId, agreementId, signingRequestId || null],
      );

      const finRes = await client.query(
        `SELECT * FROM signing_finalizations WHERE agreement_id = $1::uuid FOR UPDATE`,
        [agreementId],
      );
      const fin = finRes.rows[0];

      if (fin.status === 'COMPLETED' && existingCertRes.rows[0]) {
        return {
          alreadyFinalized: true as const,
          certificate: existingCertRes.rows[0],
        };
      }

      if (
        fin.status === 'IN_PROGRESS' &&
        fin.started_at &&
        Date.now() - new Date(fin.started_at).getTime() < 120_000
      ) {
        throw new ConflictException('Finalization is already in progress for this agreement.');
      }

      await client.query(
        `UPDATE signing_finalizations
         SET status = 'IN_PROGRESS',
             attempts = attempts + 1,
             started_at = NOW(),
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [fin.id],
      );

      const tenantRes = await client.query(
        `SELECT name FROM tenants WHERE id = $1::uuid`,
        [tenantId],
      );
      const tenantName = tenantRes.rows[0]?.name || 'GSIGN Enterprise';

      let requestRow: any = null;
      if (signingRequestId) {
        const rRes = await client.query(
          `SELECT * FROM signing_requests WHERE id = $1::uuid AND agreement_id = $2::uuid`,
          [signingRequestId, agreementId],
        );
        requestRow = rRes.rows[0] || null;
      } else {
        const rRes = await client.query(
          `SELECT * FROM signing_requests WHERE agreement_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
          [agreementId],
        );
        requestRow = rRes.rows[0] || null;
      }

      const recRes = requestRow
        ? await client.query(
            `SELECT * FROM signing_recipients WHERE signing_request_id = $1::uuid ORDER BY signing_order ASC`,
            [requestRow.id],
          )
        : { rows: [] };

      const sigRes = await client.query(
        `SELECT * FROM signature_records WHERE agreement_id = $1::uuid ORDER BY signed_at ASC`,
        [agreementId],
      );
      const conRes = await client.query(
        `SELECT * FROM consent_records WHERE agreement_id = $1::uuid ORDER BY consented_at ASC`,
        [agreementId],
      );

      if (sigRes.rows.length === 0) {
        throw new BadRequestException('No verified signature records found for this agreement.');
      }

      return {
        alreadyFinalized: false as const,
        finalizationId: fin.id as string,
        agreement,
        tenantName,
        requestRow,
        recipients: recRes.rows,
        signatures: sigRes.rows,
        consents: conRes.rows,
      };
    });

    if (lockResult.alreadyFinalized) {
      return {
        already_finalized: true,
        certificate: lockResult.certificate,
      };
    }

    const uploadedObjects: StoredObjectResult[] = [];
    const actorEmail = actor?.email || 'signing-engine@gsign.in';
    const actorId = actor?.id || null;

    try {
      const signedPdfBuffer = await this.pdfGenerator.generateSignedAgreementPdf({
        agreement: lockResult.agreement,
        tenantName: lockResult.tenantName,
        recipients: lockResult.recipients,
        signatures: lockResult.signatures,
        consents: lockResult.consents,
      });
      const finalPdfSha256 = this.sha256(signedPdfBuffer);
      const signedFileName = `${lockResult.agreement.agreement_number}_signed_final.pdf`;
      const signedKey = this.buildStorageKey(tenantId, agreementId, signedFileName);
      const signedStored = await this.storage.putPrivateObject(
        signedKey,
        signedPdfBuffer,
        'application/pdf',
        { tenantId, agreementId, sha256: finalPdfSha256 },
      );
      uploadedObjects.push(signedStored);

      const certificateNumber = `CERT-${lockResult.agreement.agreement_number}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const certPdfBuffer = await this.pdfGenerator.generateCompletionCertificatePdf({
        certificateNumber,
        agreement: lockResult.agreement,
        tenantName: lockResult.tenantName,
        recipients: lockResult.recipients,
        signatures: lockResult.signatures,
        consents: lockResult.consents,
        finalPdfSha256,
      });
      const certSha256 = this.sha256(certPdfBuffer);
      const certFileName = `${certificateNumber}.pdf`;
      const certKey = this.buildStorageKey(tenantId, agreementId, certFileName);
      const certStored = await this.storage.putPrivateObject(
        certKey,
        certPdfBuffer,
        'application/pdf',
        { tenantId, agreementId, sha256: certSha256 },
      );
      uploadedObjects.push(certStored);

      return await this.db.executeWithTenantContext(tenantId, async (client) => {
        const signedDocRes = await client.query(
          `INSERT INTO documents (tenant_id, agreement_id, created_by, title, doc_kind, current_version, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::varchar, 'signed_pdf', 1, 'ACTIVE')
           RETURNING *`,
          [
            tenantId,
            agreementId,
            actorId,
            `${lockResult.agreement.agreement_number} — Final Signed PDF`,
          ],
        );
        const signedDoc = signedDocRes.rows[0];

        const signedVerRes = await client.query(
          `INSERT INTO document_versions (
             tenant_id, document_id, agreement_id, version_number, version_kind,
             file_name, mime_type, byte_size, sha256_hash,
             storage_provider, storage_bucket, storage_key, is_immutable, created_by
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, 1, 'signed_pdf',
             $4::varchar, 'application/pdf', $5::bigint, $6::varchar,
             $7::varchar, $8::varchar, $9::text, TRUE, $10::uuid
           )
           RETURNING *`,
          [
            tenantId,
            signedDoc.id,
            agreementId,
            signedFileName,
            signedStored.byteSize,
            finalPdfSha256,
            signedStored.provider,
            signedStored.bucket,
            signedStored.key,
            actorId,
          ],
        );
        const signedVersion = signedVerRes.rows[0];

        const certDocRes = await client.query(
          `INSERT INTO documents (tenant_id, agreement_id, created_by, title, doc_kind, current_version, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::varchar, 'certificate', 1, 'ACTIVE')
           RETURNING *`,
          [
            tenantId,
            agreementId,
            actorId,
            `${certificateNumber} — Completion Certificate`,
          ],
        );
        const certDoc = certDocRes.rows[0];

        const certVerRes = await client.query(
          `INSERT INTO document_versions (
             tenant_id, document_id, agreement_id, version_number, version_kind,
             file_name, mime_type, byte_size, sha256_hash,
             storage_provider, storage_bucket, storage_key, is_immutable, created_by
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, 1, 'certificate',
             $4::varchar, 'application/pdf', $5::bigint, $6::varchar,
             $7::varchar, $8::varchar, $9::text, TRUE, $10::uuid
           )
           RETURNING *`,
          [
            tenantId,
            certDoc.id,
            agreementId,
            certFileName,
            certStored.byteSize,
            certSha256,
            certStored.provider,
            certStored.bucket,
            certStored.key,
            actorId,
          ],
        );
        const certVersion = certVerRes.rows[0];

        const certRowRes = await client.query(
          `INSERT INTO signing_certificates (
             tenant_id, agreement_id, signing_request_id, document_id, document_version_id,
             certificate_number, agreement_sha256, final_pdf_sha256, metadata
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::varchar, $7::varchar, $8::varchar, $9::jsonb
           )
           RETURNING *`,
          [
            tenantId,
            agreementId,
            lockResult.requestRow?.id || null,
            certDoc.id,
            certVersion.id,
            certificateNumber,
            lockResult.agreement.document_hash,
            finalPdfSha256,
            JSON.stringify({
              signed_document_id: signedDoc.id,
              signed_version_id: signedVersion.id,
              recipient_count: lockResult.recipients.length,
            }),
          ],
        );
        const certificate = certRowRes.rows[0];

        await this.incrementStorageUsage(
          client,
          tenantId,
          signedStored.byteSize + certStored.byteSize,
        );

        await client.query(
          `UPDATE signing_finalizations
           SET status = 'COMPLETED',
               signed_document_id = $2::uuid,
               certificate_id = $3::uuid,
               completed_at = NOW(),
               last_error = NULL,
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [lockResult.finalizationId, signedDoc.id, certificate.id],
        );

        if (lockResult.requestRow?.id) {
          await client.query(
            `UPDATE signing_requests
             SET status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
             WHERE id = $1::uuid`,
            [lockResult.requestRow.id],
          );
        }

        await client.query(
          `UPDATE agreements
           SET status = 'Completed',
               completed_at = COALESCE(completed_at, NOW()),
               updated_at = NOW()
           WHERE id = $1::uuid`,
          [agreementId],
        );

        await client.query(
          `INSERT INTO document_access_logs (tenant_id, document_id, document_version_id, actor_id, actor_email, action, ip_address, user_agent)
           VALUES
             ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, 'GENERATE_SIGNED_PDF', $6::varchar, $7::text),
             ($1::uuid, $8::uuid, $9::uuid, $4::uuid, $5::varchar, 'GENERATE_CERTIFICATE', $6::varchar, $7::text)`,
          [
            tenantId,
            signedDoc.id,
            signedVersion.id,
            actorId,
            actorEmail,
            ip || null,
            userAgent || null,
            certDoc.id,
            certVersion.id,
          ],
        );

        await client.query(
          `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address, document_hash)
           VALUES
             ($1::uuid, $2::uuid, $3::uuid, 'Signed PDF & Certificate Issued', $4::text, 'pdf', $5::varchar, $6::varchar),
             ($1::uuid, $2::uuid, $3::uuid, 'Agreement Completed', 'Final signed PDF and completion certificate verified; agreement completed', 'signed', $5::varchar, $6::varchar)`,
          [
            tenantId,
            agreementId,
            actorId,
            `Issued immutable signed PDF and completion certificate ${certificateNumber}`,
            ip || null,
            finalPdfSha256,
          ],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, metadata, ip_address, user_agent)
           VALUES ($1::uuid, $2::varchar, $3::varchar, 'SIGNED_PACKAGE_GENERATED', 'agreement', $4::varchar, $5::uuid, $6::jsonb, $7::varchar, $8::text)`,
          [
            actorId,
            actorEmail,
            actor?.role || 'System',
            agreementId,
            tenantId,
            JSON.stringify({
              certificate_number: certificateNumber,
              final_pdf_sha256: finalPdfSha256,
              signed_document_id: signedDoc.id,
            }),
            ip || null,
            userAgent || null,
          ],
        );

        return {
          already_finalized: false,
          signed_document: signedDoc,
          signed_version: signedVersion,
          certificate,
          certificate_document: certDoc,
          certificate_version: certVersion,
        };
      });
    } catch (err) {
      const errorMsg = (err as Error).message || 'Finalization failed';
      await this.compensateStorageObjects(
        tenantId,
        uploadedObjects,
        `generateFinalSignedPackage failure: ${errorMsg}`,
      );

      try {
        await this.db.executeWithTenantContext(tenantId, async (client) => {
          await client.query(
            `UPDATE signing_finalizations
             SET status = 'FAILED', last_error = $2::text, updated_at = NOW()
             WHERE id = $1::uuid`,
            [lockResult.finalizationId, errorMsg],
          );
          await client.query(
            `INSERT INTO agreement_events (tenant_id, agreement_id, actor_id, title, description, event_type, ip_address)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'Finalization Failed', $4::text, 'pdf', $5::varchar)`,
            [
              tenantId,
              agreementId,
              actorId,
              `Final signed PDF/certificate generation failed and can be retried: ${errorMsg}`,
              ip || null,
            ],
          );
        });
      } catch (recordErr) {
        this.logger.error(
          `Failed to record signing_finalizations failure: ${(recordErr as Error).message}`,
        );
      }

      throw new InternalServerErrorException(
        `Agreement signatures were recorded, but final document generation failed (${errorMsg}). Retry finalization to complete.`,
      );
    }
  }

  async listDocuments(tenantId: string, agreementId?: string) {
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const docsRes = agreementId
        ? await client.query(
            `SELECT * FROM documents WHERE tenant_id = $1::uuid AND agreement_id = $2::uuid ORDER BY created_at DESC`,
            [tenantId, agreementId],
          )
        : await client.query(
            `SELECT * FROM documents WHERE tenant_id = $1::uuid ORDER BY created_at DESC`,
            [tenantId],
          );

      const verRes = agreementId
        ? await client.query(
            `SELECT id, document_id, agreement_id, version_number, version_kind, file_name,
                    mime_type, byte_size, sha256_hash, storage_provider, is_immutable, created_at
             FROM document_versions
             WHERE tenant_id = $1::uuid AND agreement_id = $2::uuid
             ORDER BY version_number DESC`,
            [tenantId, agreementId],
          )
        : await client.query(
            `SELECT id, document_id, agreement_id, version_number, version_kind, file_name,
                    mime_type, byte_size, sha256_hash, storage_provider, is_immutable, created_at
             FROM document_versions
             WHERE tenant_id = $1::uuid
             ORDER BY version_number DESC`,
            [tenantId],
          );

      return docsRes.rows.map((doc) => ({
        ...doc,
        versions: verRes.rows.filter((v) => v.document_id === doc.id),
      }));
    });
  }

  async listCertificates(tenantId: string, agreementId?: string) {
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const res = agreementId
        ? await client.query(
            `SELECT sc.*, a.agreement_number, a.template_type, a.recipient_name, a.recipient_email,
                    dv.file_name, dv.byte_size, dv.sha256_hash AS certificate_sha256
             FROM signing_certificates sc
             JOIN agreements a ON a.id = sc.agreement_id
             JOIN document_versions dv ON dv.id = sc.document_version_id
             WHERE sc.tenant_id = $1::uuid AND sc.agreement_id = $2::uuid
             ORDER BY sc.issued_at DESC`,
            [tenantId, agreementId],
          )
        : await client.query(
            `SELECT sc.*, a.agreement_number, a.template_type, a.recipient_name, a.recipient_email,
                    dv.file_name, dv.byte_size, dv.sha256_hash AS certificate_sha256
             FROM signing_certificates sc
             JOIN agreements a ON a.id = sc.agreement_id
             JOIN document_versions dv ON dv.id = sc.document_version_id
             WHERE sc.tenant_id = $1::uuid
             ORDER BY sc.issued_at DESC`,
            [tenantId],
          );
      return res.rows;
    });
  }

  async getDocumentAccessLogs(tenantId: string, documentId: string) {
    return this.db.executeWithTenantContext(tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM document_access_logs
         WHERE tenant_id = $1::uuid AND document_id = $2::uuid
         ORDER BY created_at DESC`,
        [tenantId, documentId],
      );
      return res.rows;
    });
  }

  async verifyDocumentIntegrity(
    tenantId: string,
    user: { id: string; email?: string },
    documentId: string,
    versionId?: string,
    ip?: string,
    userAgent?: string,
  ) {
    const version = await this.db.executeWithTenantContext(tenantId, async (client) => {
      const res = versionId
        ? await client.query(
            `SELECT * FROM document_versions WHERE id = $1::uuid AND document_id = $2::uuid AND tenant_id = $3::uuid`,
            [versionId, documentId, tenantId],
          )
        : await client.query(
            `SELECT * FROM document_versions WHERE document_id = $1::uuid AND tenant_id = $2::uuid ORDER BY version_number DESC LIMIT 1`,
            [documentId, tenantId],
          );
      return res.rows[0] || null;
    });

    if (!version) {
      throw new NotFoundException('Document version not found.');
    }

    const buffer = await this.storage.getPrivateObjectBuffer(
      version.storage_provider,
      version.storage_bucket,
      version.storage_key,
    );
    const actualSha256 = this.sha256(buffer);
    const verified = actualSha256 === version.sha256_hash;

    await this.db.executeWithTenantContext(tenantId, async (client) => {
      await client.query(
        `INSERT INTO document_access_logs (tenant_id, document_id, document_version_id, actor_id, actor_email, action, ip_address, user_agent)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, 'VERIFY_INTEGRITY', $6::varchar, $7::text)`,
        [
          tenantId,
          documentId,
          version.id,
          user.id,
          user.email || 'system@gsign.in',
          ip || null,
          userAgent || null,
        ],
      );
    });

    return {
      verified,
      document_id: documentId,
      version_id: version.id,
      version_number: version.version_number,
      expected_sha256: version.sha256_hash,
      actual_sha256: actualSha256,
      byte_size: buffer.length,
      storage_provider: version.storage_provider,
    };
  }

  async downloadDocument(
    tenantId: string,
    user: { id: string; email?: string },
    documentId: string,
    versionId?: string,
    mode?: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{
    presigned_url?: string;
    buffer?: Buffer;
    file_name: string;
    mime_type: string;
    sha256_hash: string;
  }> {
    const version = await this.db.executeWithTenantContext(tenantId, async (client) => {
      const res = versionId
        ? await client.query(
            `SELECT * FROM document_versions WHERE id = $1::uuid AND document_id = $2::uuid AND tenant_id = $3::uuid`,
            [versionId, documentId, tenantId],
          )
        : await client.query(
            `SELECT * FROM document_versions WHERE document_id = $1::uuid AND tenant_id = $2::uuid ORDER BY version_number DESC LIMIT 1`,
            [documentId, tenantId],
          );
      return res.rows[0] || null;
    });

    if (!version) {
      throw new NotFoundException('Document version not found.');
    }

    if (mode === 'presigned' && version.storage_provider === 's3') {
      const presignedUrl = await this.storage.createPresignedDownloadUrl(
        version.storage_provider,
        version.storage_bucket,
        version.storage_key,
        version.file_name,
        120,
      );
      if (presignedUrl) {
        await this.db.executeWithTenantContext(tenantId, async (client) => {
          await client.query(
            `INSERT INTO document_access_logs (tenant_id, document_id, document_version_id, actor_id, actor_email, action, ip_address, user_agent)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, 'PRESIGNED_URL', $6::varchar, $7::text)`,
            [
              tenantId,
              documentId,
              version.id,
              user.id,
              user.email || 'system@gsign.in',
              ip || null,
              userAgent || null,
            ],
          );
        });
        return {
          presigned_url: presignedUrl,
          file_name: version.file_name,
          mime_type: version.mime_type,
          sha256_hash: version.sha256_hash,
        };
      }
    }

    const buffer = await this.storage.getPrivateObjectBuffer(
      version.storage_provider,
      version.storage_bucket,
      version.storage_key,
    );
    const actualSha256 = this.sha256(buffer);
    if (actualSha256 !== version.sha256_hash) {
      throw new InternalServerErrorException(
        'Document integrity check failed: stored file hash does not match ledger.',
      );
    }

    await this.db.executeWithTenantContext(tenantId, async (client) => {
      await client.query(
        `INSERT INTO document_access_logs (tenant_id, document_id, document_version_id, actor_id, actor_email, action, ip_address, user_agent)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, 'DOWNLOAD', $6::varchar, $7::text)`,
        [
          tenantId,
          documentId,
          version.id,
          user.id,
          user.email || 'system@gsign.in',
          ip || null,
          userAgent || null,
        ],
      );
    });

    return {
      buffer,
      file_name: version.file_name,
      mime_type: version.mime_type,
      sha256_hash: version.sha256_hash,
    };
  }
}
