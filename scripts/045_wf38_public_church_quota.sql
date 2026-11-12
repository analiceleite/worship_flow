-- WF-38: public church creation for a verified identity, with idempotency and a
-- per-identity quota. Expansion only: no existing row or policy is changed, and no
-- route is opened by this migration. Apply after 038 and 041 in the Supabase SQL editor
-- after review; never applied automatically.
--
-- Rules enforced here (the database is the source of truth, the API only calls the function):
--   * The creator must have a confirmed e-mail (auth.users.email_confirmed_at).
--   * One creation consumes one row of church_creation_intents. The default quota is one
--     church per identity; platform exceptions add rows to church_creation_allowances.
--   * Creation of the church, its first ADMIN membership and the quota row happen in one
--     transaction. Any failure rolls everything back, so no quota is consumed.
--   * The same (creator, idempotency key, church name) returns the existing church.
--     The same key with a different name is rejected.
--   * Creation decisions for one identity are serialized with a transaction advisory lock.
--   * Nothing here grants platform-admin privileges to the creator.
--   * Quota is never released by leaving, transferring or inactivating a church: intents
--     reference churches with ON DELETE RESTRICT and are never deleted by the application.

BEGIN;

CREATE TABLE IF NOT EXISTS public.church_creation_intents (
  creator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  church_id uuid NOT NULL UNIQUE REFERENCES public.churches(id) ON DELETE RESTRICT,
  church_name text NOT NULL CHECK (length(btrim(church_name)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS church_creation_intents_creator_idx
  ON public.church_creation_intents(creator_user_id);

CREATE TABLE IF NOT EXISTS public.church_creation_allowances (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  extra_churches integer NOT NULL CHECK (extra_churches BETWEEN 1 AND 10),
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Both tables are written only by the service role (server code), never by browsers.
ALTER TABLE public.church_creation_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_creation_allowances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.church_creation_intents, public.church_creation_allowances
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.church_creation_intents, public.church_creation_allowances TO service_role;

CREATE OR REPLACE FUNCTION public.wf38_create_church_for_identity(
  p_creator uuid,
  p_idempotency_key uuid,
  p_church_name text,
  p_admin_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := btrim(coalesce(p_church_name, ''));
  v_admin text := btrim(coalesce(p_admin_name, ''));
  v_intent public.church_creation_intents%ROWTYPE;
  v_base_slug text;
  v_slug text;
  v_church uuid;
  v_membership uuid;
  v_limit integer;
  v_used integer;
BEGIN
  IF p_creator IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'WF38_INVALID_INPUT';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'WF38_INVALID_CHURCH_NAME';
  END IF;
  IF length(v_admin) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'WF38_INVALID_ADMIN_NAME';
  END IF;

  -- Serialize every creation decision for this identity. The lock ends with the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('wf38:' || p_creator::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_creator AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'WF38_EMAIL_NOT_VERIFIED';
  END IF;

  -- Retry of the same intention: return the church created by the first attempt.
  SELECT * INTO v_intent FROM public.church_creation_intents
    WHERE creator_user_id = p_creator AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_intent.church_name <> v_name THEN
      RAISE EXCEPTION 'WF38_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('status', 'existing', 'church_id', v_intent.church_id);
  END IF;

  -- Quota: one church per identity, plus any allowance granted by the platform.
  SELECT 1 + coalesce((SELECT a.extra_churches FROM public.church_creation_allowances a
    WHERE a.user_id = p_creator), 0) INTO v_limit;
  SELECT count(*)::integer INTO v_used FROM public.church_creation_intents
    WHERE creator_user_id = p_creator;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'WF38_QUOTA_EXCEEDED';
  END IF;

  -- Server-generated slug. Technical collisions get a suffix; homonymous churches are not merged.
  v_base_slug := left(trim(both '-' from regexp_replace(
    lower(translate(v_name,
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')),
    '[^a-z0-9]+', '-', 'g')), 60);
  IF v_base_slug = '' THEN
    v_base_slug := 'igreja';
  END IF;
  v_slug := v_base_slug;
  IF EXISTS (SELECT 1 FROM public.churches WHERE slug = v_slug) THEN
    v_slug := left(v_base_slug, 52) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  END IF;

  INSERT INTO public.churches (name, slug, status, environment, email_mode, plan)
    VALUES (v_name, v_slug, 'active', 'production', 'real', 'free')
    RETURNING id INTO v_church;

  -- The creator gets a profile (global name) if missing, then the first ADMIN membership.
  INSERT INTO public.user_profiles (user_id, name)
    VALUES (p_creator, v_admin)
    ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.ministers (name, user_id, church_id, role, is_active, access_state, activated_at)
    VALUES (v_admin, p_creator, v_church, 'admin', true, 'active', now())
    RETURNING id INTO v_membership;

  INSERT INTO public.church_creation_intents (creator_user_id, idempotency_key, church_id, church_name)
    VALUES (p_creator, p_idempotency_key, v_church, v_name);

  RETURN jsonb_build_object(
    'status', 'created',
    'church_id', v_church,
    'slug', v_slug,
    'membership_id', v_membership
  );
END $$;

REVOKE ALL ON FUNCTION public.wf38_create_church_for_identity(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wf38_create_church_for_identity(uuid, uuid, text, text)
  TO service_role;

COMMIT;
