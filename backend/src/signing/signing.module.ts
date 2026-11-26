import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [SigningController],
  providers: [SigningService],
  exports: [SigningService],
})
export class SigningModule {}
