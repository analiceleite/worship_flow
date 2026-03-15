-- Migration 014: Restrict repertoire UPDATE to admins and singers
-- Purpose:
-- Ensure only admins or ministers with the 'Voz' instrument can UPDATE repertoire rows (prevent 'midia' users from reordering).

BEGIN;

-- Remove permissive update policy if present
DROP POLICY IF EXISTS "Authenticated users can update repertoire" ON public.repertoire;

CREATE POLICY "Admins or singers can update repertoire"
  ON public.repertoire FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ministers m
      WHERE m.id = get_current_minister_id()
        AND (
          m.role = 'admin'
          OR lower(coalesce(m.instrument, '')) ~ '(^|\\s*,\\s*)voz(\\s*,\\s*|$)'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ministers m
      WHERE m.id = get_current_minister_id()
        AND (
          m.role = 'admin'
          OR lower(coalesce(m.instrument, '')) ~ '(^|\\s*,\\s*)voz(\\s*,\\s*|$)'
        )
    )
  );

COMMIT;
