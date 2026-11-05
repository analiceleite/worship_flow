BEGIN;

-- Private, bounded-window counters shared by all application instances.
CREATE TABLE IF NOT EXISTS public.password_recovery_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.password_recovery_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_recovery_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_recovery_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_password_recovery_limit(p_key text, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid limit parameters';
  END IF;

  DELETE FROM public.password_recovery_limits WHERE expires_at < now() - interval '1 day';

  INSERT INTO public.password_recovery_limits AS counters (key, attempts, expires_at)
  VALUES (p_key, 1, now() + interval '15 minutes')
  ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN counters.expires_at <= now() THEN 1 ELSE LEAST(counters.attempts + 1, p_limit + 1) END,
    expires_at = CASE WHEN counters.expires_at <= now() THEN now() + interval '15 minutes' ELSE counters.expires_at END
  RETURNING attempts INTO v_attempts;

  RETURN v_attempts <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_password_recovery_limit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_password_recovery_limit(text, integer) TO service_role;

-- Retain historical rows, but retire earlier recovery credentials and public access.
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_resets FROM PUBLIC, anon, authenticated;
UPDATE public.password_resets SET used = true WHERE used = false;

COMMIT;
