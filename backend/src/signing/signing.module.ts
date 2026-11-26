import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SigningController } from './signing.controller';
import { SigningService } from './signing.service';

@Module({
  imports: [DocumentsModule],
  controllers: [SigningController],
  providers: [SigningService],
  exports: [SigningService],
})
export class SigningModule {}
