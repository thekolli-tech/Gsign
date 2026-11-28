-- Migration 007: Revoke DELETE on public.payment_receipts (financial records are append/acknowledge-only)
DO $$
BEGIN
  IF to_regclass('public.payment_receipts') IS NOT NULL THEN
    REVOKE DELETE ON TABLE public.payment_receipts FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
      REVOKE DELETE ON TABLE public.payment_receipts FROM gsign_app;
    END IF;
  END IF;
END
$$;
