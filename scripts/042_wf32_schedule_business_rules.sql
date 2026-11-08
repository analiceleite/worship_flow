-- WF-32: event ownership/cancellation, church timezone, and quarter overlap guard.
BEGIN;

ALTER TABLE public.churches
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE public.schedule_quarters
  ADD COLUMN IF NOT EXISTS publication_revision integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.schedule_event_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  quarter_id uuid NOT NULL REFERENCES public.schedule_quarters(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('thursday', 'sunday')),
  leader_minister_id uuid REFERENCES public.ministers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.ministers(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (church_id, quarter_id, event_date, event_type)
);

CREATE INDEX IF NOT EXISTS schedule_event_controls_church_quarter_idx
  ON public.schedule_event_controls(church_id, quarter_id, event_date);

ALTER TABLE public.schedule_event_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf32_event_controls_read ON public.schedule_event_controls
  FOR SELECT TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (
      public.wf04_current_role(church_id) = 'admin'
      OR EXISTS (
        SELECT 1 FROM public.schedule_quarters q
        WHERE q.id = schedule_event_controls.quarter_id
          AND q.church_id = schedule_event_controls.church_id
          AND q.is_published = true
      )
    )
  );
-- All writes go through authenticated API routes using server-side authorization.

-- Drafts are private even through direct PostgREST access. Apply restrictively so
-- older permissive policies cannot widen draft visibility.
DROP POLICY IF EXISTS wf32_quarters_published_or_admin ON public.schedule_quarters;
CREATE POLICY wf32_quarters_published_or_admin ON public.schedule_quarters
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.wf04_current_role(church_id) = 'admin' OR is_published = true);

DROP POLICY IF EXISTS wf32_assignments_published_or_admin ON public.schedule_assignments;
CREATE POLICY wf32_assignments_published_or_admin ON public.schedule_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.wf04_current_role(church_id) = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.schedule_quarters q
      WHERE q.id = schedule_assignments.quarter_id
        AND q.church_id = schedule_assignments.church_id
        AND q.is_published = true
    )
  );

DO $$
BEGIN
  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    DROP POLICY IF EXISTS wf32_rehearsals_published_or_admin ON public.schedule_rehearsals;
    CREATE POLICY wf32_rehearsals_published_or_admin ON public.schedule_rehearsals
      AS RESTRICTIVE FOR SELECT TO authenticated
      USING (
        public.wf04_current_role(church_id) = 'admin'
        OR EXISTS (
          SELECT 1 FROM public.schedule_quarters q
          WHERE q.id = schedule_rehearsals.quarter_id
            AND q.church_id = schedule_rehearsals.church_id
            AND q.is_published = true
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.schedule_conflict_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  quarter_id uuid NOT NULL REFERENCES public.schedule_quarters(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.schedule_assignments(id) ON DELETE SET NULL,
  minister_id uuid NOT NULL REFERENCES public.ministers(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('thursday', 'sunday')),
  conflict_event_date date NOT NULL,
  conflict_event_type text NOT NULL CHECK (conflict_event_type IN ('thursday', 'sunday')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  overridden_by uuid NOT NULL REFERENCES public.ministers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedule_conflict_overrides ENABLE ROW LEVEL SECURITY;
-- No authenticated policies: override audit is available only through privileged server routes.

CREATE TABLE IF NOT EXISTS public.song_ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
  from_minister_id uuid NOT NULL REFERENCES public.ministers(id) ON DELETE RESTRICT,
  to_minister_id uuid NOT NULL REFERENCES public.ministers(id) ON DELETE RESTRICT,
  transferred_by uuid NOT NULL REFERENCES public.ministers(id) ON DELETE RESTRICT,
  songs_count integer NOT NULL CHECK (songs_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_minister_id <> to_minister_id)
);
ALTER TABLE public.song_ownership_transfers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.wf32_transfer_song_ownership(
  p_church_id uuid,
  p_from_minister_id uuid,
  p_to_minister_id uuid,
  p_actor_minister_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE moved_count integer;
BEGIN
  IF p_from_minister_id = p_to_minister_id OR NOT EXISTS (
    SELECT 1 FROM public.ministers actor
    WHERE actor.id = p_actor_minister_id
      AND actor.church_id = p_church_id
      AND actor.role = 'admin'
      AND actor.is_active = true
      AND actor.access_state = 'active'
  ) THEN
    RAISE EXCEPTION 'WF32_FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ministers target
    WHERE target.id = p_to_minister_id
      AND target.church_id = p_church_id
      AND target.is_active = true
      AND target.access_state = 'active'
  ) THEN
    RAISE EXCEPTION 'WF32_INVALID_TRANSFER_TARGET';
  END IF;

  UPDATE public.songs
  SET minister_id = p_to_minister_id
  WHERE church_id = p_church_id AND minister_id = p_from_minister_id;
  GET DIAGNOSTICS moved_count = ROW_COUNT;

  INSERT INTO public.song_ownership_transfers (
    church_id, from_minister_id, to_minister_id, transferred_by, songs_count
  ) VALUES (p_church_id, p_from_minister_id, p_to_minister_id, p_actor_minister_id, moved_count);
  RETURN moved_count;
END;
$$;
REVOKE ALL ON FUNCTION public.wf32_transfer_song_ownership(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf32_transfer_song_ownership(uuid, uuid, uuid, uuid) TO service_role;

ALTER TABLE public.schedule_email_notifications
  DROP CONSTRAINT IF EXISTS schedule_email_notifications_notification_type_check;
ALTER TABLE public.schedule_email_notifications
  ADD CONSTRAINT schedule_email_notifications_notification_type_check
  CHECK (notification_type = ANY (ARRAY[
    'quarter_published', 'reminder_7days', 'reminder_1day', 'reminder_offset',
    'schedule_changed', 'event_cancelled', 'event_reactivated'
  ]));

CREATE OR REPLACE FUNCTION public.wf32_reject_overlapping_quarters()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.start_date > NEW.end_date THEN
    RAISE EXCEPTION 'WF32_INVALID_QUARTER_RANGE';
  END IF;

  -- Serialize writes for one church so concurrent requests cannot create overlaps.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.church_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.schedule_quarters q
    WHERE q.church_id = NEW.church_id
      AND q.id IS DISTINCT FROM NEW.id
      AND NEW.start_date <= q.end_date
      AND NEW.end_date >= q.start_date
  ) THEN
    RAISE EXCEPTION 'WF32_QUARTER_OVERLAP';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wf32_schedule_quarter_no_overlap ON public.schedule_quarters;
CREATE TRIGGER wf32_schedule_quarter_no_overlap
  BEFORE INSERT OR UPDATE OF church_id, start_date, end_date
  ON public.schedule_quarters
  FOR EACH ROW EXECUTE FUNCTION public.wf32_reject_overlapping_quarters();

COMMIT;
