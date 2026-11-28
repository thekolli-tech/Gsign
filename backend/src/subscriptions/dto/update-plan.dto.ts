import {
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  IsNumber,
  Min,
  IsInt,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSubscriptionPlanDto {
  @ApiPropertyOptional({ example: 'Business Plan' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ example: '100 documents/month; 5 users; custom branding and templates' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 1499 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthly_price?: number;

  @ApiPropertyOptional({ example: 14990 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  annual_price?: number;

  @ApiPropertyOptional({ example: 100, description: 'Use -1 for unlimited' })
  @IsOptional()
  @IsInt()
  @Min(-1)
  max_agreements_per_month?: number;

  @ApiPropertyOptional({ example: 5, description: 'Use -1 for unlimited' })
  @IsOptional()
  @IsInt()
  @Min(-1)
  max_users?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
