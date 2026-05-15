-- Migration 022: PDF/image cifra storage + YouTube video title

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS cifra_pdf_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS youtube_video_title TEXT NULL;

COMMENT ON COLUMN public.songs.cifra_pdf_path IS
  'Path no bucket storage cifras, ex.: {songId}/cifra.pdf';

COMMENT ON COLUMN public.songs.youtube_video_title IS
  'Título do vídeo do YouTube escolhido na busca';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cifras',
  'cifras',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Authenticated users can read cifras" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload cifras" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update cifras" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete cifras" ON storage.objects;

CREATE POLICY "Authenticated users can read cifras"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'cifras');

CREATE POLICY "Authenticated users can upload cifras"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'cifras');

CREATE POLICY "Authenticated users can update cifras"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'cifras')
  WITH CHECK (bucket_id = 'cifras');

CREATE POLICY "Authenticated users can delete cifras"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'cifras');
