import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  CurrentTenant,
  CurrentUser,
  Permissions,
  Public,
  SkipSubscription,
} from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import {
  CreateSigningRequestDto,
  RejectSigningDto,
  SubmitSignatureDto,
  VerifySigningOtpDto,
} from './dto/signing.dto';
import { SigningService } from './signing.service';

@Controller('signing')
@UseGuards(AuthGuard, SubscriptionGuard, PermissionsGuard)
export class SigningController {
  constructor(private readonly signingService: SigningService) {}

  @Post('requests')
  @Permissions('agreement:update')
  async createRequest(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; email?: string },
    @Body() dto: CreateSigningRequestDto,
    @Req() req: Request,
  ) {
    const originHeader = req.headers.origin as string | undefined;
    const hostHeader = req.headers.host as string | undefined;
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const originUrl = originHeader || (hostHeader ? `${proto}://${hostHeader}` : 'https://gsign01.vercel.app');
    return this.signingService.createSigningRequest(
      tenant.id,
      user,
      dto,
      originUrl,
      req.ip,
    );
  }

  @Get('requests/agreement/:agreementId')
  @Permissions('agreement:read')
  async listByAgreement(
    @CurrentTenant() tenant: { id: string },
    @Param('agreementId') agreementId: string,
  ) {
    return this.signingService.listRequestsForAgreement(tenant.id, agreementId);
  }

  @Post('requests/:requestId/revoke')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:update')
  async revokeRequest(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string },
    @Param('requestId') requestId: string,
    @Req() req: Request,
  ) {
    return this.signingService.revokeSigningRequest(tenant.id, user, requestId, req.ip);
  }

  // =========================================================
  // PUBLIC TOKEN-GATED RECIPIENT SIGNING PORTAL ENDPOINTS
  // =========================================================

  @Public()
  @SkipSubscription()
  @Get('portal/:token')
  async getPortal(@Param('token') token: string) {
    return this.signingService.getPortalByToken(token);
  }

  @Public()
  @SkipSubscription()
  @Post('portal/:token/otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Param('token') token: string, @Req() req: Request) {
    return this.signingService.requestOtp(token, req.ip);
  }

  @Public()
  @SkipSubscription()
  @Post('portal/:token/otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Param('token') token: string,
    @Body() dto: VerifySigningOtpDto,
    @Req() req: Request,
  ) {
    return this.signingService.verifyOtp(token, dto.otp, req.ip);
  }

  @Public()
  @SkipSubscription()
  @Post('portal/:token/sign')
  @HttpCode(HttpStatus.OK)
  async submitSignature(
    @Param('token') token: string,
    @Body() dto: SubmitSignatureDto,
    @Req() req: Request,
  ) {
    return this.signingService.submitSignature(
      token,
      dto,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Public()
  @SkipSubscription()
  @Post('portal/:token/reject')
  @HttpCode(HttpStatus.OK)
  async rejectSigning(
    @Param('token') token: string,
    @Body() dto: RejectSigningDto,
    @Req() req: Request,
  ) {
    return this.signingService.rejectSigning(token, dto, req.ip);
  }
}
