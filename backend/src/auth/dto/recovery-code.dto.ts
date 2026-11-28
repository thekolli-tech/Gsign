import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RecoveryCodeDto {
  @ApiProperty({ example: 'mfa_tok_0123456789abcdef...', description: 'Ephemeral MFA token from /auth/login' })
  @IsString()
  @IsNotEmpty()
  mfa_token: string;

  @ApiProperty({ example: 'ABCD-EFGH-JKLM', description: 'Emergency single-use recovery code' })
  @IsString()
  @IsNotEmpty()
  recovery_code: string;
}
