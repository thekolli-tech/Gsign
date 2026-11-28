import {
  Body,
  Controller,
  ForbiddenException,
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
  VerifyBiometricAssertionDto,
  VerifySigningOtpDto,
} from './dto/signing.dto';
import { SigningService } from './signing.service';

@Controller('signing')
@UseGuards(AuthGuard, SubscriptionGuard, PermissionsGuard)
export class SigningController {
  constructor(private readonly signingService: SigningService) {}

  private requireTenantId(tenantId: string | null): string {
    if (!tenantId) {
      throw new ForbiddenException('Tenant workspace context is required.');
    }
    return tenantId;
  }

  @Post('requests')
  @Permissions('agreement:update')
  async createRequest(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Body() dto: CreateSigningRequestDto,
    @Req() req: Request,
  ) {
    const resolvedTenantId = this.requireTenantId(tenantId);
    const originHeader = req.headers.origin as string | undefined;
    const hostHeader = req.headers.host as string | undefined;
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const originUrl =
      originHeader || (hostHeader ? `${proto}://${hostHeader}` : 'https://gsign01.vercel.app');
    return this.signingService.createSigningRequest(
      resolvedTenantId,
      user,
      dto,
      originUrl,
      req.ip,
    );
  }

  @Get('requests/agreement/:agreementId')
  @Permissions('agreement:read')
  async listByAgreement(
    @CurrentTenant() tenantId: string | null,
    @Param('agreementId') agreementId: string,
  ) {
    return this.signingService.listRequestsForAgreement(
      this.requireTenantId(tenantId),
      agreementId,
    );
  }

  @Post('requests/:requestId/revoke')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:update')
  async revokeRequest(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Param('requestId') requestId: string,
    @Req() req: Request,
  ) {
    return this.signingService.revokeSigningRequest(
      this.requireTenantId(tenantId),
      user,
      requestId,
      req.ip,
    );
  }

  @Post('requests/agreement/:agreementId/retry-finalization')
  @HttpCode(HttpStatus.OK)
  @Permissions('agreement:update')
  async retryFinalization(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Param('agreementId') agreementId: string,
    @Req() req: Request,
  ) {
    return this.signingService.retryFinalization(
      this.requireTenantId(tenantId),
      agreementId,
      user,
      req.ip,
      req.headers['user-agent'],
    );
  }

  // =========================================================
  // PUBLIC TOKEN-GATED RECIPIENT SIGNING PORTAL ENDPOINTS
  // =========================================================

  @Public()
  @SkipSubscription()
  @Get('portal/:token')
  async getPortal(@Param('token') token: string, @Req() req: Request) {
    return this.signingService.getPortalByToken(token, req.ip);
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
  @Get('portal/:token/biometric/capabilities')
  async getBiometricCapabilities(@Param('token') token: string) {
    return this.signingService.getBiometricCapabilities(token);
  }

  @Public()
  @SkipSubscription()
  @Post('portal/:token/biometric/challenge')
  @HttpCode(HttpStatus.OK)
  async createBiometricChallenge(@Param('token') token: string, @Req() req: Request) {
    const originHeader = (req.headers.origin as string) || '';
    const hostHeader = (req.headers.host as string) || 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = originHeader || `${proto}://${hostHeader}`;
    const rpId = hostHeader.split(':')[0] || 'localhost';
    return this.signingService.createBiometricChallenge(token, origin, rpId, req.ip);
  }

  @Public()
  @SkipSubscription()
  @Post('portal/:token/biometric/verify')
  @HttpCode(HttpStatus.OK)
  async verifyBiometricAssertion(
    @Param('token') token: string,
    @Body() dto: VerifyBiometricAssertionDto,
    @Req() req: Request,
  ) {
    const originHeader = (req.headers.origin as string) || '';
    const hostHeader = (req.headers.host as string) || 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = originHeader || `${proto}://${hostHeader}`;
    const rpId = hostHeader.split(':')[0] || 'localhost';
    return this.signingService.verifyBiometricAssertion(
      token,
      dto,
      origin,
      rpId,
      req.ip,
      req.headers['user-agent'],
    );
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
