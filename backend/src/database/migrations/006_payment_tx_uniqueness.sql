-- Migration 006: Database-level uniqueness for non-simulated completed provider transaction IDs
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_dup_count
  FROM (
    SELECT provider, provider_transaction_id
    FROM public.payments
    WHERE provider_transaction_id IS NOT NULL
      AND provider <> 'SIMULATED'
      AND status IN ('PAYMENT_COMPLETED', 'COMPLETED')
    GROUP BY provider, provider_transaction_id
    HAVING COUNT(*) > 1
  ) dup;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create idx_payments_unique_real_provider_tx: found % duplicate completed real provider_transaction_id group(s). Resolve duplicates before applying migration 006.', v_dup_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_real_provider_tx
  ON public.payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL
    AND provider <> 'SIMULATED'
    AND status IN ('PAYMENT_COMPLETED', 'COMPLETED');
