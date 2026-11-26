import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [DocumentsController],
  providers: [StorageService, PdfGeneratorService, DocumentsService],
  exports: [StorageService, PdfGeneratorService, DocumentsService],
})
export class DocumentsModule {}
