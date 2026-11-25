import { IsEmail, IsNotEmpty, IsString, MinLength, IsBoolean, IsOptional, IsIn } from 'class-validator';

export class RegisterCompanyDto {
  @IsString()
  @IsNotEmpty()
  company_name: string;

  @IsString()
  @IsNotEmpty()
  display_name: string;

  @IsEmail()
  @IsNotEmpty()
  business_email: string;

  @IsString()
  @IsNotEmpty()
  business_phone: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsNotEmpty()
  admin_full_name: string;

  @IsEmail()
  @IsNotEmpty()
  admin_email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsBoolean()
  terms_accepted: boolean;

  @IsString()
  @IsOptional()
  selected_plan_id?: string;

  @IsString()
  @IsOptional()
  @IsIn(['monthly', 'annual'])
  billing_cycle?: string;
}
