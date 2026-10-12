-- Migration 030: Base schema for simple church multitenancy
-- Adds churches, platform admins, impersonation audit, and nullable church_id columns.

BEGIN;

CREATE TABLE IF NOT EXISTS public.churches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'demo', 'test')),
  email_mode text NOT NULL DEFAULT 'real' CHECK (email_mode IN ('real', 'disabled', 'test_recipient')),
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT churches_demo_test_no_real_email CHECK (
    environment = 'production' OR email_mode <> 'real'
  )
);

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.platform_impersonation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES auth.users(id),
  church_id uuid NOT NULL REFERENCES public.churches(id),
  action text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.churches (name, slug, status, environment, email_mode, plan)
VALUES ('Worship Flow Default', 'worship-flow-default', 'active', 'production', 'real', 'free')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.ministers
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

ALTER TABLE public.repertoire
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

ALTER TABLE public.special_events
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

ALTER TABLE public.schedule_quarters
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

ALTER TABLE public.schedule_assignments
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

ALTER TABLE public.schedule_email_notifications
  ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    ALTER TABLE public.schedule_notifications
      ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;
  END IF;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    ALTER TABLE public.schedule_rehearsals
      ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;
  END IF;

  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    ALTER TABLE public.google_calendar_tokens
      ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;
  END IF;

  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    ALTER TABLE public.google_calendar_event_map
      ADD COLUMN IF NOT EXISTS church_id uuid REFERENCES public.churches(id) ON DELETE RESTRICT;
  END IF;
END $$;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.ministers
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.songs
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.repertoire
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.special_events
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.schedule_quarters
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.schedule_assignments
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

WITH default_church AS (
  SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
)
UPDATE public.schedule_email_notifications
SET church_id = (SELECT id FROM default_church)
WHERE church_id IS NULL;

DO $$
BEGIN
  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    EXECUTE $sql$
      WITH default_church AS (
        SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
      )
      UPDATE public.schedule_notifications
      SET church_id = (SELECT id FROM default_church)
      WHERE church_id IS NULL
    $sql$;
  END IF;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    EXECUTE $sql$
      WITH default_church AS (
        SELECT id FROM public.churches WHERE slug = 'worship-flow-default'
      )
      UPDATE public.schedule_rehearsals
      SET church_id = (SELECT id FROM default_church)
      WHERE church_id IS NULL
    $sql$;
  END IF;

  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.google_calendar_tokens gct
      SET church_id = m.church_id
      FROM public.ministers m
      WHERE gct.minister_id = m.id
        AND gct.church_id IS NULL
    $sql$;
  END IF;

  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.google_calendar_event_map gcem
      SET church_id = m.church_id
      FROM public.ministers m
      WHERE gcem.minister_id = m.id
        AND gcem.church_id IS NULL
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS churches_status_idx ON public.churches(status);
CREATE INDEX IF NOT EXISTS churches_environment_idx ON public.churches(environment);
CREATE INDEX IF NOT EXISTS platform_impersonation_audit_platform_user_idx ON public.platform_impersonation_audit(platform_user_id);
CREATE INDEX IF NOT EXISTS platform_impersonation_audit_church_idx ON public.platform_impersonation_audit(church_id);
CREATE INDEX IF NOT EXISTS platform_impersonation_audit_created_at_idx ON public.platform_impersonation_audit(created_at);

CREATE INDEX IF NOT EXISTS ministers_church_id_idx ON public.ministers(church_id);
CREATE INDEX IF NOT EXISTS ministers_church_active_idx ON public.ministers(church_id, is_active);
CREATE INDEX IF NOT EXISTS songs_church_id_idx ON public.songs(church_id);
CREATE INDEX IF NOT EXISTS songs_church_title_idx ON public.songs(church_id, title);
CREATE INDEX IF NOT EXISTS repertoire_church_event_idx ON public.repertoire(church_id, event_date, event_name);
CREATE INDEX IF NOT EXISTS special_events_church_event_idx ON public.special_events(church_id, event_date);
CREATE INDEX IF NOT EXISTS schedule_quarters_church_dates_idx ON public.schedule_quarters(church_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS schedule_quarters_church_published_idx ON public.schedule_quarters(church_id, is_published);
CREATE INDEX IF NOT EXISTS schedule_assignments_church_quarter_idx ON public.schedule_assignments(church_id, quarter_id);
CREATE INDEX IF NOT EXISTS schedule_assignments_church_event_idx ON public.schedule_assignments(church_id, event_date, event_type);
CREATE INDEX IF NOT EXISTS schedule_email_notifications_church_status_idx ON public.schedule_email_notifications(church_id, status);
DO $$
BEGIN
  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS schedule_notifications_church_event_idx
      ON public.schedule_notifications(church_id, event_date, event_type);
  END IF;

  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS schedule_rehearsals_church_quarter_idx
      ON public.schedule_rehearsals(church_id, quarter_id);
  END IF;

  IF to_regclass('public.google_calendar_tokens') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS google_calendar_tokens_church_idx
      ON public.google_calendar_tokens(church_id);
  END IF;

  IF to_regclass('public.google_calendar_event_map') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS google_calendar_event_map_church_minister_idx
      ON public.google_calendar_event_map(church_id, minister_id);
  END IF;
END $$;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_impersonation_audit ENABLE ROW LEVEL SECURITY;

COMMIT;
