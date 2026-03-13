-- Migration 011: Only singers can add songs to repertoire
-- Purpose:
-- 1) Keep admins able to insert any repertoire item.
-- 2) Restrict minister insert to own songs and instrument containing Voz.

BEGIN;

DROP POLICY IF EXISTS "Ministers can insert own repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Singers can insert own repertoire items" ON public.repertoire;

CREATE POLICY "Singers can insert own repertoire items"
ON public.repertoire FOR INSERT
TO authenticated
WITH CHECK (
  minister_id = get_current_minister_id()
  AND EXISTS (
    SELECT 1
    FROM songs
    WHERE songs.id = repertoire.song_id
      AND songs.minister_id = get_current_minister_id()
  )
  AND EXISTS (
    SELECT 1
    FROM ministers
    WHERE ministers.id = get_current_minister_id()
      AND lower(coalesce(ministers.instrument, '')) ~ '(^|\\s*,\\s*)voz(\\s*,\\s*|$)'
  )
);

COMMIT;
