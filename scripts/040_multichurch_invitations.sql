-- WF-04, expansion only. Apply before the invitation-enabled application release.
-- This migration does three related things:
--   1. Replaces single-church LIMIT 1 authorization helpers/policies with
--      set-based checks for the church_id of each row.
--   2. Adds persistent invitation, outbox and rate-limit storage.
--   3. Adds transactional invitation creation, rotation, revocation and accept.
-- The legacy unique indexes on ministers.user_id/email are intentionally kept
-- until every consumer has been migrated to explicit memberships.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Set-based authorization helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf04_current_membership_id(p_church uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id
  FROM public.ministers m
  JOIN public.churches c ON c.id = m.church_id
  WHERE m.user_id = auth.uid()
    AND m.church_id = p_church
    AND m.access_state = 'active'
    AND c.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.wf04_current_role(p_church uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role
  FROM public.ministers m
  JOIN public.churches c ON c.id = m.church_id
  WHERE m.user_id = auth.uid()
    AND m.church_id = p_church
    AND m.access_state = 'active'
    AND c.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.wf04_is_active_church_admin(p_church uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministers m
    JOIN public.churches c ON c.id = m.church_id
    WHERE m.user_id = auth.uid()
      AND m.church_id = p_church
      AND m.role = 'admin'
      AND m.access_state = 'active'
      AND c.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.wf04_has_lead_voice_role(p_minister uuid, p_church uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ministers m
    WHERE m.id = p_minister
      AND m.church_id = p_church
      AND m.access_state = 'active'
      AND lower(coalesce(m.instrument, '')) ~ '(^|\s*,\s*)voz(\s*,\s*|$)'
  );
$$;

REVOKE ALL ON FUNCTION public.wf04_current_membership_id(uuid), public.wf04_current_role(uuid),
  public.wf04_is_active_church_admin(uuid), public.wf04_has_lead_voice_role(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf04_current_membership_id(uuid), public.wf04_current_role(uuid),
  public.wf04_is_active_church_admin(uuid), public.wf04_has_lead_voice_role(uuid, uuid)
  TO authenticated, service_role;

-- A tenant id is immutable even when the same person administers both churches.
-- This closes the UPDATE ... SET church_id hole that RLS alone cannot compare.
CREATE OR REPLACE FUNCTION public.wf04_guard_church_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.church_id IS DISTINCT FROM OLD.church_id THEN
    RAISE EXCEPTION 'WF04_CHURCH_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wf04_guard_church_id() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'songs', 'repertoire', 'special_events', 'schedule_quarters',
    'schedule_assignments', 'schedule_rehearsals', 'schedule_email_notifications',
    'schedule_notifications'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS wf04_church_immutable ON public.%I', t);
      EXECUTE format('CREATE TRIGGER wf04_church_immutable BEFORE UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.wf04_guard_church_id()', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Replace single-church policies with row-scoped policies
-- ---------------------------------------------------------------------------

-- Drop every legacy permissive policy on the tenant tables before installing the
-- new set. This is intentionally dynamic: policies created in earlier migrations
-- must never survive alongside the row-scoped versions and re-grant cross-church
-- access. Restrictive policies are kept and replaced separately below.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
      AND tablename IN (
        'ministers', 'songs', 'repertoire', 'special_events',
        'schedule_quarters', 'schedule_assignments', 'schedule_rehearsals',
        'schedule_notifications'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated users can view own church" ON public.churches;
CREATE POLICY "Authenticated users can view own church" ON public.churches FOR SELECT TO authenticated
  USING (
    status = 'active' AND EXISTS (
      SELECT 1 FROM public.ministers m
      WHERE m.user_id = auth.uid()
        AND m.church_id = churches.id
        AND m.access_state = 'active'
    )
  );

DROP POLICY IF EXISTS "Authenticated users can view own church ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can insert own church ministers" ON public.ministers;
DROP POLICY IF EXISTS "Admins can update own church ministers" ON public.ministers;
DROP POLICY IF EXISTS "Users can activate own minister record" ON public.ministers;
DROP POLICY IF EXISTS "Admins can delete own church ministers" ON public.ministers;

CREATE POLICY "Authenticated users can view own church ministers" ON public.ministers FOR SELECT TO authenticated
  USING (public.wf04_has_active_membership(church_id));
CREATE POLICY "Admins can insert own church ministers" ON public.ministers FOR INSERT TO authenticated
  WITH CHECK (public.wf04_is_active_church_admin(church_id));
CREATE POLICY "Admins can update own church ministers" ON public.ministers FOR UPDATE TO authenticated
  USING (public.wf04_is_active_church_admin(church_id))
  WITH CHECK (public.wf04_is_active_church_admin(church_id));

DROP POLICY IF EXISTS "Authenticated users can view own church songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can insert own church songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can update own church songs" ON public.songs;
DROP POLICY IF EXISTS "Admins or lead singers can delete own church songs" ON public.songs;

CREATE POLICY "Authenticated users can view own church songs" ON public.songs FOR SELECT TO authenticated
  USING (public.wf04_has_active_membership(church_id));
CREATE POLICY "Admins or lead singers can insert own church songs" ON public.songs FOR INSERT TO authenticated
  WITH CHECK (
    public.wf04_is_active_church_admin(church_id)
    OR (
      minister_id = public.wf04_current_membership_id(church_id)
      AND public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id)
    )
  );
CREATE POLICY "Admins or lead singers can update own church songs" ON public.songs FOR UPDATE TO authenticated
  USING (
    public.wf04_is_active_church_admin(church_id)
    OR (
      minister_id = public.wf04_current_membership_id(church_id)
      AND public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id)
    )
  )
  WITH CHECK (
    public.wf04_is_active_church_admin(church_id)
    OR (
      minister_id = public.wf04_current_membership_id(church_id)
      AND public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id)
    )
  );
CREATE POLICY "Admins or lead singers can delete own church songs" ON public.songs FOR DELETE TO authenticated
  USING (
    public.wf04_is_active_church_admin(church_id)
    OR (
      minister_id = public.wf04_current_membership_id(church_id)
      AND public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id)
    )
  );

DROP POLICY IF EXISTS "Authenticated users can view own church repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins can insert own church repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Lead singers can insert own church repertoire items" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or lead singers can update own church repertoire" ON public.repertoire;
DROP POLICY IF EXISTS "Admins or lead singers can delete own church repertoire" ON public.repertoire;

CREATE POLICY "Authenticated users can view own church repertoire" ON public.repertoire FOR SELECT TO authenticated
  USING (public.wf04_has_active_membership(church_id));
CREATE POLICY "Admins can insert own church repertoire items" ON public.repertoire FOR INSERT TO authenticated
  WITH CHECK (
    public.wf04_is_active_church_admin(church_id)
    AND EXISTS (SELECT 1 FROM public.songs s WHERE s.id = song_id AND s.church_id = repertoire.church_id)
    AND (
      minister_id IS NULL
      OR EXISTS (SELECT 1 FROM public.ministers m WHERE m.id = minister_id AND m.church_id = repertoire.church_id)
    )
  );
CREATE POLICY "Lead singers can insert own church repertoire items" ON public.repertoire FOR INSERT TO authenticated
  WITH CHECK (
    minister_id = public.wf04_current_membership_id(church_id)
    AND public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id)
    AND EXISTS (SELECT 1 FROM public.songs s WHERE s.id = song_id AND s.church_id = repertoire.church_id)
  );
CREATE POLICY "Admins or lead singers can update own church repertoire" ON public.repertoire FOR UPDATE TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (public.wf04_is_active_church_admin(church_id) OR public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id))
  )
  WITH CHECK (
    public.wf04_has_active_membership(church_id)
    AND (public.wf04_is_active_church_admin(church_id) OR public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id))
  );
CREATE POLICY "Admins or lead singers can delete own church repertoire" ON public.repertoire FOR DELETE TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (public.wf04_is_active_church_admin(church_id) OR public.wf04_has_lead_voice_role(public.wf04_current_membership_id(church_id), church_id))
  );

DROP POLICY IF EXISTS "Authenticated users can view own church special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or non-media ministers can insert own church special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or creators can update own church special events" ON public.special_events;
DROP POLICY IF EXISTS "Admins or creators can delete own church special events" ON public.special_events;

CREATE POLICY "Authenticated users can view own church special events" ON public.special_events FOR SELECT TO authenticated
  USING (public.wf04_has_active_membership(church_id));
CREATE POLICY "Admins or non-media ministers can insert own church special events" ON public.special_events FOR INSERT TO authenticated
  WITH CHECK (
    public.wf04_is_active_church_admin(church_id)
    OR (
      public.wf04_has_active_membership(church_id)
      AND public.wf04_current_role(church_id) <> 'midia'
    )
  );
CREATE POLICY "Admins or creators can update own church special events" ON public.special_events FOR UPDATE TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (public.wf04_is_active_church_admin(church_id) OR created_by = public.wf04_current_membership_id(church_id))
  )
  WITH CHECK (
    public.wf04_has_active_membership(church_id)
    AND (public.wf04_is_active_church_admin(church_id) OR created_by = public.wf04_current_membership_id(church_id))
  );
CREATE POLICY "Admins or creators can delete own church special events" ON public.special_events FOR DELETE TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (public.wf04_is_active_church_admin(church_id) OR created_by = public.wf04_current_membership_id(church_id))
  );

DROP POLICY IF EXISTS "Authenticated users can view own church schedule quarters" ON public.schedule_quarters;
DROP POLICY IF EXISTS "Admins can manage own church schedule quarters" ON public.schedule_quarters;
CREATE POLICY "Authenticated users can view own church schedule quarters" ON public.schedule_quarters FOR SELECT TO authenticated
  USING (public.wf04_has_active_membership(church_id));
CREATE POLICY "Admins can manage own church schedule quarters" ON public.schedule_quarters FOR ALL TO authenticated
  USING (public.wf04_is_active_church_admin(church_id))
  WITH CHECK (public.wf04_is_active_church_admin(church_id));

DROP POLICY IF EXISTS "Authenticated users can view own church schedule assignments" ON public.schedule_assignments;
DROP POLICY IF EXISTS "Admins can manage own church schedule assignments" ON public.schedule_assignments;
CREATE POLICY "Authenticated users can view own church schedule assignments" ON public.schedule_assignments FOR SELECT TO authenticated
  USING (public.wf04_has_active_membership(church_id));
CREATE POLICY "Admins can manage own church schedule assignments" ON public.schedule_assignments FOR ALL TO authenticated
  USING (public.wf04_is_active_church_admin(church_id))
  WITH CHECK (public.wf04_is_active_church_admin(church_id));

-- schedule_rehearsals (021) and schedule_notifications are optional in some
-- databases: their policies are installed only when the table exists.
DO $$
BEGIN
  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated users can view own church schedule rehearsals" ON public.schedule_rehearsals;
    DROP POLICY IF EXISTS "Admins or ministers can manage own church schedule rehearsals" ON public.schedule_rehearsals;
    CREATE POLICY "Authenticated users can view own church schedule rehearsals" ON public.schedule_rehearsals FOR SELECT TO authenticated
      USING (public.wf04_has_active_membership(church_id));
    CREATE POLICY "Admins or ministers can manage own church schedule rehearsals" ON public.schedule_rehearsals FOR ALL TO authenticated
      USING (public.wf04_has_active_membership(church_id) AND public.wf04_current_role(church_id) IN ('admin', 'minister'))
      WITH CHECK (public.wf04_has_active_membership(church_id) AND public.wf04_current_role(church_id) IN ('admin', 'minister'));
  END IF;

  IF to_regclass('public.schedule_notifications') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated users can view own church schedule notifications" ON public.schedule_notifications;
    CREATE POLICY "Authenticated users can view own church schedule notifications" ON public.schedule_notifications FOR SELECT TO authenticated
      USING (public.wf04_has_active_membership(church_id));
  END IF;
END $$;

-- WF-11 restrictions must use the row's church, not an arbitrary membership.
DROP POLICY IF EXISTS wf11_quarters_read ON public.schedule_quarters;
CREATE POLICY wf11_quarters_read ON public.schedule_quarters
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (coalesce(public.wf04_current_role(church_id), '') <> 'midia' OR is_published = true)
  );

DROP POLICY IF EXISTS wf11_assignments_read ON public.schedule_assignments;
CREATE POLICY wf11_assignments_read ON public.schedule_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.wf04_has_active_membership(church_id)
    AND (
      coalesce(public.wf04_current_role(church_id), '') <> 'midia'
      OR EXISTS (SELECT 1 FROM public.schedule_quarters q
        WHERE q.id = schedule_assignments.quarter_id AND q.church_id = schedule_assignments.church_id AND q.is_published = true)
    )
  );

DO $$
BEGIN
  IF to_regclass('public.schedule_rehearsals') IS NOT NULL THEN
    DROP POLICY IF EXISTS wf11_rehearsals_read ON public.schedule_rehearsals;
    CREATE POLICY wf11_rehearsals_read ON public.schedule_rehearsals
      AS RESTRICTIVE FOR SELECT TO authenticated
      USING (
        public.wf04_has_active_membership(church_id)
        AND (
          coalesce(public.wf04_current_role(church_id), '') <> 'midia'
          OR EXISTS (SELECT 1 FROM public.schedule_quarters q
            WHERE q.id = schedule_rehearsals.quarter_id AND q.church_id = schedule_rehearsals.church_id AND q.is_published = true)
        )
      );
  END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['schedule_quarters', 'schedule_assignments', 'schedule_rehearsals'] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS wf11_no_media_insert ON public.%I', table_name);
    EXECUTE format('CREATE POLICY wf11_no_media_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (coalesce(public.wf04_current_role(church_id), '''') <> ''midia'')', table_name);
    EXECUTE format('DROP POLICY IF EXISTS wf11_no_media_update ON public.%I', table_name);
    EXECUTE format('CREATE POLICY wf11_no_media_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (coalesce(public.wf04_current_role(church_id), '''') <> ''midia'')
      WITH CHECK (coalesce(public.wf04_current_role(church_id), '''') <> ''midia'')', table_name);
    EXECUTE format('DROP POLICY IF EXISTS wf11_no_media_delete ON public.%I', table_name);
    EXECUTE format('CREATE POLICY wf11_no_media_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
      USING (coalesce(public.wf04_current_role(church_id), '''') <> ''midia'')', table_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Invitation storage, outbox and persistent limits
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.wf04_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'minister', 'midia')),
  instrument text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wf04_invitation_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT wf04_invitation_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT wf04_invitation_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT wf04_invitation_terminal CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS wf04_invitations_pending_email_idx
  ON public.wf04_invitations(church_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wf04_invitations_token_hash_idx
  ON public.wf04_invitations(token_hash);
CREATE INDEX IF NOT EXISTS wf04_invitations_church_created_idx
  ON public.wf04_invitations(church_id, created_at DESC);

ALTER TABLE public.wf04_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wf04_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wf04_invitations TO service_role;

CREATE TABLE IF NOT EXISTS public.wf04_invitation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.wf04_invitations(id) ON DELETE CASCADE,
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invitation_id, version)
);

CREATE INDEX IF NOT EXISTS wf04_invitation_outbox_status_idx
  ON public.wf04_invitation_outbox(status, available_at, created_at);

ALTER TABLE public.wf04_invitation_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wf04_invitation_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.wf04_invitation_outbox TO service_role;

CREATE TABLE IF NOT EXISTS public.wf04_invitation_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.wf04_invitation_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wf04_invitation_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wf04_invitation_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_wf04_invitation_limit(p_key text, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_attempts integer;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid limit parameters';
  END IF;
  DELETE FROM public.wf04_invitation_limits WHERE expires_at < now() - interval '1 day';
  INSERT INTO public.wf04_invitation_limits AS counters (key, attempts, expires_at)
  VALUES (p_key, 1, now() + interval '15 minutes')
  ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN counters.expires_at <= now() THEN 1 ELSE LEAST(counters.attempts + 1, p_limit + 1) END,
    expires_at = CASE WHEN counters.expires_at <= now() THEN now() + interval '15 minutes' ELSE counters.expires_at END
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.consume_wf04_invitation_limit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_wf04_invitation_limit(text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Invitation transactions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wf04_current_admin_membership(p_actor uuid, p_church uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id
  FROM public.ministers m
  JOIN public.churches c ON c.id = m.church_id
  WHERE m.user_id = p_actor
    AND m.church_id = p_church
    AND m.role = 'admin'
    AND m.access_state = 'active'
    AND c.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.wf04_current_admin_membership(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf04_current_admin_membership(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.wf04_create_invitation(
  p_actor uuid,
  p_church uuid,
  p_email text,
  p_name text,
  p_role text,
  p_instrument text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_payload_ciphertext text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_instrument text := btrim(coalesce(p_instrument, ''));
  v_inv public.wf04_invitations;
  v_outbox uuid;
BEGIN
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'WF04_INVALID_EMAIL';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin', 'minister', 'midia') THEN
    RAISE EXCEPTION 'WF04_INVALID_ROLE';
  END IF;
  IF p_role = 'midia' THEN v_instrument := 'Midia'; END IF;
  IF p_role <> 'midia' AND length(v_instrument) = 0 THEN
    RAISE EXCEPTION 'WF04_INSTRUMENT_REQUIRED';
  END IF;
  IF length(v_name) = 0 OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'WF04_INVALID_NAME';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at <= now()
     OR p_payload_ciphertext IS NULL OR length(p_payload_ciphertext) < 16 THEN
    RAISE EXCEPTION 'WF04_INVALID_INVITATION';
  END IF;

  PERFORM 1 FROM public.churches WHERE id = p_church AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  IF public.wf04_current_admin_membership(p_actor, p_church) IS NULL THEN
    RAISE EXCEPTION 'WF04_FORBIDDEN';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ministers m
    WHERE m.church_id = p_church AND lower(coalesce(m.email, '')) = v_email AND m.access_state = 'active'
  ) THEN
    RAISE EXCEPTION 'WF04_ALREADY_MEMBER';
  END IF;

  SELECT * INTO v_inv FROM public.wf04_invitations
  WHERE church_id = p_church AND email = v_email AND accepted_at IS NULL AND revoked_at IS NULL
  FOR UPDATE;

  IF v_inv.id IS NOT NULL THEN
    UPDATE public.wf04_invitations SET
      name = v_name, role = p_role, instrument = v_instrument,
      token_hash = p_token_hash, version = version + 1,
      expires_at = p_expires_at, last_sent_at = NULL, updated_at = now()
    WHERE id = v_inv.id
    RETURNING * INTO v_inv;
  ELSE
    INSERT INTO public.wf04_invitations(
      church_id, email, name, role, instrument, created_by, token_hash, expires_at
    ) VALUES (
      p_church, v_email, v_name, p_role, v_instrument, p_actor, p_token_hash, p_expires_at
    ) RETURNING * INTO v_inv;
  END IF;

  INSERT INTO public.wf04_invitation_outbox(invitation_id, church_id, version, payload_ciphertext)
  VALUES (v_inv.id, p_church, v_inv.version, p_payload_ciphertext)
  RETURNING id INTO v_outbox;

  RETURN jsonb_build_object(
    'outbox_id', v_outbox,
    'invitation_id', v_inv.id,
    'church_id', v_inv.church_id,
    'email', v_inv.email,
    'name', v_inv.name,
    'role', v_inv.role,
    'instrument', v_inv.instrument,
    'version', v_inv.version,
    'expires_at', v_inv.expires_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.wf04_rotate_invitation(
  p_actor uuid,
  p_church uuid,
  p_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_payload_ciphertext text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.wf04_invitations; v_outbox uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at <= now()
     OR p_payload_ciphertext IS NULL OR length(p_payload_ciphertext) < 16 THEN
    RAISE EXCEPTION 'WF04_INVALID_INVITATION';
  END IF;
  PERFORM 1 FROM public.churches WHERE id = p_church AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  IF public.wf04_current_admin_membership(p_actor, p_church) IS NULL THEN
    RAISE EXCEPTION 'WF04_FORBIDDEN';
  END IF;
  SELECT * INTO v_inv FROM public.wf04_invitations
  WHERE id = p_id AND church_id = p_church FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.accepted_at IS NOT NULL OR v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WF04_UNAVAILABLE';
  END IF;
  UPDATE public.wf04_invitations SET
    token_hash = p_token_hash, version = version + 1, expires_at = p_expires_at,
    last_sent_at = NULL, updated_at = now()
  WHERE id = v_inv.id RETURNING * INTO v_inv;
  INSERT INTO public.wf04_invitation_outbox(invitation_id, church_id, version, payload_ciphertext)
  VALUES (v_inv.id, p_church, v_inv.version, p_payload_ciphertext)
  RETURNING id INTO v_outbox;
  RETURN jsonb_build_object('outbox_id', v_outbox, 'invitation_id', v_inv.id,
    'version', v_inv.version, 'expires_at', v_inv.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.wf04_revoke_invitation(p_actor uuid, p_church uuid, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.wf04_invitations;
BEGIN
  PERFORM 1 FROM public.churches WHERE id = p_church AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  IF public.wf04_current_admin_membership(p_actor, p_church) IS NULL THEN
    RAISE EXCEPTION 'WF04_FORBIDDEN';
  END IF;
  SELECT * INTO v_inv FROM public.wf04_invitations
  WHERE id = p_id AND church_id = p_church FOR UPDATE;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'WF04_ALREADY_ACCEPTED'; END IF;
  IF v_inv.revoked_at IS NULL THEN
    UPDATE public.wf04_invitations SET revoked_at = now(), updated_at = now()
    WHERE id = v_inv.id RETURNING * INTO v_inv;
    UPDATE public.wf04_invitation_outbox SET status = 'skipped', last_error = 'Revogado'
    WHERE invitation_id = v_inv.id AND status IN ('pending', 'failed');
  END IF;
  RETURN jsonb_build_object('invitation_id', v_inv.id, 'revoked_at', v_inv.revoked_at);
END $$;

CREATE OR REPLACE FUNCTION public.wf04_inspect_invitation(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.wf04_invitations; v_church public.churches; v_state text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE';
  END IF;
  SELECT * INTO v_inv FROM public.wf04_invitations WHERE token_hash = p_token_hash;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE'; END IF;
  SELECT * INTO v_church FROM public.churches WHERE id = v_inv.church_id;
  IF v_church.id IS NULL OR v_church.status <> 'active' THEN
    RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE';
  END IF;
  v_state := CASE
    WHEN v_inv.accepted_at IS NOT NULL THEN 'accepted'
    WHEN v_inv.revoked_at IS NOT NULL THEN 'revoked'
    WHEN v_inv.expires_at <= now() THEN 'expired'
    ELSE 'pending'
  END;
  RETURN jsonb_build_object(
    'church_id', v_inv.church_id,
    'church_name', v_church.name,
    'email_hint', left(v_inv.email, 1) || '***@' || split_part(v_inv.email, '@', 2),
    'name', v_inv.name,
    'role', v_inv.role,
    'instrument', v_inv.instrument,
    'state', v_state,
    'expires_at', v_inv.expires_at
  );
END $$;

CREATE OR REPLACE FUNCTION public.wf04_accept_invitation(p_actor uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_inv public.wf04_invitations;
  v_church public.churches;
  v_email text;
  v_membership public.ministers;
  v_minister_id uuid;
  v_name text;
BEGIN
  IF p_actor IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE';
  END IF;

  SELECT * INTO v_inv FROM public.wf04_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE';
  END IF;

  SELECT lower(u.email::text) INTO v_email FROM auth.users u WHERE u.id = p_actor;
  IF v_email IS NULL THEN RAISE EXCEPTION 'WF04_IDENTITY_REQUIRED'; END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    IF v_inv.accepted_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE';
    END IF;
    SELECT * INTO v_membership FROM public.ministers
    WHERE church_id = v_inv.church_id AND user_id = p_actor;
    IF v_membership.id IS NULL THEN RAISE EXCEPTION 'WF04_INVITATION_UNAVAILABLE'; END IF;
    RETURN jsonb_build_object(
      'status', v_membership.access_state,
      'church_id', v_inv.church_id,
      'minister_id', v_membership.id,
      'role', v_membership.role,
      'idempotent', true
    );
  END IF;

  IF v_inv.expires_at <= now() THEN RAISE EXCEPTION 'WF04_INVITATION_EXPIRED'; END IF;
  IF v_email <> v_inv.email THEN RAISE EXCEPTION 'WF04_EMAIL_MISMATCH'; END IF;

  PERFORM 1 FROM public.churches WHERE id = v_inv.church_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  SELECT * INTO v_church FROM public.churches WHERE id = v_inv.church_id;

  SELECT * INTO v_membership FROM public.ministers
  WHERE church_id = v_inv.church_id AND user_id = p_actor FOR UPDATE;

  IF v_membership.id IS NOT NULL THEN
    IF v_membership.access_state = 'suspended' THEN
      RAISE EXCEPTION 'WF04_MEMBERSHIP_SUSPENDED';
    END IF;
    IF v_membership.access_state = 'active' THEN
      v_minister_id := v_membership.id;
    ELSE
      UPDATE public.ministers SET
        role = v_inv.role,
        instrument = v_inv.instrument,
        access_state = 'active',
        email = coalesce(email, v_inv.email)
      WHERE id = v_membership.id RETURNING id INTO v_minister_id;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.ministers
      WHERE church_id = v_inv.church_id AND lower(coalesce(email, '')) = v_inv.email
    ) THEN
      -- A legacy row may exist without an Auth identity. Do not silently claim it.
      RAISE EXCEPTION 'WF04_UNAVAILABLE';
    END IF;

    INSERT INTO public.user_profiles(user_id, name)
    VALUES (p_actor, v_inv.name)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT coalesce(p.name, v_inv.name) INTO v_name
    FROM public.user_profiles p WHERE p.user_id = p_actor;

    INSERT INTO public.ministers(
      church_id, user_id, email, name, role, instrument, access_state
    ) VALUES (
      v_inv.church_id, p_actor, v_inv.email, coalesce(v_name, v_inv.name),
      v_inv.role, v_inv.instrument, 'active'
    ) RETURNING id INTO v_minister_id;
  END IF;

  UPDATE public.wf04_invitations SET
    accepted_at = now(), accepted_by = p_actor, updated_at = now()
  WHERE id = v_inv.id RETURNING * INTO v_inv;

  UPDATE public.user_profiles SET last_church_id = v_inv.church_id, updated_at = now()
  WHERE user_id = p_actor;

  SELECT * INTO v_membership FROM public.ministers WHERE id = v_minister_id;
  RETURN jsonb_build_object(
    'status', v_membership.access_state,
    'church_id', v_inv.church_id,
    'church_name', v_church.name,
    'minister_id', v_membership.id,
    'role', v_membership.role,
    'idempotent', false
  );
END $$;

REVOKE ALL ON FUNCTION public.wf04_create_invitation(uuid, uuid, text, text, text, text, text, timestamptz, text),
  public.wf04_rotate_invitation(uuid, uuid, uuid, text, timestamptz, text),
  public.wf04_revoke_invitation(uuid, uuid, uuid),
  public.wf04_inspect_invitation(text),
  public.wf04_accept_invitation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf04_create_invitation(uuid, uuid, text, text, text, text, text, timestamptz, text),
  public.wf04_rotate_invitation(uuid, uuid, uuid, text, timestamptz, text),
  public.wf04_revoke_invitation(uuid, uuid, uuid),
  public.wf04_inspect_invitation(text),
  public.wf04_accept_invitation(uuid, text)
  TO service_role;

COMMIT;
