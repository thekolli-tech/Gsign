import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { AgreementsService } from './agreements.service';
import {
  CreateAgreementDto,
  TransitionAgreementDto,
  UpdateAgreementDto,
} from './dto/agreement.dto';

@ApiTags('Agreements')
@ApiBearerAuth()
@UseGuards(AuthGuard, SubscriptionGuard, PermissionsGuard)
@Controller('agreements')
export class AgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  @Get()
  @Permissions('agreement:read')
  @ApiOperation({ summary: 'List tenant agreements with optional status/department filters' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: string,
    @Query('department') department?: string
  ) {
    return this.agreementsService.listAgreements(tenantId, { status, department });
  }

  @Get(':id')
  @Permissions('agreement:read')
  @ApiOperation({ summary: 'Get agreement details and immutable audit events' })
  async getOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.agreementsService.getAgreement(tenantId, id);
  }

  @Post()
  @Permissions('agreement:create')
  @ApiOperation({ summary: 'Create a new agreement (Draft or dispatched)' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateAgreementDto,
    @Req() req: Request
  ) {
    return this.agreementsService.createAgreement(tenantId, user, dto, req.ip);
  }

  @Patch(':id')
  @Permissions('agreement:update')
  @ApiOperation({ summary: 'Update a Draft agreement' })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateAgreementDto,
    @Req() req: Request
  ) {
    return this.agreementsService.updateAgreement(tenantId, user, id, dto, req.ip);
  }

  @Post(':id/transition')
  @Permissions('agreement:update')
  @ApiOperation({ summary: 'Transition agreement status with server-side state machine validation' })
  async transition(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: TransitionAgreementDto,
    @Req() req: Request
  ) {
    return this.agreementsService.transitionStatus(tenantId, user, id, dto, req.ip);
  }

  @Delete(':id')
  @Permissions('agreement:delete')
  @ApiOperation({ summary: 'Delete a Draft agreement' })
  async remove(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    return this.agreementsService.deleteDraft(tenantId, user, id, req.ip);
  }

  @Post(':id/remind')
  @Permissions('agreement:update')
  @ApiOperation({ summary: 'Send a signing reminder to pending signatories for an active agreement' })
  async remind(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const originHeader = req.headers.origin as string | undefined;
    const hostHeader = req.headers.host as string | undefined;
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const originUrl =
      originHeader || (hostHeader ? `${proto}://${hostHeader}` : 'https://www.gsign.in');
    return this.agreementsService.remindAgreement(tenantId, user, id, originUrl, req.ip);
  }
}
