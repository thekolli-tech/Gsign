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
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
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
  @ApiOperation({ summary: 'List global and tenant templates' })
  async list(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Query('include_archived') includeArchived?: string
  ) {
    return this.templatesService.listTemplates(tenantId, includeArchived === 'true', user);
  }

  @Get(':id')
  @Permissions('template:read')
  @ApiOperation({ summary: 'Get template details and version history' })
  async getOne(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Param('id') id: string
  ) {
    return this.templatesService.getTemplate(tenantId, id, user);
  }

  @UseGuards(SuperAdminGuard)
  @Post()
  @Permissions('template:create')
  @ApiOperation({ summary: 'Create a new global agreement template (Super Admin only)' })
  async create(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Body() dto: CreateTemplateDto,
    @Req() req: Request
  ) {
    return this.templatesService.createTemplate(tenantId, user, dto, req.ip);
  }

  @UseGuards(SuperAdminGuard)
  @Patch(':id')
  @Permissions('template:update')
  @ApiOperation({ summary: 'Save global template draft (Super Admin only)' })
  async update(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @Req() req: Request
  ) {
    return this.templatesService.updateTemplate(tenantId, user, id, dto, req.ip);
  }

  @UseGuards(SuperAdminGuard)
  @Post(':id/publish')
  @Permissions('template:publish')
  @ApiOperation({ summary: 'Publish global template version to all workspaces (Super Admin only)' })
  async publish(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.templatesService.publishTemplate(tenantId, user, id, req.ip);
  }

  @UseGuards(SuperAdminGuard)
  @Post(':id/duplicate')
  @Permissions('template:create')
  @ApiOperation({ summary: 'Duplicate a global template as a fresh v1 Draft (Super Admin only)' })
  async duplicate(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.templatesService.duplicateTemplate(tenantId, user, id, req.ip);
  }

  @UseGuards(SuperAdminGuard)
  @Post(':id/archive')
  @Permissions('template:update')
  @ApiOperation({ summary: 'Archive a global template (Super Admin only)' })
  async archive(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.templatesService.archiveTemplate(tenantId, user, id, req.ip);
  }
}
