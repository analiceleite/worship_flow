-- WF-04, expansion only. Apply before the accompanying application release.
-- Deliberately retain the single-user and global-email uniqueness gates until
-- all RLS, clients, calendar and invitation consumers support multiple churches.
BEGIN;

LOCK TABLE public.ministers IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.wf04_legacy_cutover (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.wf04_legacy_memberships (
  minister_id uuid PRIMARY KEY,
  church_id uuid NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wf04_legacy_cutover ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wf04_legacy_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wf04_legacy_cutover, public.wf04_legacy_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wf04_legacy_cutover, public.wf04_legacy_memberships TO service_role;

ALTER TABLE public.ministers ADD COLUMN IF NOT EXISTS access_state text NOT NULL DEFAULT 'pending'
  CHECK (access_state IN ('pending', 'active', 'suspended'));
ALTER TABLE public.ministers ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE public.ministers ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Capture and activate the approved legacy cohort exactly once, even on rerun.
DO $$
BEGIN
  INSERT INTO public.wf04_legacy_cutover(singleton) VALUES (true) ON CONFLICT DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.wf04_legacy_memberships(minister_id, church_id)
      SELECT id, church_id FROM public.ministers;
    UPDATE public.ministers SET access_state = 'active', is_active = true,
      activated_at = coalesce(activated_at, now());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  avatar_url text,
  optional_notifications_paused boolean NOT NULL DEFAULT false,
  last_church_id uuid REFERENCES public.churches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.user_profiles(user_id, name, avatar_url)
  SELECT DISTINCT ON (user_id) user_id, coalesce(nullif(btrim(name), ''), 'Integrante'), avatar_url
  FROM public.ministers WHERE user_id IS NOT NULL
  ORDER BY user_id, created_at ASC NULLS LAST, id
  ON CONFLICT (user_id) DO NOTHING;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
DROP POLICY IF EXISTS wf04_own_profile ON public.user_profiles;
CREATE POLICY wf04_own_profile ON public.user_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.wf04_has_active_membership(p_church uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ministers m JOIN public.churches c ON c.id = m.church_id
    WHERE m.user_id = auth.uid() AND m.church_id = p_church
      AND m.access_state = 'active' AND c.status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.wf04_has_active_membership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf04_has_active_membership(uuid) TO authenticated, service_role;

-- These restrictive policies cannot broaden legacy policies. The old
-- single-church helpers remain until the coordinated multichurch migration.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ministers', 'songs', 'repertoire', 'special_events', 'schedule_quarters',
    'schedule_assignments', 'schedule_rehearsals', 'schedule_notifications',
    'schedule_email_notifications', 'google_calendar_tokens', 'google_calendar_event_map'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS wf04_active_membership ON public.%I', t);
      EXECUTE format('CREATE POLICY wf04_active_membership ON public.%I AS RESTRICTIVE
        FOR ALL TO authenticated USING (public.wf04_has_active_membership(church_id))
        WITH CHECK (public.wf04_has_active_membership(church_id))', t);
    END IF;
  END LOOP;
END $$;

-- All access changes, including old direct-client edits, must preserve the
-- explicit state and the last administrator. Lock the church, not just a member.
CREATE OR REPLACE FUNCTION public.wf04_guard_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Explicit maintenance is available only to a direct postgres session,
    -- never to PostgREST's authenticated/service_role or an application client.
    IF session_user = 'postgres' AND current_setting('role', true) IN ('none', 'postgres')
      AND current_setting('wf04.maintenance', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WF04_DEACTIVATE_REQUIRED';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.church_id IS DISTINCT FROM OLD.church_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'WF04_MEMBERSHIP_IDENTITY_IMMUTABLE';
    END IF;
    IF NEW.access_state IS DISTINCT FROM OLD.access_state AND auth.role() = 'authenticated' THEN
      RAISE EXCEPTION 'WF04_ACCESS_API_REQUIRED';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.access_state = OLD.access_state THEN
      RAISE EXCEPTION 'WF04_ACCESS_API_REQUIRED';
    END IF;
    IF OLD.role = 'admin' AND OLD.access_state = 'active'
       AND (NEW.role IS DISTINCT FROM 'admin' OR NEW.access_state <> 'active') THEN
      PERFORM 1 FROM public.churches WHERE id = OLD.church_id FOR UPDATE;
      IF NOT EXISTS (SELECT 1 FROM public.ministers m WHERE m.church_id = OLD.church_id
        AND m.id <> OLD.id AND m.user_id IS NOT NULL AND m.role = 'admin' AND m.access_state = 'active') THEN
        RAISE EXCEPTION 'WF04_LAST_ADMIN';
      END IF;
    END IF;
  END IF;
  -- Existing local columns remain read-compatible projections of global data.
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_profiles p WHERE p.user_id = NEW.user_id
  ) THEN
    IF TG_OP = 'INSERT' THEN
      SELECT p.name, p.avatar_url INTO NEW.name, NEW.avatar_url
        FROM public.user_profiles p WHERE p.user_id = NEW.user_id;
    ELSIF EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = NEW.user_id
      AND (NEW.name IS DISTINCT FROM p.name OR NEW.avatar_url IS DISTINCT FROM p.avatar_url)) THEN
      RAISE EXCEPTION 'WF04_GLOBAL_PROFILE_REQUIRED';
    END IF;
  END IF;
  NEW.is_active := NEW.access_state = 'active';
  IF NEW.access_state = 'active' THEN
    NEW.activated_at := coalesce(NEW.activated_at, now());
    NEW.suspended_at := NULL;
  ELSIF NEW.access_state = 'suspended' THEN
    NEW.suspended_at := coalesce(NEW.suspended_at, now());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wf04_guard_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wf04_membership_guard ON public.ministers;
CREATE TRIGGER wf04_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ministers
  FOR EACH ROW EXECUTE FUNCTION public.wf04_guard_membership();

CREATE OR REPLACE FUNCTION public.wf04_project_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.ministers SET name = NEW.name, avatar_url = NEW.avatar_url
    WHERE user_id = NEW.user_id
      AND (name IS DISTINCT FROM NEW.name OR avatar_url IS DISTINCT FROM NEW.avatar_url);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wf04_project_profile() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wf04_profile_projection ON public.user_profiles;
CREATE TRIGGER wf04_profile_projection AFTER INSERT OR UPDATE OF name, avatar_url ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.wf04_project_profile();

CREATE TABLE IF NOT EXISTS public.membership_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.churches(id),
  minister_id uuid NOT NULL REFERENCES public.ministers(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  previous_state text NOT NULL,
  next_state text NOT NULL,
  is_support boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.membership_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_access_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.membership_access_audit TO service_role;

CREATE OR REPLACE FUNCTION public.wf04_set_membership_access(
  p_actor uuid, p_church uuid, p_minister uuid, p_state text, p_support boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.ministers; result public.ministers;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'WF04_INVALID_STATE';
  END IF;
  PERFORM 1 FROM public.churches WHERE id = p_church AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  IF p_support THEN
    IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_actor) THEN
      RAISE EXCEPTION 'WF04_FORBIDDEN';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.ministers WHERE user_id = p_actor
    AND church_id = p_church AND role = 'admin' AND access_state = 'active') THEN
    RAISE EXCEPTION 'WF04_FORBIDDEN';
  END IF;
  SELECT * INTO target FROM public.ministers WHERE id = p_minister AND church_id = p_church FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'WF04_UNAVAILABLE'; END IF;
  IF target.access_state = 'pending' THEN RAISE EXCEPTION 'WF04_INVITATION_REQUIRED'; END IF;
  IF target.access_state = p_state THEN
    RETURN jsonb_build_object('id', target.id, 'access_state', target.access_state, 'is_active', target.is_active);
  END IF;
  UPDATE public.ministers SET access_state = p_state WHERE id = target.id RETURNING * INTO result;
  INSERT INTO public.membership_access_audit(church_id, minister_id, actor_user_id, previous_state, next_state, is_support)
    VALUES (p_church, target.id, p_actor, target.access_state, result.access_state, p_support);
  RETURN jsonb_build_object('id', result.id, 'access_state', result.access_state, 'is_active', result.is_active);
END $$;
REVOKE ALL ON FUNCTION public.wf04_set_membership_access(uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf04_set_membership_access(uuid, uuid, uuid, text, boolean) TO service_role;

COMMIT;
