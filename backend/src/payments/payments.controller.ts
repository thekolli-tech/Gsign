import { Controller, Post, Get, Body, Query, Param, Req, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { SimulateCheckoutDto } from './dto/simulate-checkout.dto';
import { AcknowledgeReceiptDto, CreateReceiptDto } from './dto/receipt.dto';
import {
  CheckoutStatusDto,
  InitiateCheckoutDto,
  PaymentWebhookConfirmDto,
  TransitionCheckoutDto,
} from './dto/checkout.dto';
import { CurrentTenant, CurrentUser, Permissions, Public } from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Post('simulate-checkout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Simulate checkout payment in non-production environments (Platform Owner only)' })
  @ApiResponse({ status: 200, description: 'Payment verified and subscription activated' })
  async simulateCheckout(@Body() dto: SimulateCheckoutDto) {
    return this.paymentsService.simulateCheckout(dto);
  }

  @UseGuards(AuthGuard)
  @Get('invoices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment invoices for the active tenant' })
  @ApiResponse({ status: 200, description: 'List of company invoices' })
  async getInvoices(@CurrentTenant() tenantId: string | null) {
    return this.paymentsService.getInvoices(tenantId || '');
  }

  @UseGuards(AuthGuard)
  @Get('history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tenant-scoped payment transaction history' })
  @ApiResponse({ status: 200, description: 'Paginated payment history for the active tenant' })
  async getPaymentHistory(
    @CurrentTenant() tenantId: string | null,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = Math.max(1, Number.parseInt(page || '1', 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(limit || '20', 10) || 20));
    return this.paymentsService.getPaymentHistory(tenantId || '', parsedPage, parsedLimit);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('receipt:read')
  @Get('receipts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tenant payment receipts' })
  async listReceipts(@CurrentTenant() tenantId: string | null) {
    return this.paymentsService.listReceipts(tenantId || '');
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('receipt:issue')
  @Post('receipts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a pending or issued payment receipt' })
  async createReceipt(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; fullName?: string; role?: string },
    @Body() dto: CreateReceiptDto,
  ) {
    return this.paymentsService.createReceipt(tenantId || '', user, dto);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('receipt:issue')
  @Post('receipts/:id/acknowledge')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Acknowledge a pending payment receipt and issue official voucher' })
  async acknowledgeReceipt(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; fullName?: string; role?: string },
    @Param('id') id: string,
    @Body() dto: AcknowledgeReceiptDto,
  ) {
    return this.paymentsService.acknowledgeReceipt(tenantId || '', id, user, dto);
  }

  @Public()
  @Post('checkout/initiate')
  @ApiOperation({ summary: 'Public self-serve checkout initiation for verified company registrations' })
  async initiateCheckout(@Body() dto: InitiateCheckoutDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    return this.paymentsService.initiateRegistrationCheckout(dto, ip);
  }

  @Public()
  @Post('checkout/status')
  @ApiOperation({ summary: 'Check checkout payment status for an owned registration' })
  async getCheckoutStatus(@Body() dto: CheckoutStatusDto) {
    return this.paymentsService.getCheckoutStatus(dto);
  }

  @Public()
  @Post('checkout/:checkoutReference/transition')
  @ApiOperation({ summary: 'Cancel or mark checkout processing/failed for an owned registration' })
  async transitionCheckout(
    @Param('checkoutReference') checkoutReference: string,
    @Body() dto: TransitionCheckoutDto,
  ) {
    return this.paymentsService.transitionCheckoutState(checkoutReference, dto);
  }

  @Public()
  @Post('webhook/confirm')
  @ApiOperation({ summary: 'Signed payment gateway webhook confirmation' })
  async confirmWebhook(
    @Body() dto: PaymentWebhookConfirmDto,
    @Req() req: Request,
    @Headers('x-gsign-signature') signature?: string,
  ) {
    const rawBody = (req as any).rawBody ? (req as any).rawBody.toString('utf8') : JSON.stringify(dto);
    return this.paymentsService.handleVerifiedWebhook(dto, rawBody, signature);
  }

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Get('platform/checkouts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inspect self-serve checkout/payment records (Platform Owner only)' })
  async listPlatformCheckouts(@Query('status') status?: string) {
    return this.paymentsService.listPlatformCheckouts(status);
  }
}
