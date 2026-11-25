import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class CompleteCompanySetupDto {
  @IsString()
  @IsNotEmpty()
  registration_id: string;

  @IsString()
  @IsNotEmpty()
  plan_id: string;

  @IsString()
  @IsIn(['monthly', 'annual'])
  billing_cycle: 'monthly' | 'annual';
}
