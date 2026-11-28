import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export const PAYMENT_STATES = [
  'PAYMENT_PENDING',
  'PAYMENT_PROCESSING',
  'PAYMENT_FAILED',
  'PAYMENT_CANCELLED',
  'PAYMENT_COMPLETED',
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

export class InitiateCheckoutDto {
  @IsUUID()
  registration_id!: string;

  @IsUUID()
  plan_id!: string;

  @IsIn(['monthly', 'annual'])
  billing_cycle!: 'monthly' | 'annual';

  @IsEmail()
  @MaxLength(255)
  admin_email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  checkout_access_token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotency_key?: string;
}

export class CheckoutStatusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  checkout_reference!: string;

  @IsEmail()
  @MaxLength(255)
  admin_email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  checkout_access_token!: string;
}

export class TransitionCheckoutDto {
  @IsEmail()
  @MaxLength(255)
  admin_email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  checkout_access_token!: string;

  @IsIn(['PAYMENT_PROCESSING', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED'])
  status!: 'PAYMENT_PROCESSING' | 'PAYMENT_FAILED' | 'PAYMENT_CANCELLED';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class PaymentWebhookConfirmDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  checkout_reference!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  provider_transaction_id!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  currency!: string;

  @IsIn(['PAYMENT_COMPLETED', 'PAYMENT_FAILED'])
  status!: 'PAYMENT_COMPLETED' | 'PAYMENT_FAILED';
}
