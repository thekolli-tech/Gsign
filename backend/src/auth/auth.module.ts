import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CryptoService } from './crypto.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    CryptoService,
    MfaService,
    SessionService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    SuperAdminGuard,
  ],
  exports: [
    AuthService,
    CryptoService,
    MfaService,
    SessionService,
    AuthGuard,
    RolesGuard,
    PermissionsGuard,
    SuperAdminGuard,
  ],
})
export class AuthModule {}
