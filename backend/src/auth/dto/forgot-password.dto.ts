import { IsEmail, IsNotEmpty, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestPasswordOtpDto {
  @ApiProperty({ example: 'admin@company.com' })
  @IsEmail()
  email: string;
}

export class VerifyPasswordOtpDto {
  @ApiProperty({ example: 'admin@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '482910' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be a 6-digit code' })
  otp: string;
}

export class ResetPasswordWithOtpDto {
  @ApiProperty({ description: 'Single-use reset token returned after OTP verification' })
  @IsString()
  @IsNotEmpty()
  reset_token: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  new_password: string;
}
