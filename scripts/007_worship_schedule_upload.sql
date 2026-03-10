-- Migration 007: Upload and sharing of worship schedule files (Excel/PDF)

BEGIN;

-- Metadata table for uploaded schedules
CREATE TABLE IF NOT EXISTS public.worship_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT,
  uploaded_by UUID REFERENCES public.ministers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worship_schedules_created_at
  ON public.worship_schedules(created_at DESC);

ALTER TABLE public.worship_schedules ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can see uploaded schedules metadata
DROP POLICY IF EXISTS "Authenticated users can view worship schedules" ON public.worship_schedules;
CREATE POLICY "Authenticated users can view worship schedules"
  ON public.worship_schedules FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can insert/delete schedule metadata
DROP POLICY IF EXISTS "Admins can insert worship schedules" ON public.worship_schedules;
CREATE POLICY "Admins can insert worship schedules"
  ON public.worship_schedules FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admins can delete worship schedules" ON public.worship_schedules;
CREATE POLICY "Admins can delete worship schedules"
  ON public.worship_schedules FOR DELETE
  TO authenticated
  USING (is_admin());

-- Storage bucket for files
INSERT INTO storage.buckets (id, name, public)
VALUES ('worship-schedules', 'worship-schedules', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can read files from this bucket
DROP POLICY IF EXISTS "Authenticated users can read worship schedule files" ON storage.objects;
CREATE POLICY "Authenticated users can read worship schedule files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'worship-schedules');

-- Admins can upload/delete files in this bucket
DROP POLICY IF EXISTS "Admins can upload worship schedule files" ON storage.objects;
CREATE POLICY "Admins can upload worship schedule files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'worship-schedules' AND is_admin());

DROP POLICY IF EXISTS "Admins can delete worship schedule files" ON storage.objects;
CREATE POLICY "Admins can delete worship schedule files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'worship-schedules' AND is_admin());

COMMIT;
