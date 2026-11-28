-- Staging-Only Database Identity Marker Setup
-- Execute ONLY against an isolated STAGING database as neondb_owner.
-- NEVER execute this script against production.
--
-- Usage:
--   Set session setting app.staging_identity_marker before running, e.g.:
--   SELECT set_config('app.staging_identity_marker', '<unique-staging-marker>', false);

BEGIN;

CREATE TABLE IF NOT EXISTS public.db_environment_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  environment_type VARCHAR(32) NOT NULL,
  environment_marker VARCHAR(128) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  v_marker TEXT := NULLIF(current_setting('app.staging_identity_marker', true), '');
BEGIN
  IF v_marker IS NULL THEN
    RAISE EXCEPTION 'Session setting app.staging_identity_marker is required.';
  END IF;

  INSERT INTO public.db_environment_identity (id, environment_type, environment_marker, updated_at)
  VALUES (1, 'staging', v_marker, NOW())
  ON CONFLICT (id) DO UPDATE SET
    environment_type = 'staging',
    environment_marker = EXCLUDED.environment_marker,
    updated_at = NOW();
END
$$;

REVOKE ALL ON TABLE public.db_environment_identity FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gsign_app') THEN
    REVOKE ALL ON TABLE public.db_environment_identity FROM gsign_app;
    GRANT SELECT ON TABLE public.db_environment_identity TO gsign_app;
  END IF;
END
$$;

COMMIT;

RESET app.staging_identity_marker;
