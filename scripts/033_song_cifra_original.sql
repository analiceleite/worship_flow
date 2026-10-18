-- Additive migration: apply only to an explicitly approved environment, after 032.
-- Does not backfill or rewrite existing snapshots. Existing song RLS stays in place.
BEGIN;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS cifra_original jsonb;
ALTER TABLE public.songs ADD CONSTRAINT songs_cifra_original_v2_check CHECK (
  cifra_original IS NULL OR (
    jsonb_typeof(cifra_original) = 'object'
    AND cifra_original ? 'contract_version'
    AND cifra_original->'contract_version' = '2'::jsonb
  )
);
COMMIT;
-- Approved disposable database verification: legacy rows remain NULL; insert/update
-- object with contract_version:2 succeeds; arrays or missing/other version fail.
-- Rollback (separate approval): drop constraint and column; selected snapshot remains.
