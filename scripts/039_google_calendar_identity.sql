-- WF-04, expansion only. Apply before the accompanying application release.
-- Google Calendar becomes a personal connection (one credential per auth identity),
-- while event mappings and sync selections stay scoped per church/membership.
-- The legacy google_calendar_tokens table is preserved during the transition; it is
-- never dropped or rewritten here. Existing connections are backfilled once.
BEGIN;

CREATE TABLE IF NOT EXISTS public.google_calendar_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expiry_date bigint,
  scope text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_credentials ENABLE ROW LEVEL SECURITY;
-- Same service-role-only pattern as the legacy token table: no policies on purpose.
REVOKE ALL ON public.google_calendar_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_calendar_credentials TO service_role;

COMMENT ON TABLE public.google_calendar_credentials IS
  'Personal Google Calendar OAuth credential, one per auth user. Service role only.';

CREATE TABLE IF NOT EXISTS public.google_calendar_church_sync (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  minister_id uuid NOT NULL REFERENCES public.ministers(id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, church_id)
);

ALTER TABLE public.google_calendar_church_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_calendar_church_sync FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_calendar_church_sync TO service_role;

CREATE INDEX IF NOT EXISTS google_calendar_church_sync_church_minister_idx
  ON public.google_calendar_church_sync(church_id, minister_id);

COMMENT ON TABLE public.google_calendar_church_sync IS
  'Explicit opt-in per church for a personal Google Calendar credential. Removing a row stops syncing that church without revoking the personal connection.';

-- Preserve the most recently updated credential when a legacy identity somehow has
-- more than one token row. Never revoke or delete during the backfill.
INSERT INTO public.google_calendar_credentials (
  user_id, access_token, refresh_token, expiry_date, scope, connected_at, updated_at
)
SELECT DISTINCT ON (m.user_id)
  m.user_id, t.access_token, t.refresh_token, t.expiry_date, t.scope,
  coalesce(t.connected_at, t.updated_at, now()), coalesce(t.updated_at, now())
FROM public.google_calendar_tokens t
JOIN public.ministers m ON m.id = t.minister_id
WHERE m.user_id IS NOT NULL
  AND t.refresh_token IS NOT NULL
ORDER BY m.user_id, t.updated_at DESC NULLS LAST
ON CONFLICT (user_id) DO NOTHING;

-- Every legacy connection keeps syncing its original church.
INSERT INTO public.google_calendar_church_sync (
  user_id, church_id, minister_id, enabled_at, updated_at
)
SELECT DISTINCT ON (m.user_id, coalesce(t.church_id, m.church_id))
  m.user_id, coalesce(t.church_id, m.church_id), m.id,
  coalesce(t.connected_at, t.updated_at, now()), coalesce(t.updated_at, now())
FROM public.google_calendar_tokens t
JOIN public.ministers m ON m.id = t.minister_id
WHERE m.user_id IS NOT NULL
  AND coalesce(t.church_id, m.church_id) IS NOT NULL
ORDER BY m.user_id, coalesce(t.church_id, m.church_id), t.updated_at DESC NULLS LAST
ON CONFLICT (user_id, church_id) DO NOTHING;

-- Event maps stay per membership, but carry the identity for safe account-wide
-- cleanup. Existing rows are backfilled from their minister, never recreated.
ALTER TABLE public.google_calendar_event_map
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.google_calendar_event_map em
SET user_id = m.user_id
FROM public.ministers m
WHERE em.minister_id = m.id
  AND em.user_id IS NULL
  AND m.user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS google_calendar_event_map_user_church_idx
  ON public.google_calendar_event_map(user_id, church_id);

COMMIT;
