-- Migration 009: Allow all authenticated users to update repertoire rows
-- Needed to support shared song ordering from UI lock/reorder mode.

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can update repertoire" ON public.repertoire;

CREATE POLICY "Authenticated users can update repertoire"
  ON public.repertoire FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
