import {
  Body,
  Controller,
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

  @Post('upload')
  @Permissions('agreement:create')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @Req() req: Request,
  ) {
    return this.documentsService.uploadOriginalDocument(
      tenant.id,
      user,
      file,
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('agreements/:agreementId/generate-pdf')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:read')
  async generatePdf(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Param('agreementId') agreementId: string,
    @Body() dto: GenerateAgreementPdfDto,
    @Req() req: Request,
  ) {
    return this.documentsService.generateAgreementPdf(
      tenant.id,
      user,
      agreementId,
      dto?.title,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('agreements/:agreementId/finalize')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:read')
  async finalizeSignedPackage(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Param('agreementId') agreementId: string,
    @Req() req: Request,
  ) {
    return this.documentsService.generateFinalSignedPackage(
      tenant.id,
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
    @CurrentTenant() tenant: { id: string },
    @Query('agreementId') agreementId?: string,
  ) {
    return this.documentsService.listDocuments(tenant.id, agreementId);
  }

  @Get('certificates')
  @Permissions('agreement:read')
  async listCertificates(
    @CurrentTenant() tenant: { id: string },
    @Query('agreementId') agreementId?: string,
  ) {
    return this.documentsService.listCertificates(tenant.id, agreementId);
  }

  @Get(':id/verify')
  @Permissions('agreement:read')
  async verify(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; email?: string },
    @Param('id') id: string,
    @Query('versionId') versionId: string | undefined,
    @Req() req: Request,
  ) {
    return this.documentsService.verifyDocumentIntegrity(
      tenant.id,
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
    @CurrentTenant() tenant: { id: string },
    @Param('id') id: string,
  ) {
    return this.documentsService.getDocumentAccessLogs(tenant.id, id);
  }

  @Get(':id/download')
  @Permissions('agreement:read')
  async download(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; email?: string },
    @Param('id') id: string,
    @Query('versionId') versionId: string | undefined,
    @Query('mode') mode: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.documentsService.downloadDocument(
      tenant.id,
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
