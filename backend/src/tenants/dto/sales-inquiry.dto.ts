import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const SALES_INQUIRY_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'closed'] as const;
export type SalesInquiryStatus = (typeof SALES_INQUIRY_STATUSES)[number];

export class CreateSalesInquiryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  contact_name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  company_name!: string;

  @IsEmail()
  @MaxLength(255)
  business_email!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+\d\s().-]{7,24}$/, {
    message: 'Phone number must be 7-24 characters using digits, spaces, +, -, or parentheses.',
  })
  @MaxLength(32)
  phone_number?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  company_size!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  requested_plan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  monthly_agreements?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class UpdateSalesInquiryDto {
  @IsOptional()
  @IsIn(SALES_INQUIRY_STATUSES)
  status?: SalesInquiryStatus;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  assigned_to_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internal_notes?: string;
}
