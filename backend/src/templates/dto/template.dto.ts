import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TemplateFieldDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsIn([
    'Text',
    'Date',
    'Dropdown',
    'Checkbox',
    'File upload',
    'Signature',
    'Initials',
    'Witness',
    'Payment details',
  ])
  type: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsBoolean()
  required: boolean;

  @IsString()
  @IsOptional()
  signingMethod?: string;

  @IsArray()
  @IsOptional()
  options?: string[];
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'Employment Offer Letter' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Offer Letter' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ example: 'HR' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'This offer is made to {{recipient_name}}...' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ type: [TemplateFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  @IsOptional()
  fields?: TemplateFieldDto[];
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({ type: [TemplateFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  @IsOptional()
  fields?: TemplateFieldDto[];
}
