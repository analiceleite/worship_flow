-- Migration 016: Consolidate access control policies
-- Purpose:
-- 1) Replace overlapping legacy RLS policies with one consistent set.
-- 2) Keep the current product rules aligned between UI and database.
-- 3) Normalize helpers and the ministers.role constraint to support 'midia'.

BEGIN;

-- Keep helper functions consistent and reusable across policies.
CREATE OR REPLACE FUNCTION public.get_current_minister_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.ministers m
  WHERE m.user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministers m
    WHERE m.user_id = auth.uid()
      AND m.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_lead_voice_role(minister_uuid UUID DEFAULT public.get_current_minister_id())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministers m
    WHERE m.id = minister_uuid
      AND lower(coalesce(m.instrument, '')) ~ '(^|\s*,\s*)voz(\s*,\s*|$)'
  );
$$;

-- Ensure the current application roles are accepted by the database.
ALTER TABLE public.ministers
  ALTER COLUMN role SET DEFAULT 'minister';

ALTER TABLE public.ministers
  DROP CONSTRAINT IF EXISTS ministers_role_check;

ALTER TABLE public.ministers
  ADD CONSTRAINT ministers_role_check
  CHECK (role IN ('admin', 'minister', 'midia'));

ALTER TABLE public.ministers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repertoire ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regclass('public.special_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.special_events ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.schedule_email_notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schedule_email_notifications ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Remove legacy and intermediate policies on ministers.
DROP POLICY IF EXISTS "Admins can view all ministers" ON public.ministers;
DROP POLICY IF EXISTS "Ministers can view their own record" ON public.ministers;
DROP POLICY IF EXISTS "Authenticated users can view all ministers" ON public.ministers;
DROP POLICY IF EXISTS "Authenticated users can view ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can insert ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can update any minister" ON public.ministers;
DROP POLICY IF EXISTS "Admins can update ministers" ON public.ministers;
DROP POLICY IF EXISTS "Ministers can update their own info" ON public.ministers;
DROP POLICY IF EXISTS "Users can activate own minister record" ON public.ministers;
DROP POLICY IF EXISTS "Admins can delete ministers" ON public.ministers;

CREATE POLICY "Authenticated users can view ministers"
  ON public.ministers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert ministers"
  ON public.ministers FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update ministers"
  ON public.ministers FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can activate own minister record"
  ON public.ministers FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND id = public.get_current_minister_id()
    AND role = (
      SELECT m.role
      FROM public.ministers m
      WHERE m.id = public.get_current_minister_id()
    )
    AND instrument IS NOT DISTINCT FROM (
      SELECT m.instrument
      FROM public.ministers m
      WHERE m.id = public.get_current_minister_id()
    )
    AND email IS NOT DISTINCT FROM (
      SELECT m.email
      FROM public.ministers m
      WHERE m.id = public.get_current_minister_id()
    )
    AND name IS NOT DISTINCT FROM (
      SELECT m.name
      FROM public.ministers m
      WHERE m.id = public.get_current_minister_id()
    )
  );

CREATE POLICY "Admins can delete ministers"
  ON public.ministers FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Remove legacy and intermediate policies on songs.
DROP POLICY IF EXISTS "Authenticated users can view all songs" ON public.songs;
DROP POLICY IF EXISTS "Authenticated users can view songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can select songs" ON public.songs;
DROP POLICY IF EXISTS "Ministers can insert their own songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or singers can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Ministers can update their own songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can update songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or singers can update songs" ON public.songs;
DROP POLICY IF EXISTS "Ministers can delete their own songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or owners can delete songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or singers can delete songs" ON public.songs;

CREATE POLICY "Authenticated users can view songs"
  ON public.songs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins or lead singers can insert songs"
  ON public.songs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.has_lead_voice_role()
      AND minister_id = public.get_current_minister_id()
    )
  );

CREATE POLICY "Admins or lead singers can update songs"
  ON public.songs FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR (
      public.has_lead_voice_role()
      AND minister_id = public.get_current_minister_id()
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.has_lead_voice_role()
      AND minister_id = public.get_current_minister_id()
    )
  );

CREATE POLICY "Admins or lead singers can delete songs"
  ON public.songs FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
    OR (
      public.has_lead_voice_role()
      AND minister_id = public.get_current_minister_id()
    )
  );

-- Remove legacy and intermediate policies on repertoire.
DROP POLICY IF EXISTS "Authenticated users can view repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins can insert repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Ministers can insert own repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Singers can insert own repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Admins can update repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Authenticated users can update repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or singers can update repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Ministers can delete own repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Admins can delete repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or singers can delete repertoire" ON public.repertoire;

CREATE POLICY "Authenticated users can view repertoire"
  ON public.repertoire FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert repertoire items"
  ON public.repertoire FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Lead singers can insert own repertoire items"
  ON public.repertoire FOR INSERT
  TO authenticated
  WITH CHECK (
    minister_id = public.get_current_minister_id()
    AND public.has_lead_voice_role()
    AND EXISTS (
      SELECT 1
      FROM public.songs s
      WHERE s.id = public.repertoire.song_id
        AND s.minister_id = public.get_current_minister_id()
    )
  );

CREATE POLICY "Admins or lead singers can update repertoire"
  ON public.repertoire FOR UPDATE
  TO authenticated
  USING (public.is_admin() OR public.has_lead_voice_role())
  WITH CHECK (public.is_admin() OR public.has_lead_voice_role());

CREATE POLICY "Admins or lead singers can delete repertoire"
  ON public.repertoire FOR DELETE
  TO authenticated
  USING (public.is_admin() OR public.has_lead_voice_role());

-- Remove legacy and intermediate policies on special events.
DO $$
BEGIN
  IF to_regclass('public.special_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can view special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Admins can insert special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Ministers can insert special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Admins or ministers can insert special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Admins can update special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Ministers can update own special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Admins or creators can update special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Admins can delete special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Ministers can delete own special events" ON public.special_events';
    EXECUTE 'DROP POLICY IF EXISTS "Admins or creators can delete special events" ON public.special_events';

    EXECUTE 'CREATE POLICY "Authenticated users can view special events"
      ON public.special_events FOR SELECT
      TO authenticated
      USING (true)';

    EXECUTE 'CREATE POLICY "Admins or non-media ministers can insert special events"
      ON public.special_events FOR INSERT
      TO authenticated
      WITH CHECK (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.ministers m
          WHERE m.id = public.get_current_minister_id()
            AND m.role <> ''midia''
            AND m.is_active = true
        )
      )';

    EXECUTE 'CREATE POLICY "Admins or creators can update special events"
      ON public.special_events FOR UPDATE
      TO authenticated
      USING (public.is_admin() OR created_by = public.get_current_minister_id())
      WITH CHECK (public.is_admin() OR created_by = public.get_current_minister_id())';

    EXECUTE 'CREATE POLICY "Admins or creators can delete special events"
      ON public.special_events FOR DELETE
      TO authenticated
      USING (public.is_admin() OR created_by = public.get_current_minister_id())';
  END IF;
END $$;

COMMIT;