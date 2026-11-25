import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto, ConfirmEnrollmentDto } from './dto/verify-mfa.dto';
import { RecoveryCodeDto } from './dto/recovery-code.dto';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CompleteCompanySetupDto } from './dto/complete-company-setup.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { Public, CurrentUser, CurrentSession } from '../common/decorators/auth.decorators';
import { AuthGuard } from '../common/guards/auth.guard';
import type { ActiveSession } from './session.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';
  private readonly maxAgeMs: number;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {
    this.cookieName = this.configService.get<string>('SESSION_COOKIE_NAME', 'gsign_session');
    this.cookieSecure = this.configService.get<string>('NODE_ENV') === 'production';
    this.cookieSameSite = (this.configService.get<string>('COOKIE_SAME_SITE', 'lax') as any);
    this.maxAgeMs = Number(this.configService.get<number>('SESSION_MAX_AGE_SECONDS', 86400)) * 1000;
  }

  private setSessionCookie(res: Response, sessionId: string) {
    res.cookie(this.cookieName, sessionId, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      maxAge: this.maxAgeMs,
      path: '/',
    });
  }

  private clearSessionCookie(res: Response) {
    res.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/',
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user with work email and password' })
  @ApiResponse({ status: 200, description: 'Login successful or MFA required' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const result = await this.authService.login(dto, ip, userAgent);

    if (!result.mfa_required && result.session) {
      this.setSessionCookie(res, result.session.sessionId);
    }

    return result;
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke active session and clear authentication cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @CurrentSession() session: ActiveSession,
    @Res({ passthrough: true }) res: Response
  ) {
    if (session?.sessionId) {
      await this.authService.logout(session.sessionId);
    }
    this.clearSessionCookie(res);
    return { success: true, message: 'Logged out successfully' };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile and permissions' })
  @ApiResponse({ status: 200, description: 'Current authenticated session profile' })
  async getMe(@CurrentSession() session: ActiveSession) {
    return {
      user: {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
        isSuperAdmin: session.isSuperAdmin,
      },
      tenantId: session.tenantId,
      role: session.role,
      permissions: session.permissions,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    };
  }

  @UseGuards(AuthGuard)
  @Post('mfa/enroll')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initiate administrator TOTP MFA enrollment' })
  @ApiResponse({ status: 200, description: 'Returns TOTP secret and QR code Data URL' })
  async enrollMfa(@CurrentUser() user: any) {
    return this.authService.enrollMfa(user.id);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify MFA code for login OR confirm initial enrollment' })
  @ApiResponse({ status: 200, description: 'MFA verification successful' })
  async verifyMfa(
    @Body() body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Branch A: Login with MFA Token
    if (body.mfa_token) {
      const session = await this.authService.verifyMfaLogin(
        { mfa_token: body.mfa_token, code: body.code },
        ip,
        userAgent
      );
      this.setSessionCookie(res, session.sessionId);
      return {
        mfa_required: false,
        session,
      };
    }

    // Branch B: Enrollment confirmation (requires active session)
    const sessionId = (req.cookies && (req.cookies['__Host-gsign_session'] || req.cookies['gsign_session'])) ||
      (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

    if (!sessionId) {
      throw new Error('Must provide mfa_token for login OR have an active session for enrollment');
    }

    // Verify session
    const session = await (this.authService as any).sessionService.getSession(sessionId);
    if (!session) {
      throw new Error('Active session required to confirm MFA enrollment');
    }

    return this.authService.verifyMfaEnrollment(session.userId, body.code);
  }

  @Public()
  @Post('mfa/recovery')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate using single-use emergency backup recovery code' })
  @ApiResponse({ status: 200, description: 'Recovery login successful' })
  async recoveryLogin(
    @Body() dto: RecoveryCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const session = await this.authService.loginWithRecoveryCode(dto, ip, userAgent);
    this.setSessionCookie(res, session.sessionId);

    return {
      mfa_required: false,
      session,
    };
  }

  @UseGuards(AuthGuard)
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable administrator MFA (requires re-authentication password)' })
  @ApiResponse({ status: 200, description: 'MFA disabled successfully' })
  async disableMfa(
    @CurrentUser() user: any,
    @Body() dto: DisableMfaDto
  ) {
    return this.authService.disableMfa(user.id, dto.password, dto.code);
  }

  @Public()
  @Post('register-company')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new company (creates pending registration with email verification)' })
  @ApiResponse({ status: 201, description: 'Registration received. Verification email dispatched.' })
  async registerCompany(@Body() dto: RegisterCompanyDto) {
    return this.authService.registerCompany(dto);
  }

  @Public()
  @Get('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify company registration email using single-use secure token' })
  @ApiResponse({ status: 200, description: 'Email address verified successfully' })
  async verifyEmail(@Req() req: Request) {
    const token = req.query.token as string;
    return this.authService.verifyEmail(token);
  }

  @Public()
  @Post('complete-company-setup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Complete company setup after email verification (provisions tenant awaiting paid subscription)' })
  @ApiResponse({ status: 201, description: 'Tenant provisioned in PAYMENT_PENDING state (No free trial)' })
  async completeCompanySetup(@Body() dto: CompleteCompanySetupDto) {
    return this.authService.completeCompanySetup(dto);
  }

  @UseGuards(AuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change user password (required on first login for Platform Owner)' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  @UseGuards(AuthGuard)
  @Post('team/invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite an employee to the company workspace (No public registration)' })
  @ApiResponse({ status: 201, description: 'Employee invitation dispatched' })
  async inviteMember(
    @CurrentUser() user: any,
    @Body() dto: InviteMemberDto
  ) {
    return this.authService.inviteMember(user, dto);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an employee invitation and set password' })
  @ApiResponse({ status: 200, description: 'Invitation accepted and account established' })
  async acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }
}
