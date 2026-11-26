import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SigningRecipientInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  signing_order?: number;

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sign_method?: string;
}

export class CreateSigningRequestDto {
  @IsString()
  @IsNotEmpty()
  agreement_id!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SigningRecipientInputDto)
  recipients!: SigningRecipientInputDto[];

  @IsOptional()
  @IsBoolean()
  sequential?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expires_in_hours?: number;
}

export class VerifySigningOtpDto {
  @IsString()
  @Length(6, 6)
  otp!: string;
}

export class SubmitSignatureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500000)
  signature_data_url!: string;

  @IsBoolean()
  consent_accepted!: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  consent_text!: string;
}

export class RejectSigningDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
