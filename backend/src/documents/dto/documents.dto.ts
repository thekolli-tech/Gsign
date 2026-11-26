import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  agreement_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  doc_kind?: string;
}

export class GenerateAgreementPdfDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
