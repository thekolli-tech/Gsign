import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { SimulateCheckoutDto } from './dto/simulate-checkout.dto';
import { Public, CurrentTenant } from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('simulate-checkout')
  @ApiOperation({ summary: 'Simulate checkout payment and activate subscription upon verified payment' })
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
}
