-- Migration 008: Special events ownership
-- Adds created_by to special_events and sets up RLS so ministers
-- can manage events they created (admins can manage all).

BEGIN;

-- 1. Create special_events table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS public.special_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add created_by column (nullable so old rows are unaffected)
ALTER TABLE public.special_events
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.ministers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_special_events_created_by
  ON public.special_events(created_by);

CREATE INDEX IF NOT EXISTS idx_special_events_event_date
  ON public.special_events(event_date);

-- 3. Enable RLS
ALTER TABLE public.special_events ENABLE ROW LEVEL SECURITY;

-- 4. Drop old policies (if any) before recreating
DROP POLICY IF EXISTS "Authenticated users can view special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins can insert special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins can update special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins can delete special events" ON public.special_events;
DROP POLICY IF EXISTS "Ministers can insert special events" ON public.special_events;
DROP POLICY IF EXISTS "Ministers can update own special events" ON public.special_events;
DROP POLICY IF EXISTS "Ministers can delete own special events" ON public.special_events;

-- 5. SELECT: all authenticated users
CREATE POLICY "Authenticated users can view special events"
  ON public.special_events FOR SELECT
  TO authenticated
  USING (true);

-- 6. INSERT: admins or any active minister
CREATE POLICY "Admins or ministers can insert special events"
  ON public.special_events FOR INSERT
  TO authenticated
  WITH CHECK (is_admin() OR get_current_minister_id() IS NOT NULL);

-- 7. UPDATE: admin or the creator
CREATE POLICY "Admins or creators can update special events"
  ON public.special_events FOR UPDATE
  TO authenticated
  USING (is_admin() OR created_by = get_current_minister_id())
  WITH CHECK (is_admin() OR created_by = get_current_minister_id());

-- 8. DELETE: admin or the creator
CREATE POLICY "Admins or creators can delete special events"
  ON public.special_events FOR DELETE
  TO authenticated
  USING (is_admin() OR created_by = get_current_minister_id());

COMMIT;
