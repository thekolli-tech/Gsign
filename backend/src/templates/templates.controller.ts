import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions, CurrentTenant, CurrentUser } from '../common/decorators/auth.decorators';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

@ApiTags('Templates')
@ApiBearerAuth()
@UseGuards(AuthGuard, SubscriptionGuard, PermissionsGuard)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  @Permissions('template:read')
  @ApiOperation({ summary: 'List tenant templates' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query('include_archived') includeArchived?: string
  ) {
    return this.templatesService.listTemplates(tenantId, includeArchived === 'true');
  }

  @Get(':id')
  @Permissions('template:read')
  @ApiOperation({ summary: 'Get template details and version history' })
  async getOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.templatesService.getTemplate(tenantId, id);
  }

  @Post()
  @Permissions('template:create')
  @ApiOperation({ summary: 'Create a new agreement template (v1 Draft)' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateTemplateDto,
    @Req() req: Request
  ) {
    return this.templatesService.createTemplate(tenantId, user, dto, req.ip);
  }

  @Patch(':id')
  @Permissions('template:update')
  @ApiOperation({ summary: 'Save template draft (creates new version if current version is Published)' })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @Req() req: Request
  ) {
    return this.templatesService.updateTemplate(tenantId, user, id, dto, req.ip);
  }

  @Post(':id/publish')
  @Permissions('template:publish')
  @ApiOperation({ summary: 'Publish current template version (locks version immutably)' })
  async publish(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.templatesService.publishTemplate(tenantId, user, id, req.ip);
  }

  @Post(':id/duplicate')
  @Permissions('template:create')
  @ApiOperation({ summary: 'Duplicate a template as a fresh v1 Draft' })
  async duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.templatesService.duplicateTemplate(tenantId, user, id, req.ip);
  }

  @Post(':id/archive')
  @Permissions('template:update')
  @ApiOperation({ summary: 'Archive a template' })
  async archive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.templatesService.archiveTemplate(tenantId, user, id, req.ip);
  }
}
