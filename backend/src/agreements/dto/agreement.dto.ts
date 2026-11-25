import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const AGREEMENT_STATUSES = [
  'Draft',
  'Awaiting OTP',
  'Awaiting signature',
  'Completed',
  'Expired',
  'Rejected',
  'Cancelled',
] as const;

export type AgreementStatusValue = (typeof AGREEMENT_STATUSES)[number];

export class CreateAgreementDto {
  @ApiProperty({ example: 'Ravi Kumar' })
  @IsString()
  @IsNotEmpty()
  recipient_name: string;

  @ApiProperty({ example: 'ravi.kumar@company.com' })
  @IsEmail()
  recipient_email: string;

  @ApiPropertyOptional({ example: '+91 98765 44821' })
  @IsString()
  @IsOptional()
  recipient_phone?: string;

  @ApiProperty({ example: 'Offer Letter' })
  @IsString()
  @IsNotEmpty()
  template_type: string;

  @ApiProperty({ example: 'HR' })
  @IsString()
  @IsNotEmpty()
  department: string;

  @ApiPropertyOptional({ example: 50000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  fee_amount?: number;

  @ApiPropertyOptional({ example: '12 months' })
  @IsString()
  @IsOptional()
  period?: string;

  @ApiProperty({ example: 'Agreement terms and conditions...' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ enum: ['basic_drawn', 'otp_verified', 'aadhaar_esign', 'dsc'] })
  @IsString()
  @IsIn(['basic_drawn', 'otp_verified', 'aadhaar_esign', 'dsc'])
  @IsOptional()
  sign_method?: string;

  @ApiPropertyOptional({ enum: ['Draft', 'Awaiting OTP', 'Awaiting signature'] })
  @IsString()
  @IsIn(['Draft', 'Awaiting OTP', 'Awaiting signature'])
  @IsOptional()
  initial_status?: 'Draft' | 'Awaiting OTP' | 'Awaiting signature';

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  witness_required?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  witness_name?: string;
}

export class UpdateAgreementDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  recipient_name?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  recipient_email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  recipient_phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  template_type?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  fee_amount?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  period?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({ enum: ['basic_drawn', 'otp_verified', 'aadhaar_esign', 'dsc'] })
  @IsString()
  @IsIn(['basic_drawn', 'otp_verified', 'aadhaar_esign', 'dsc'])
  @IsOptional()
  sign_method?: string;
}

export class TransitionAgreementDto {
  @ApiProperty({ enum: AGREEMENT_STATUSES })
  @IsString()
  @IsIn(AGREEMENT_STATUSES)
  status: AgreementStatusValue;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  signature_data_url?: string;
}
