-- Migration 032: Final hardening for simple church multitenancy
-- Run after application code writes church_id for all tenant-scoped records.

BEGIN;

DO $$
DECLARE
  table_name text;
  null_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ministers',
    'songs',
    'repertoire',
    'special_events',
    'schedule_quarters',
    'schedule_assignments',
    'schedule_email_notifications'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE church_id IS NULL', table_name) INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot harden %.church_id: % rows are null', table_name, null_count;
    END IF;
  END LOOP;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.schedule_rehearsals WHERE church_id IS NULL' INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot harden schedule_rehearsals.church_id: % rows are null', null_count;
    END IF;
  END IF;

  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.schedule_notifications WHERE church_id IS NULL' INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot harden schedule_notifications.church_id: % rows are null', null_count;
    END IF;
  END IF;

  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.google_calendar_tokens WHERE church_id IS NULL' INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot harden google_calendar_tokens.church_id: % rows are null', null_count;
    END IF;
  END IF;

  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.google_calendar_event_map WHERE church_id IS NULL' INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot harden google_calendar_event_map.church_id: % rows are null', null_count;
    END IF;
  END IF;
END $$;

ALTER TABLE public.ministers ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE public.songs ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE public.repertoire ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE public.special_events ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE public.schedule_quarters ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE public.schedule_assignments ALTER COLUMN church_id SET NOT NULL;
ALTER TABLE public.schedule_email_notifications ALTER COLUMN church_id SET NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    ALTER TABLE public.schedule_notifications ALTER COLUMN church_id SET NOT NULL;
  END IF;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    ALTER TABLE public.schedule_rehearsals ALTER COLUMN church_id SET NOT NULL;
  END IF;

  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    ALTER TABLE public.google_calendar_tokens ALTER COLUMN church_id SET NOT NULL;
  END IF;

  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    ALTER TABLE public.google_calendar_event_map ALTER COLUMN church_id SET NOT NULL;
  END IF;
END $$;

-- A user belongs to a single church in this product model.
CREATE UNIQUE INDEX IF NOT EXISTS ministers_user_id_unique_idx
  ON public.ministers(user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_quarters_one_published_per_church_idx
  ON public.schedule_quarters(church_id)
  WHERE is_published = true;

-- Keep existing dedupe_key uniqueness for compatibility, but add tenant-aware uniqueness too.
CREATE UNIQUE INDEX IF NOT EXISTS schedule_email_notifications_church_dedupe_idx
  ON public.schedule_email_notifications(church_id, dedupe_key);

CREATE UNIQUE INDEX IF NOT EXISTS repertoire_church_event_order_idx
  ON public.repertoire(church_id, event_date, coalesce(event_name, ''), order_index, id);

DO $$
BEGIN
  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_event_map_church_minister_event_key_idx
      ON public.google_calendar_event_map(church_id, minister_id, event_key);
  END IF;
END $$;

-- Add composite unique keys that allow future same-tenant FK checks/triggers if needed.
CREATE UNIQUE INDEX IF NOT EXISTS ministers_church_id_id_unique_idx
  ON public.ministers(church_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS songs_church_id_id_unique_idx
  ON public.songs(church_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_quarters_church_id_id_unique_idx
  ON public.schedule_quarters(church_id, id);

COMMIT;
