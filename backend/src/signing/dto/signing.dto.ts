import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
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

export class SigningFieldResponseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  field_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigned_role?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  value?: string;

  @IsOptional()
  @IsBoolean()
  checked?: boolean;
}

export class ThumbImpressionInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(700000)
  data_url!: string;

  @IsIn(['left', 'right'])
  thumb_type!: 'left' | 'right';

  @IsIn(['touch_canvas', 'image_upload'])
  capture_mode!: 'touch_canvas' | 'image_upload';

  @IsIn(['image/png', 'image/jpeg'])
  mime_type!: 'image/png' | 'image/jpeg';
}

export class VerifyBiometricAssertionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  challenge_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  credential_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  client_data_json!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  authenticator_data!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  signature!: string;
}

export class SubmitSignatureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(700000)
  signature_data_url!: string;

  @IsBoolean()
  consent_accepted!: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  consent_text!: string;

  @IsOptional()
  @IsIn(['basic_drawn', 'otp_verified', 'digital_thumb_impression', 'device_biometric'])
  signing_method?: 'basic_drawn' | 'otp_verified' | 'digital_thumb_impression' | 'device_biometric';

  @IsOptional()
  @ValidateNested()
  @Type(() => ThumbImpressionInputDto)
  thumb_impression?: ThumbImpressionInputDto;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  biometric_verification_token?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SigningFieldResponseDto)
  field_responses?: SigningFieldResponseDto[];
}

export class RejectSigningDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
