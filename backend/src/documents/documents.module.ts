import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [StorageService, PdfGeneratorService, DocumentsService],
  exports: [StorageService, PdfGeneratorService, DocumentsService],
})
export class DocumentsModule {}
