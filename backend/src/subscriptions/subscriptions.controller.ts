import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { ActivateManualSubscriptionDto } from './dto/activate-manual.dto';
import { Public, CurrentUser, CurrentTenant } from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'List all available paid subscription plans (No free trials)' })
  @ApiResponse({ status: 200, description: 'List of subscription plans' })
  async getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @UseGuards(AuthGuard)
  @Get('current')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription status and plan quota for the active tenant' })
  @ApiResponse({ status: 200, description: 'Current tenant subscription details' })
  async getCurrentSubscription(@CurrentTenant() tenantId: string | null) {
    return this.subscriptionsService.getCurrentSubscription(tenantId || '');
  }

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Post('activate-manual')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually activate a company subscription (Platform Owner only, generates audit record)' })
  @ApiResponse({ status: 200, description: 'Subscription activated manually' })
  async activateManual(
    @CurrentUser() actor: any,
    @Body() dto: ActivateManualSubscriptionDto
  ) {
    return this.subscriptionsService.activateManual(actor, dto);
  }
}
