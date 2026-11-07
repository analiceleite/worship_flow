-- WF-11: restrictive policies also constrain older permissive policies.
-- Apply before deploying the newly accessible schedule page.
BEGIN;

DROP POLICY IF EXISTS wf11_quarters_read ON public.schedule_quarters;
CREATE POLICY wf11_quarters_read ON public.schedule_quarters
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (
      NOT EXISTS (SELECT 1 FROM public.ministers m
        WHERE m.id = public.get_current_minister_id() AND m.role = 'midia')
      OR is_published = true
    )
  );

DROP POLICY IF EXISTS wf11_assignments_read ON public.schedule_assignments;
CREATE POLICY wf11_assignments_read ON public.schedule_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (
      NOT EXISTS (SELECT 1 FROM public.ministers m
        WHERE m.id = public.get_current_minister_id() AND m.role = 'midia')
      OR EXISTS (SELECT 1 FROM public.schedule_quarters q
        WHERE q.id = schedule_assignments.quarter_id AND q.church_id = schedule_assignments.church_id AND q.is_published = true)
    )
  );

DROP POLICY IF EXISTS wf11_rehearsals_read ON public.schedule_rehearsals;
CREATE POLICY wf11_rehearsals_read ON public.schedule_rehearsals
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    church_id = public.get_current_church_id()
    AND (
      NOT EXISTS (SELECT 1 FROM public.ministers m
        WHERE m.id = public.get_current_minister_id() AND m.role = 'midia')
      OR EXISTS (SELECT 1 FROM public.schedule_quarters q
        WHERE q.id = schedule_rehearsals.quarter_id AND q.church_id = schedule_rehearsals.church_id AND q.is_published = true)
    )
  );

-- Do not grant access. These restrictions only remove media write access,
-- preserving the existing admin/minister policies for each table.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['schedule_quarters', 'schedule_assignments', 'schedule_rehearsals'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS wf11_no_media_insert ON public.%I', table_name);
    EXECUTE format('CREATE POLICY wf11_no_media_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (NOT EXISTS (SELECT 1 FROM public.ministers m WHERE m.id = public.get_current_minister_id() AND m.role = ''midia''))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS wf11_no_media_update ON public.%I', table_name);
    EXECUTE format('CREATE POLICY wf11_no_media_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (NOT EXISTS (SELECT 1 FROM public.ministers m WHERE m.id = public.get_current_minister_id() AND m.role = ''midia''))
      WITH CHECK (NOT EXISTS (SELECT 1 FROM public.ministers m WHERE m.id = public.get_current_minister_id() AND m.role = ''midia''))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS wf11_no_media_delete ON public.%I', table_name);
    EXECUTE format('CREATE POLICY wf11_no_media_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
      USING (NOT EXISTS (SELECT 1 FROM public.ministers m WHERE m.id = public.get_current_minister_id() AND m.role = ''midia''))', table_name);
  END LOOP;
END $$;

COMMIT;
