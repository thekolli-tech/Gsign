import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';
import {
  ApprovedBiometricServiceAdapter,
  DedicatedFingerprintScannerAdapter,
  InMemoryTrustedCredentialStore,
  WebAuthnBiometricVerifier,
} from './biometric.provider';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [SigningController],
  providers: [
    SigningService,
    WebAuthnBiometricVerifier,
    DedicatedFingerprintScannerAdapter,
    ApprovedBiometricServiceAdapter,
    InMemoryTrustedCredentialStore,
  ],
  exports: [SigningService],
})
export class SigningModule {}
