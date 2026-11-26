import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';
import { Request, Response } from 'express';
import {
  CurrentTenant,
  CurrentUser,
  Permissions,
} from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { GenerateAgreementPdfDto, UploadDocumentDto } from './dto/documents.dto';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';

@Controller('documents')
@UseGuards(AuthGuard, SubscriptionGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly storageService: StorageService,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  private requireTenantId(tenantId: string | null): string {
    if (!tenantId) {
      throw new ForbiddenException('Tenant workspace context is required.');
    }
    return tenantId;
  }

  @Post('upload')
  @Permissions('agreement:create')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @Req() req: Request,
  ) {
    return this.documentsService.uploadOriginalDocument(
      this.requireTenantId(tenantId),
      user,
      file,
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('agreements/:agreementId/generate-pdf')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:update')
  async generatePdf(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Param('agreementId') agreementId: string,
    @Body() dto: GenerateAgreementPdfDto,
    @Req() req: Request,
  ) {
    return this.documentsService.generateAgreementPdf(
      this.requireTenantId(tenantId),
      user,
      agreementId,
      dto?.title,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('agreements/:agreementId/finalize')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:update')
  async finalizeSignedPackage(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Param('agreementId') agreementId: string,
    @Req() req: Request,
  ) {
    return this.documentsService.generateFinalSignedPackage(
      this.requireTenantId(tenantId),
      agreementId,
      undefined,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get()
  @Permissions('agreement:read')
  async list(
    @CurrentTenant() tenantId: string | null,
    @Query('agreementId') agreementId?: string,
  ) {
    return this.documentsService.listDocuments(this.requireTenantId(tenantId), agreementId);
  }

  @Get('certificates')
  @Permissions('agreement:read')
  async listCertificates(
    @CurrentTenant() tenantId: string | null,
    @Query('agreementId') agreementId?: string,
  ) {
    return this.documentsService.listCertificates(this.requireTenantId(tenantId), agreementId);
  }

  @Get(':id/verify')
  @Permissions('agreement:read')
  async verify(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string },
    @Param('id') id: string,
    @Query('versionId') versionId: string | undefined,
    @Req() req: Request,
  ) {
    return this.documentsService.verifyDocumentIntegrity(
      this.requireTenantId(tenantId),
      user,
      id,
      versionId,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get(':id/audit-logs')
  @Permissions('agreement:read')
  async auditLogs(
    @CurrentTenant() tenantId: string | null,
    @Param('id') id: string,
  ) {
    return this.documentsService.getDocumentAccessLogs(this.requireTenantId(tenantId), id);
  }

  @Get(':id/download')
  @Permissions('agreement:read')
  async download(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string },
    @Param('id') id: string,
    @Query('versionId') versionId: string | undefined,
    @Query('mode') mode: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.documentsService.downloadDocument(
      this.requireTenantId(tenantId),
      user,
      id,
      versionId,
      mode,
      req.ip,
      req.headers['user-agent'],
    );

    if (result.presigned_url) {
      return res.json(result);
    }

    res.setHeader('Content-Type', result.mime_type);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.file_name.replace(/"/g, '')}"`,
    );
    res.setHeader('X-Document-SHA256', result.sha256_hash);
    return res.send(result.buffer);
  }

  @Post('diagnostics/r2')
  @UseGuards(PlatformOwnerGuard)
  @HttpCode(HttpStatus.OK)
  async runTemporaryR2Diagnostic(
    @CurrentUser() user: { id: string; isPlatformOwner?: boolean; role?: string },
    @Headers('x-r2-diagnostic-token') tokenHeader?: string,
  ) {
    const expectedToken = process.env.R2_DIAGNOSTIC_TOKEN?.trim() || '';
    const providedToken = (tokenHeader || '').trim();
    if (
      !expectedToken ||
      !providedToken ||
      expectedToken.length !== providedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedToken), Buffer.from(providedToken))
    ) {
      throw new ForbiddenException('Invalid or missing diagnostic token.');
    }

    const mfaRes = await this.db.query(
      `SELECT is_enabled FROM user_mfa_configs WHERE user_id = $1::uuid LIMIT 1`,
      [user.id],
    );
    if (!mfaRes.rows[0]?.is_enabled) {
      throw new ForbiddenException('MFA must be enabled and verified for Platform Owner diagnostics.');
    }

    const rateKey = `rate:r2-diag:${user.id}`;
    const hits = Number((await this.redis.get(rateKey)) || 0);
    if (hits >= 5) {
      throw new ForbiddenException('Diagnostic rate limit exceeded. Try again later.');
    }
    await this.redis.incr(rateKey);
    await this.redis.expire(rateKey, 900);

    const key = `gsign-system-tests/r2-smoke-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
    const pdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n169\n%%EOF\n',
      'utf8',
    );
    const expectedSha = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    const report: Record<string, any> = {
      keyPrefix: 'gsign-system-tests/',
      upload: 'NOT TESTED',
      headAfterUpload: 'NOT TESTED',
      download: 'NOT TESTED',
      sha256Integrity: 'NOT TESTED',
      privateAccess: 'NOT TESTED',
      delete: 'NOT TESTED',
      headAfterDelete: 'NOT TESTED',
      error: null as string | null,
    };

    let bucket = process.env.S3_BUCKET?.trim() || '';
    let uploaded = false;

    try {
      const putRes = await this.storageService.putPrivateObject(
        key,
        pdfBuffer,
        'application/pdf',
        { purpose: 'r2-runtime-diagnostic' },
      );
      bucket = putRes.bucket;
      uploaded = true;
      report.upload = 'PASS';

      const existsAfterPut = await this.storageService.headPrivateObject('s3', bucket, key);
      report.headAfterUpload = existsAfterPut ? 'PASS' : 'FAIL';

      const downloaded = await this.storageService.getPrivateObjectBuffer('s3', bucket, key);
      report.download = downloaded.length === pdfBuffer.length ? 'PASS' : 'FAIL';

      const actualSha = crypto.createHash('sha256').update(downloaded).digest('hex');
      report.sha256Integrity = actualSha === expectedSha ? 'PASS' : 'FAIL';

      const endpoint = (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '');
      if (endpoint && bucket) {
        const pubRes = await fetch(`${endpoint}/${bucket}/${key}`);
        report.privateAccess =
          pubRes.status === 403 || pubRes.status === 401 || pubRes.status === 400
            ? `PASS (HTTP ${pubRes.status})`
            : `FAIL (HTTP ${pubRes.status})`;
      }
    } catch (err: any) {
      if (report.upload === 'NOT TESTED') report.upload = 'FAIL';
      report.error = String(err?.message || 'R2 diagnostic failed').slice(0, 240);
    } finally {
      if (uploaded && bucket) {
        try {
          await this.storageService.deletePrivateObject('s3', bucket, key);
          report.delete = 'PASS';
          const stillExists = await this.storageService.headPrivateObject('s3', bucket, key);
          report.headAfterDelete = !stillExists ? 'PASS' : 'FAIL';
        } catch (delErr: any) {
          report.delete = 'FAIL';
          report.error = report.error || String(delErr?.message || 'Cleanup failed').slice(0, 240);
        }
      }
    }

    return report;
  }
}
