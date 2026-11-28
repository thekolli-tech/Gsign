-- Migration 004: Self-serve checkout initiation & payment state machine fields on payments
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS registration_id UUID REFERENCES public.company_registrations(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS checkout_reference VARCHAR(128);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout_reference
  ON public.payments(checkout_reference) WHERE checkout_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key
  ON public.payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_registration_id
  ON public.payments(registration_id);
