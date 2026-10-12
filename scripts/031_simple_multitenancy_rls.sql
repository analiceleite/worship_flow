-- Migration 031: Tenant-aware RLS policies for simple church multitenancy

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_minister_id()
RETURNS uuid
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

CREATE OR REPLACE FUNCTION public.get_current_church_id()
RETURNS uuid
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.church_id
  FROM public.ministers m
  WHERE m.user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_church_admin(church_uuid uuid DEFAULT public.get_current_church_id())
RETURNS boolean
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministers m
    WHERE m.user_id = auth.uid()
      AND m.church_id = church_uuid
      AND m.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_church_admin(public.get_current_church_id());
$$;

CREATE OR REPLACE FUNCTION public.has_lead_voice_role(minister_uuid uuid DEFAULT public.get_current_minister_id())
RETURNS boolean
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministers m
    WHERE m.id = minister_uuid
      AND m.church_id = public.get_current_church_id()
      AND lower(coalesce(m.instrument, '')) ~ '(^|\s*,\s*)voz(\s*,\s*|$)'
  );
$$;

ALTER TABLE public.churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ministers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repertoire ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_quarters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schedule_notifications ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schedule_rehearsals ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.schedule_email_notifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schedule_email_notifications ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.google_calendar_event_map ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can view churches" ON public.churches;

CREATE POLICY "Authenticated users can view own church"
  ON public.churches FOR SELECT
  TO authenticated
  USING (id = public.get_current_church_id());

DROP POLICY IF EXISTS "Admins can view all ministers" ON public.ministers;
DROP POLICY IF EXISTS "Ministers can view their own record" ON public.ministers;
DROP POLICY IF EXISTS "Authenticated users can view all ministers" ON public.ministers;
DROP POLICY IF EXISTS "Authenticated users can view ministers" ON public.ministers;
DROP POLICY IF EXISTS "Authenticated users can view own church ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can insert ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can insert own church ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can update any minister" ON public.ministers;
DROP POLICY IF EXISTS "Admins can update ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can update own church ministers" ON public.ministers;
DROP POLICY IF EXISTS "Ministers can update their own info" ON public.ministers;
DROP POLICY IF EXISTS "Users can activate own minister record" ON public.ministers;
DROP POLICY IF EXISTS "Admins can delete ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can delete own church ministers" ON public.ministers;

CREATE POLICY "Authenticated users can view own church ministers"
  ON public.ministers FOR SELECT
  TO authenticated
  USING (church_id = public.get_current_church_id());

CREATE POLICY "Admins can insert own church ministers"
  ON public.ministers FOR INSERT
  TO authenticated
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  );

CREATE POLICY "Admins can update own church ministers"
  ON public.ministers FOR UPDATE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  )
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  );

CREATE POLICY "Users can activate own minister record"
  ON public.ministers FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND church_id = public.get_current_church_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND id = public.get_current_minister_id()
    AND church_id = public.get_current_church_id()
    AND role = (
      SELECT m.role FROM public.ministers m WHERE m.id = public.get_current_minister_id()
    )
    AND instrument IS NOT DISTINCT FROM (
      SELECT m.instrument FROM public.ministers m WHERE m.id = public.get_current_minister_id()
    )
    AND email IS NOT DISTINCT FROM (
      SELECT m.email FROM public.ministers m WHERE m.id = public.get_current_minister_id()
    )
    AND name IS NOT DISTINCT FROM (
      SELECT m.name FROM public.ministers m WHERE m.id = public.get_current_minister_id()
    )
  );

CREATE POLICY "Admins can delete own church ministers"
  ON public.ministers FOR DELETE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  );

DROP POLICY IF EXISTS "Authenticated users can view all songs" ON public.songs;
DROP POLICY IF EXISTS "Authenticated users can view songs" ON public.songs;
DROP POLICY IF EXISTS "Authenticated users can view own church songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can insert own church songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can update songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can update own church songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can delete songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can delete own church songs" ON public.songs;

CREATE POLICY "Authenticated users can view own church songs"
  ON public.songs FOR SELECT
  TO authenticated
  USING (church_id = public.get_current_church_id());

CREATE POLICY "Admins or lead singers can insert own church songs"
  ON public.songs FOR INSERT
  TO authenticated
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND (
      public.is_church_admin(church_id)
      OR (
        public.has_lead_voice_role()
        AND minister_id = public.get_current_minister_id()
      )
    )
  );

CREATE POLICY "Admins or lead singers can update own church songs"
  ON public.songs FOR UPDATE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (
      public.is_church_admin(church_id)
      OR (
        public.has_lead_voice_role()
        AND minister_id = public.get_current_minister_id()
      )
    )
  )
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND (
      public.is_church_admin(church_id)
      OR (
        public.has_lead_voice_role()
        AND minister_id = public.get_current_minister_id()
      )
    )
  );

CREATE POLICY "Admins or lead singers can delete own church songs"
  ON public.songs FOR DELETE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (
      public.is_church_admin(church_id)
      OR (
        public.has_lead_voice_role()
        AND minister_id = public.get_current_minister_id()
      )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can view repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Authenticated users can view own church repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins can insert repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Admins can insert own church repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Lead singers can insert own repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Lead singers can insert own church repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or lead singers can update repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or lead singers can update own church repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or lead singers can delete repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or lead singers can delete own church repertoire" ON public.repertoire;

CREATE POLICY "Authenticated users can view own church repertoire"
  ON public.repertoire FOR SELECT
  TO authenticated
  USING (church_id = public.get_current_church_id());

CREATE POLICY "Admins can insert own church repertoire items"
  ON public.repertoire FOR INSERT
  TO authenticated
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  );

CREATE POLICY "Lead singers can insert own church repertoire items"
  ON public.repertoire FOR INSERT
  TO authenticated
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND minister_id = public.get_current_minister_id()
    AND public.has_lead_voice_role()
    AND EXISTS (
      SELECT 1
      FROM public.songs s
      WHERE s.id = public.repertoire.song_id
        AND s.church_id = public.repertoire.church_id
    )
  );

CREATE POLICY "Admins or lead singers can update own church repertoire"
  ON public.repertoire FOR UPDATE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (public.is_church_admin(church_id) OR public.has_lead_voice_role())
  )
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND (public.is_church_admin(church_id) OR public.has_lead_voice_role())
  );

CREATE POLICY "Admins or lead singers can delete own church repertoire"
  ON public.repertoire FOR DELETE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (public.is_church_admin(church_id) OR public.has_lead_voice_role())
  );

DROP POLICY IF EXISTS "Authenticated users can view special events" ON public.special_events;
DROP POLICY IF EXISTS "Authenticated users can view own church special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or non-media ministers can insert special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or non-media ministers can insert own church special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or creators can update special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or creators can update own church special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or creators can delete special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or creators can delete own church special events" ON public.special_events;

CREATE POLICY "Authenticated users can view own church special events"
  ON public.special_events FOR SELECT
  TO authenticated
  USING (church_id = public.get_current_church_id());

CREATE POLICY "Admins or non-media ministers can insert own church special events"
  ON public.special_events FOR INSERT
  TO authenticated
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND (
      public.is_church_admin(church_id)
      OR EXISTS (
        SELECT 1
        FROM public.ministers m
        WHERE m.id = public.get_current_minister_id()
          AND m.church_id = public.special_events.church_id
          AND m.role <> 'midia'
          AND m.is_active = true
      )
    )
  );

CREATE POLICY "Admins or creators can update own church special events"
  ON public.special_events FOR UPDATE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (public.is_church_admin(church_id) OR created_by = public.get_current_minister_id())
  )
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND (public.is_church_admin(church_id) OR created_by = public.get_current_minister_id())
  );

CREATE POLICY "Admins or creators can delete own church special events"
  ON public.special_events FOR DELETE
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (public.is_church_admin(church_id) OR created_by = public.get_current_minister_id())
  );

DROP POLICY IF EXISTS "Authenticated users can view own church schedule quarters" ON public.schedule_quarters;
DROP POLICY IF EXISTS "Admins can manage own church schedule quarters" ON public.schedule_quarters;

CREATE POLICY "Authenticated users can view own church schedule quarters"
  ON public.schedule_quarters FOR SELECT
  TO authenticated
  USING (church_id = public.get_current_church_id());

CREATE POLICY "Admins can manage own church schedule quarters"
  ON public.schedule_quarters FOR ALL
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  )
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  );

DROP POLICY IF EXISTS "Authenticated users can view own church schedule assignments" ON public.schedule_assignments;
DROP POLICY IF EXISTS "Admins can manage own church schedule assignments" ON public.schedule_assignments;

CREATE POLICY "Authenticated users can view own church schedule assignments"
  ON public.schedule_assignments FOR SELECT
  TO authenticated
  USING (church_id = public.get_current_church_id());

CREATE POLICY "Admins can manage own church schedule assignments"
  ON public.schedule_assignments FOR ALL
  TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  )
  WITH CHECK (
    church_id = public.get_current_church_id()
    AND public.is_church_admin(church_id)
  );

DO $$
BEGIN
  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can view own church schedule notifications" ON public.schedule_notifications';
    EXECUTE 'CREATE POLICY "Authenticated users can view own church schedule notifications"
      ON public.schedule_notifications FOR SELECT
      TO authenticated
      USING (church_id = public.get_current_church_id())';
  END IF;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can view own church schedule rehearsals" ON public.schedule_rehearsals';
    EXECUTE 'DROP POLICY IF EXISTS "Admins or ministers can manage own church schedule rehearsals" ON public.schedule_rehearsals';

    EXECUTE 'CREATE POLICY "Authenticated users can view own church schedule rehearsals"
      ON public.schedule_rehearsals FOR SELECT
      TO authenticated
      USING (church_id = public.get_current_church_id())';

    EXECUTE 'CREATE POLICY "Admins or ministers can manage own church schedule rehearsals"
      ON public.schedule_rehearsals FOR ALL
      TO authenticated
      USING (
        church_id = public.get_current_church_id()
        AND EXISTS (
          SELECT 1
          FROM public.ministers m
          WHERE m.id = public.get_current_minister_id()
            AND m.church_id = public.schedule_rehearsals.church_id
            AND m.role IN (''admin'', ''minister'')
        )
      )
      WITH CHECK (
        church_id = public.get_current_church_id()
        AND EXISTS (
          SELECT 1
          FROM public.ministers m
          WHERE m.id = public.get_current_minister_id()
            AND m.church_id = public.schedule_rehearsals.church_id
            AND m.role IN (''admin'', ''minister'')
        )
      )';
  END IF;
END $$;

-- Email queue and Google Calendar integration tables intentionally keep RLS without client policies.
-- They are accessed through service role code paths that must apply church_id explicitly.

COMMIT;
