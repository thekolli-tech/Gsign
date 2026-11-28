import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { Request, Response } from 'express';
import {
  CurrentTenant,
  CurrentUser,
  Permissions,
} from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { GenerateAgreementPdfDto, UploadDocumentDto } from './dto/documents.dto';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(AuthGuard, SubscriptionGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

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

  @Get('audit-trail')
  @Permissions('agreement:read')
  async auditTrail(
    @CurrentTenant() tenantId: string | null,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('agreementId') agreementId?: string,
  ) {
    return this.documentsService.getTenantAuditTrail(this.requireTenantId(tenantId), {
      category,
      search,
      agreementId,
    });
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
}
