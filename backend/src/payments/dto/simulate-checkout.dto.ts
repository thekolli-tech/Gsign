import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';

export class SimulateCheckoutDto {
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
  @IsOptional()
  payment_method?: string;
}
