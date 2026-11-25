import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DisableMfaDto {
  @ApiProperty({ example: 'Password123!', description: 'Current password for reauthentication' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: '123456', description: 'Optional current MFA code', required: false })
  @IsString()
  @IsOptional()
  code?: string;
}
