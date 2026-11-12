-- WF-39: cifra PDFs are church data. Migration 022 let any authenticated user read, create,
-- overwrite and delete objects of every church in the "cifras" bucket. This replaces those policies.
--
-- Object paths are either:
--   {churchId}/{songId}/cifra.pdf   (current uploads, see lib/cifra-storage.ts)
--   {songId}/cifra.pdf              (legacy uploads from migration 022)
-- Access is granted only to active members of the church that owns the object. For legacy paths the
-- owning church is the church of the song. Anything that does not match is denied.
-- Apply in the Supabase SQL editor after reviewing; not applied automatically.

BEGIN;

CREATE OR REPLACE FUNCTION public.wf39_cifra_path_allowed(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.wf04_has_active_membership(((storage.foldername(p_name))[1])::uuid)
      OR EXISTS (
        SELECT 1 FROM public.songs s
        WHERE s.id = ((storage.foldername(p_name))[1])::uuid
          AND public.wf04_has_active_membership(s.church_id)
      )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.wf39_cifra_path_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wf39_cifra_path_allowed(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can read cifras" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload cifras" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update cifras" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete cifras" ON storage.objects;
DROP POLICY IF EXISTS wf39_cifras_read ON storage.objects;
DROP POLICY IF EXISTS wf39_cifras_insert ON storage.objects;
DROP POLICY IF EXISTS wf39_cifras_update ON storage.objects;
DROP POLICY IF EXISTS wf39_cifras_delete ON storage.objects;

CREATE POLICY wf39_cifras_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cifras' AND public.wf39_cifra_path_allowed(name));

CREATE POLICY wf39_cifras_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cifras' AND public.wf39_cifra_path_allowed(name));

CREATE POLICY wf39_cifras_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cifras' AND public.wf39_cifra_path_allowed(name))
  WITH CHECK (bucket_id = 'cifras' AND public.wf39_cifra_path_allowed(name));

CREATE POLICY wf39_cifras_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cifras' AND public.wf39_cifra_path_allowed(name));

-- YouTube search cache (migration 023) is shared by design and holds no church data, but only the
-- server reads and writes it through the admin client. Without RLS, any signed-in user could write
-- entries that every church then reads. Close direct access; the service role keeps working.
ALTER TABLE public.youtube_search_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.youtube_search_cache FROM anon, authenticated;

COMMIT;
