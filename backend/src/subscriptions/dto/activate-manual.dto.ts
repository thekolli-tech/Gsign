import { IsNotEmpty, IsString, IsIn, IsOptional, IsNumber } from 'class-validator';

export class ActivateManualSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  tenant_id: string;

  @IsString()
  @IsNotEmpty()
  plan_id: string;

  @IsString()
  @IsIn(['monthly', 'annual'])
  billing_cycle: 'monthly' | 'annual';

  @IsString()
  @IsNotEmpty({ message: 'A justification reason is required for manual activation audit records.' })
  reason: string;

  @IsNumber()
  @IsOptional()
  duration_months?: number;
}
