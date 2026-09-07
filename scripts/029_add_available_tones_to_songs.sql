-- Migration 029: Persist available tones for imported cifras
-- Purpose:
-- Keep tone options available when editing a song without reimporting first.

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS available_tones text[] DEFAULT '{}'::text[];

COMMENT ON COLUMN public.songs.available_tones IS
  'Tons disponiveis retornados pela fonte da cifra no momento da importacao.';
