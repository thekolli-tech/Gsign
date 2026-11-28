import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateReceiptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  payer_name: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  purpose: string;

  @IsOptional()
  @IsUUID()
  agreement_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  agreement_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  payment_mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tx_reference?: string;

  @IsOptional()
  @IsBoolean()
  issue_immediately?: boolean;
}

export class AcknowledgeReceiptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  payment_mode: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(128)
  tx_reference: string;
}
