import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyMfaDto {
  @ApiProperty({ example: 'mfa_tok_0123456789abcdef...', description: 'Ephemeral MFA token from /auth/login' })
  @IsString()
  @IsNotEmpty()
  mfa_token: string;

  @ApiProperty({ example: '123456', description: '6-digit TOTP code from authenticator app' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'MFA code must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'MFA code must contain only numbers' })
  code: string;
}

export class ConfirmEnrollmentDto {
  @ApiProperty({ example: '123456', description: '6-digit TOTP code to confirm enrollment' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'MFA code must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'MFA code must contain only numbers' })
  code: string;
}
