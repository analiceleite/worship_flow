-- WF-32 corrective migration. Do not rewrite the already applied migration 042.
BEGIN;

-- Mutations are authorized by the server RPC, never by legacy FOR ALL policies.
CREATE POLICY wf32_rehearsals_no_direct_insert ON public.schedule_rehearsals
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY wf32_rehearsals_no_direct_update ON public.schedule_rehearsals
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY wf32_rehearsals_no_direct_delete ON public.schedule_rehearsals
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- Acquire before taking any row locks. A single schedule write lock also covers
-- bulk imports and changes of rehearsal/status/leadership, avoiding TOCTOU races.
-- Deliberately coarse-grained for now; reads and unrelated tables stay concurrent.
CREATE FUNCTION public.wf32_lock_schedule() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(904032);
  RETURN NULL;
END $$;
CREATE TRIGGER wf32_lock_assignments BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf32_lock_schedule();
CREATE TRIGGER wf32_lock_rehearsals BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_rehearsals
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf32_lock_schedule();
CREATE TRIGGER wf32_lock_controls BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_event_controls
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf32_lock_schedule();
CREATE TRIGGER wf32_lock_quarters BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_quarters
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf32_lock_schedule();
CREATE TRIGGER wf32_lock_members BEFORE UPDATE ON public.ministers
  FOR EACH STATEMENT EXECUTE FUNCTION public.wf32_lock_schedule();

CREATE FUNCTION public.wf32_local_instant(p_date date, p_time time, p_timezone text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE wall timestamp := p_date + p_time; instant timestamptz; delta integer;
BEGIN
  instant := wall AT TIME ZONE p_timezone;
  IF instant AT TIME ZONE p_timezone <> wall THEN RAISE EXCEPTION 'WF32_INVALID_LOCAL_TIME'; END IF;
  FOR delta IN -12..12 LOOP
    IF delta <> 0 AND (instant + delta * interval '15 minutes') AT TIME ZONE p_timezone = wall THEN
      RAISE EXCEPTION 'WF32_AMBIGUOUS_LOCAL_TIME';
    END IF;
  END LOOP;
  RETURN instant;
END $$;

CREATE FUNCTION public.wf32_event_window(p_quarter uuid, p_date date, p_type text)
RETURNS tstzrange LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.schedule_quarters; r public.schedule_rehearsals; tz text;
  arrival time; service time; start_at timestamptz; end_at timestamptz;
BEGIN
  SELECT * INTO STRICT q FROM public.schedule_quarters WHERE id = p_quarter;
  IF p_date NOT BETWEEN q.start_date AND q.end_date OR p_type NOT IN ('thursday','sunday') THEN
    RAISE EXCEPTION 'WF32_INVALID_EVENT';
  END IF;
  SELECT timezone INTO tz FROM public.churches WHERE id = q.church_id;
  SELECT * INTO r FROM public.schedule_rehearsals
    WHERE church_id=q.church_id AND quarter_id=p_quarter AND event_date=p_date AND event_type=p_type;
  arrival := coalesce(r.rehearsal_time, CASE WHEN p_type='thursday' THEN q.thursday_arrival_time ELSE q.sunday_arrival_time END);
  service := CASE WHEN p_type='thursday' THEN q.thursday_service_time ELSE q.sunday_service_time END;
  start_at := public.wf32_local_instant(coalesce(r.rehearsal_date,p_date), arrival, tz);
  end_at := public.wf32_local_instant(p_date,service,tz) + interval '90 minutes';
  IF start_at IS NULL OR end_at IS NULL OR start_at >= end_at THEN RAISE EXCEPTION 'WF32_INVALID_EVENT_TIME'; END IF;
  RETURN tstzrange(start_at,end_at,'[)');
END $$;

CREATE FUNCTION public.wf32_check_event(p_church uuid, p_quarter uuid, p_date date, p_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate tstzrange; conflict record; reason text; actor uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schedule_event_controls WHERE church_id=p_church AND quarter_id=p_quarter
    AND event_date=p_date AND event_type=p_type AND status='cancelled') THEN RETURN; END IF;
  candidate := public.wf32_event_window(p_quarter,p_date,p_type);
  reason := nullif(trim(current_setting('wf32.override_reason',true)), '');
  actor := nullif(current_setting('wf32.actor',true),'')::uuid;
  FOR conflict IN
    SELECT DISTINCT a.id, a.minister_id, b.event_date, b.event_type
    FROM public.schedule_assignments a JOIN public.schedule_assignments b
      ON b.church_id=a.church_id AND b.minister_id=a.minister_id
    WHERE a.church_id=p_church AND a.quarter_id=p_quarter AND a.event_date=p_date AND a.event_type=p_type
      AND (b.quarter_id,b.event_date,b.event_type) <> (p_quarter,p_date,p_type)
      AND NOT EXISTS (SELECT 1 FROM public.schedule_event_controls c WHERE c.church_id=b.church_id
        AND c.quarter_id=b.quarter_id AND c.event_date=b.event_date AND c.event_type=b.event_type AND c.status='cancelled')
      AND candidate && public.wf32_event_window(b.quarter_id,b.event_date,b.event_type)
  LOOP
    IF reason IS NULL OR NOT EXISTS (SELECT 1 FROM public.ministers WHERE id=actor AND church_id=p_church
      AND role='admin' AND is_active AND access_state='active') THEN
      RAISE EXCEPTION 'WF32_SCHEDULE_CONFLICT' USING DETAIL=json_build_object('event_date',conflict.event_date,'event_type',conflict.event_type)::text;
    END IF;
    INSERT INTO public.schedule_conflict_overrides(church_id,quarter_id,assignment_id,minister_id,event_date,event_type,
      conflict_event_date,conflict_event_type,reason,overridden_by)
    VALUES(p_church,p_quarter,conflict.id,conflict.minister_id,p_date,p_type,conflict.event_date,conflict.event_type,reason,actor);
  END LOOP;
END $$;

CREATE FUNCTION public.wf32_validate_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE category text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.church_id,NEW.quarter_id,NEW.role_id,NEW.event_date,NEW.event_type)
    IS DISTINCT FROM (OLD.church_id,OLD.quarter_id,OLD.role_id,OLD.event_date,OLD.event_type) THEN
    RAISE EXCEPTION 'WF32_IMMUTABLE_ASSIGNMENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schedule_quarters q WHERE q.id=NEW.quarter_id AND q.church_id=NEW.church_id
    AND NEW.event_date BETWEEN q.start_date AND q.end_date) THEN RAISE EXCEPTION 'WF32_INVALID_EVENT'; END IF;
  IF NEW.minister_id IS NOT NULL THEN
    SELECT r.category INTO category FROM public.schedule_roles r WHERE r.id=NEW.role_id;
    IF NOT EXISTS (SELECT 1 FROM public.ministers m WHERE m.id=NEW.minister_id AND m.church_id=NEW.church_id
      AND m.is_active AND m.access_state='active' AND (category<>'midia' OR m.role='midia')) THEN
      RAISE EXCEPTION 'WF32_INVALID_MINISTER';
    END IF;
  ELSE NEW.is_trainee := false;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wf32_assignment_validate BEFORE INSERT OR UPDATE ON public.schedule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.wf32_validate_assignment();

CREATE FUNCTION public.wf32_after_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row_data public.schedule_assignments;
BEGIN
  row_data := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  -- Clear the designation only when the last assignment is removed.
  UPDATE public.schedule_event_controls c SET leader_minister_id=NULL, updated_at=now()
    WHERE c.church_id=row_data.church_id AND c.quarter_id=row_data.quarter_id AND c.event_date=row_data.event_date
      AND c.event_type=row_data.event_type AND c.leader_minister_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.schedule_assignments a WHERE a.church_id=c.church_id AND a.quarter_id=c.quarter_id
        AND a.event_date=c.event_date AND a.event_type=c.event_type AND a.minister_id=c.leader_minister_id);
  IF TG_OP <> 'DELETE' AND NEW.minister_id IS NOT NULL THEN
    IF TG_OP='INSERT' OR NEW.minister_id IS DISTINCT FROM OLD.minister_id THEN
      PERFORM public.wf32_check_event(NEW.church_id,NEW.quarter_id,NEW.event_date,NEW.event_type);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER wf32_assignment_after AFTER INSERT OR UPDATE OR DELETE ON public.schedule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.wf32_after_assignment();

CREATE FUNCTION public.wf32_validate_event_data() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schedule_quarters q WHERE q.id=NEW.quarter_id AND q.church_id=NEW.church_id
    AND NEW.event_date BETWEEN q.start_date AND q.end_date) THEN RAISE EXCEPTION 'WF32_INVALID_EVENT'; END IF;
  IF TG_TABLE_NAME='schedule_event_controls' THEN
   IF NEW.leader_minister_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.schedule_assignments a JOIN public.ministers m ON m.id=a.minister_id
      WHERE a.church_id=NEW.church_id AND a.quarter_id=NEW.quarter_id AND a.event_date=NEW.event_date
        AND a.event_type=NEW.event_type AND m.id=NEW.leader_minister_id AND m.church_id=NEW.church_id
        AND m.is_active AND m.access_state='active') THEN RAISE EXCEPTION 'WF32_INVALID_LEADER'; END IF;
   END IF;
  END IF;
  IF TG_TABLE_NAME='schedule_event_controls' THEN
    IF NEW.status='scheduled' THEN
      IF TG_OP='INSERT' OR OLD.status='cancelled' THEN
        PERFORM public.wf32_check_event(NEW.church_id,NEW.quarter_id,NEW.event_date,NEW.event_type);
      END IF;
    END IF;
  ELSE
    IF TG_OP='INSERT' OR (NEW.rehearsal_date,NEW.rehearsal_time) IS DISTINCT FROM (OLD.rehearsal_date,OLD.rehearsal_time) THEN
      PERFORM public.wf32_check_event(NEW.church_id,NEW.quarter_id,NEW.event_date,NEW.event_type);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER wf32_rehearsal_validate AFTER INSERT OR UPDATE ON public.schedule_rehearsals
  FOR EACH ROW EXECUTE FUNCTION public.wf32_validate_event_data();
CREATE TRIGGER wf32_control_validate AFTER INSERT OR UPDATE ON public.schedule_event_controls
  FOR EACH ROW EXECUTE FUNCTION public.wf32_validate_event_data();

CREATE FUNCTION public.wf32_clear_inactive_leader() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.is_active OR NEW.access_state <> 'active' THEN
    UPDATE public.schedule_event_controls SET leader_minister_id=NULL,updated_at=now()
      WHERE church_id=NEW.church_id AND leader_minister_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER wf32_member_leadership AFTER UPDATE OF is_active,access_state ON public.ministers
  FOR EACH ROW EXECUTE FUNCTION public.wf32_clear_inactive_leader();

-- Only the trusted server may establish the actor/exception context. The context
-- and audit row share the same transaction as the mutation (including imports).
CREATE FUNCTION public.wf32_mutate_schedule(p_church uuid,p_actor uuid,p_operation text,p_payload jsonb,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor public.ministers; a public.schedule_assignments; item jsonb; result jsonb; q public.schedule_quarters;
  event_day date; event_kind text; row_id uuid; changed integer := 0; skipped integer := 0; affected uuid[] := '{}';
BEGIN
  PERFORM pg_advisory_xact_lock(904032);
  SELECT * INTO actor FROM public.ministers WHERE id=p_actor AND church_id=p_church AND is_active AND access_state='active';
  IF actor.id IS NULL OR (p_operation<>'rehearsal' AND actor.role<>'admin') THEN RAISE EXCEPTION 'WF32_FORBIDDEN'; END IF;
  IF nullif(trim(p_reason),'') IS NOT NULL AND actor.role<>'admin' THEN RAISE EXCEPTION 'WF32_FORBIDDEN'; END IF;
  PERFORM set_config('wf32.actor',p_actor::text,true);
  PERFORM set_config('wf32.override_reason',coalesce(p_reason,''),true);
  IF p_operation IN ('assignment','import') THEN
    FOR item IN SELECT value FROM jsonb_array_elements(CASE WHEN p_operation='import' THEN p_payload->'items' ELSE jsonb_build_array(p_payload) END) LOOP
      IF coalesce(item->>'id',item->>'assignment_id') IS NOT NULL THEN
        SELECT * INTO a FROM public.schedule_assignments WHERE id=coalesce(item->>'id',item->>'assignment_id')::uuid AND church_id=p_church;
        IF a.id IS NULL THEN RAISE EXCEPTION 'WF32_ASSIGNMENT_NOT_FOUND'; END IF;
        IF (item ? 'quarter_id' AND (item->>'quarter_id')::uuid IS DISTINCT FROM a.quarter_id)
          OR (item ? 'role_id' AND (item->>'role_id')::uuid IS DISTINCT FROM a.role_id)
          OR (item ? 'event_date' AND (item->>'event_date')::date IS DISTINCT FROM a.event_date)
          OR (item ? 'event_type' AND item->>'event_type' IS DISTINCT FROM a.event_type)
          OR (p_operation='import' AND a.quarter_id<>(p_payload->>'quarter_id')::uuid) THEN
          RAISE EXCEPTION 'WF32_IMMUTABLE_ASSIGNMENT';
        END IF;
      ELSE
        SELECT * INTO a FROM public.schedule_assignments WHERE church_id=p_church
          AND quarter_id=(item->>'quarter_id')::uuid AND role_id=(item->>'role_id')::uuid
          AND event_date=(item->>'event_date')::date AND event_type=item->>'event_type';
        IF a.id IS NULL THEN
          INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,event_date,event_type)
            VALUES(p_church,(item->>'quarter_id')::uuid,(item->>'role_id')::uuid,(item->>'event_date')::date,item->>'event_type') RETURNING * INTO a;
        END IF;
      END IF;
      row_id := a.id;
      affected := array_append(array_append(affected,a.minister_id),(item->>'minister_id')::uuid);
      IF a.minister_id IS NOT DISTINCT FROM (item->>'minister_id')::uuid
        AND a.is_trainee=coalesce((item->>'is_trainee')::boolean,false) THEN skipped := skipped+1; CONTINUE; END IF;
      UPDATE public.schedule_assignments SET minister_id=(item->>'minister_id')::uuid,
        is_trainee=coalesce((item->>'is_trainee')::boolean,false) WHERE id=a.id;
      changed := changed+1;
    END LOOP;
    RETURN jsonb_build_object('id',row_id,'updated_count',changed,'skipped_count',skipped,'affected_minister_ids',affected);
  END IF;
  SELECT * INTO q FROM public.schedule_quarters WHERE id=(p_payload->>'quarter_id')::uuid AND church_id=p_church;
  IF q.id IS NULL THEN RAISE EXCEPTION 'WF32_INVALID_EVENT'; END IF;
  event_day := (p_payload->>'event_date')::date; event_kind := p_payload->>'event_type';
  IF p_operation='rehearsal' THEN
    IF actor.role<>'admin' AND (NOT q.is_published OR NOT EXISTS (
      SELECT 1 FROM public.schedule_event_controls c JOIN public.schedule_assignments slot ON slot.church_id=c.church_id
        AND slot.quarter_id=c.quarter_id AND slot.event_date=c.event_date AND slot.event_type=c.event_type AND slot.minister_id=c.leader_minister_id
      WHERE c.church_id=p_church AND c.quarter_id=q.id AND c.event_date=event_day AND c.event_type=event_kind
        AND c.leader_minister_id=p_actor AND c.status='scheduled')) THEN RAISE EXCEPTION 'WF32_FORBIDDEN'; END IF;
    INSERT INTO public.schedule_rehearsals(church_id,quarter_id,event_date,event_type,rehearsal_date,rehearsal_time,rehearsal_place)
      VALUES(p_church,q.id,event_day,event_kind,(p_payload->>'rehearsal_date')::date,(p_payload->>'rehearsal_time')::time,p_payload->>'rehearsal_place')
      ON CONFLICT(quarter_id,event_date,event_type) DO UPDATE SET rehearsal_date=excluded.rehearsal_date,
        rehearsal_time=excluded.rehearsal_time,rehearsal_place=excluded.rehearsal_place,updated_at=now()
      RETURNING to_jsonb(schedule_rehearsals.*) INTO result;
    RETURN result;
  ELSIF p_operation='control' THEN
    IF NOT EXISTS (SELECT 1 FROM public.schedule_assignments WHERE church_id=p_church AND quarter_id=q.id
      AND event_date=event_day AND event_type=event_kind) THEN RAISE EXCEPTION 'WF32_INVALID_EVENT'; END IF;
    IF p_payload ? 'action' AND NOT q.is_published THEN RAISE EXCEPTION 'WF32_INVALID_EVENT'; END IF;
    INSERT INTO public.schedule_event_controls(church_id,quarter_id,event_date,event_type,leader_minister_id,status,cancelled_at,cancelled_by)
      VALUES(p_church,q.id,event_day,event_kind,(p_payload->>'leader_minister_id')::uuid,
        CASE WHEN p_payload->>'action'='cancel' THEN 'cancelled' ELSE 'scheduled' END,
        CASE WHEN p_payload->>'action'='cancel' THEN now() END,CASE WHEN p_payload->>'action'='cancel' THEN p_actor END)
      ON CONFLICT(church_id,quarter_id,event_date,event_type) DO UPDATE SET
        leader_minister_id=CASE WHEN p_payload ? 'leader_minister_id' THEN excluded.leader_minister_id ELSE schedule_event_controls.leader_minister_id END,
        status=CASE WHEN p_payload ? 'action' THEN excluded.status ELSE schedule_event_controls.status END,
        cancelled_at=CASE WHEN p_payload ? 'action' THEN excluded.cancelled_at ELSE schedule_event_controls.cancelled_at END,
        cancelled_by=CASE WHEN p_payload ? 'action' THEN excluded.cancelled_by ELSE schedule_event_controls.cancelled_by END,updated_at=now()
      RETURNING to_jsonb(schedule_event_controls.*) INTO result;
    RETURN result;
  ELSIF p_operation='publish' THEN
    IF coalesce((p_payload->>'is_published')::boolean,false) THEN
      UPDATE public.schedule_quarters SET is_published=false WHERE church_id=p_church AND id<>q.id AND is_published;
    END IF;
    UPDATE public.schedule_quarters SET is_published=(p_payload->>'is_published')::boolean,
      publication_revision=publication_revision+CASE WHEN NOT coalesce(is_published,false) AND (p_payload->>'is_published')::boolean THEN 1 ELSE 0 END
      WHERE id=q.id RETURNING to_jsonb(schedule_quarters.*) INTO result;
    RETURN result;
  END IF;
  RAISE EXCEPTION 'WF32_INVALID_OPERATION';
END $$;
REVOKE ALL ON FUNCTION public.wf32_mutate_schedule(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wf32_mutate_schedule(uuid,uuid,text,jsonb,text) TO service_role;

-- Durable transactional notification intent: the actual queue row is the outbox.
-- It cannot be lost between saving a mutation and calling an external provider.
CREATE FUNCTION public.wf32_queue_event(p_church uuid,p_quarter uuid,p_date date,p_type text,p_kind text,p_extra uuid[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE change_id text := txid_current()::text||':'||p_quarter::text||':'||p_date::text||':'||p_type; period_name text;
BEGIN
  SELECT name INTO period_name FROM public.schedule_quarters WHERE id=p_quarter AND church_id=p_church AND is_published;
  IF period_name IS NULL THEN RETURN; END IF;
  INSERT INTO public.schedule_email_notifications(church_id,dedupe_key,notification_type,quarter_id,minister_id,event_date,status,attempts,payload_json)
    SELECT p_church,p_kind||':'||change_id::text||':'||m.id::text,p_kind,p_quarter,m.id,p_date,'pending',0,
      jsonb_build_object('bimester_name',period_name,'minister_name',m.name,'minister_email',m.email,
        'target_date',p_date,'event_type_label',CASE WHEN p_type='thursday' THEN 'Quinta-feira' ELSE 'Domingo' END,'change_id',change_id)
    FROM public.ministers m WHERE m.church_id=p_church AND m.is_active AND m.access_state='active' AND m.email IS NOT NULL AND (
      m.id=ANY(p_extra) OR EXISTS (SELECT 1 FROM public.schedule_assignments a WHERE a.church_id=p_church AND a.quarter_id=p_quarter
        AND a.event_date=p_date AND a.event_type=p_type AND a.minister_id=m.id)
      OR EXISTS (SELECT 1 FROM public.schedule_event_controls c WHERE c.church_id=p_church AND c.quarter_id=p_quarter
        AND c.event_date=p_date AND c.event_type=p_type AND c.leader_minister_id=m.id))
    ON CONFLICT(dedupe_key) DO NOTHING;
END $$;

CREATE FUNCTION public.wf32_notify_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; extra uuid[] := '{}'; kind text := 'schedule_changed';
BEGIN
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='schedule_assignments' THEN
      IF (NEW.minister_id,NEW.is_trainee) IS NOT DISTINCT FROM (OLD.minister_id,OLD.is_trainee) THEN RETURN NULL; END IF;
      extra := ARRAY[OLD.minister_id];
    ELSIF TG_TABLE_NAME='schedule_rehearsals' THEN
      IF (NEW.rehearsal_date,NEW.rehearsal_time,NEW.rehearsal_place) IS NOT DISTINCT FROM (OLD.rehearsal_date,OLD.rehearsal_time,OLD.rehearsal_place) THEN RETURN NULL; END IF;
    ELSE
      IF (NEW.status,NEW.leader_minister_id) IS NOT DISTINCT FROM (OLD.status,OLD.leader_minister_id) THEN RETURN NULL; END IF;
      extra := ARRAY[OLD.leader_minister_id];
      IF NEW.status<>OLD.status THEN kind := CASE WHEN NEW.status='cancelled' THEN 'event_cancelled' ELSE 'event_reactivated' END; END IF;
    END IF;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME='schedule_assignments' THEN
    IF NEW.minister_id IS NULL THEN RETURN NULL; END IF;
  END IF;
  IF TG_OP='DELETE' THEN r := OLD; extra := ARRAY[OLD.minister_id]; ELSE r := NEW; END IF;
  PERFORM public.wf32_queue_event(r.church_id,r.quarter_id,r.event_date,r.event_type,kind,extra);
  RETURN NULL;
END $$;
CREATE TRIGGER wf32_notify_assignment AFTER INSERT OR UPDATE OR DELETE ON public.schedule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.wf32_notify_mutation();
CREATE TRIGGER wf32_notify_rehearsal AFTER INSERT OR UPDATE ON public.schedule_rehearsals
  FOR EACH ROW EXECUTE FUNCTION public.wf32_notify_mutation();
CREATE TRIGGER wf32_notify_control AFTER INSERT OR UPDATE ON public.schedule_event_controls
  FOR EACH ROW EXECUTE FUNCTION public.wf32_notify_mutation();

CREATE FUNCTION public.wf32_notify_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE kind text; key_prefix text;
BEGIN
  IF NEW.is_published IS NOT DISTINCT FROM OLD.is_published THEN RETURN NULL; END IF;
  kind := CASE WHEN NEW.is_published THEN 'quarter_published' ELSE 'schedule_changed' END;
  key_prefix := CASE WHEN NEW.is_published THEN 'quarter_published' ELSE 'quarter_unpublished' END;
  INSERT INTO public.schedule_email_notifications(church_id,dedupe_key,notification_type,quarter_id,minister_id,status,attempts,payload_json)
    SELECT NEW.church_id,key_prefix||':'||NEW.church_id::text||':'||NEW.id::text||':'||NEW.publication_revision::text||':'||m.id::text,
      kind,NEW.id,m.id,'pending',0,jsonb_build_object('bimester_name',NEW.name,'minister_name',m.name,'minister_email',m.email,
        'message_kind',CASE WHEN NEW.is_published THEN 'quarter_published' ELSE 'quarter_unpublished' END,
        'items',coalesce((SELECT jsonb_agg(jsonb_build_object('event_date',a.event_date,'event_type',a.event_type,'role_name',r.name,
          'rehearsal_date',h.rehearsal_date,'rehearsal_time',h.rehearsal_time,'rehearsal_place',h.rehearsal_place) ORDER BY a.event_date,r.display_order)
          FROM public.schedule_assignments a JOIN public.schedule_roles r ON r.id=a.role_id
          LEFT JOIN public.schedule_rehearsals h ON h.church_id=a.church_id AND h.quarter_id=a.quarter_id AND h.event_date=a.event_date AND h.event_type=a.event_type
          WHERE a.church_id=NEW.church_id AND a.quarter_id=NEW.id AND a.minister_id=m.id
          AND NOT EXISTS (SELECT 1 FROM public.schedule_event_controls c WHERE c.quarter_id=a.quarter_id AND c.event_date=a.event_date
            AND c.event_type=a.event_type AND c.status='cancelled')),'[]'::jsonb))
      FROM public.ministers m WHERE m.church_id=NEW.church_id AND m.is_active AND m.access_state='active' AND m.email IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.schedule_assignments a WHERE a.church_id=NEW.church_id AND a.quarter_id=NEW.id AND a.minister_id=m.id)
    ON CONFLICT(dedupe_key) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER wf32_notify_publication AFTER UPDATE OF is_published ON public.schedule_quarters
  FOR EACH ROW EXECUTE FUNCTION public.wf32_notify_publication();

ALTER TABLE public.schedule_email_notifications ADD COLUMN claimed_at timestamptz, ADD COLUMN delivery_json jsonb,
  ADD COLUMN delivery_started_at timestamptz;
ALTER TABLE public.schedule_email_notifications DROP CONSTRAINT IF EXISTS schedule_email_notifications_status_check;
ALTER TABLE public.schedule_email_notifications ADD CONSTRAINT schedule_email_notifications_status_check
  CHECK(status IN ('pending','processing','sent','failed','skipped'));

CREATE FUNCTION public.wf32_claim_email(p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE claimed_attempt integer;
BEGIN
  UPDATE public.schedule_email_notifications SET status='processing',claimed_at=now(),attempts=attempts+1
    WHERE id=p_id AND attempts<3 AND (status IN ('pending','failed') OR (status='processing' AND claimed_at<now()-interval '10 minutes'))
    RETURNING attempts INTO claimed_attempt;
  RETURN claimed_attempt;
END $$;
REVOKE ALL ON FUNCTION public.wf32_claim_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wf32_claim_email(uuid) TO service_role;

-- Helpers with SECURITY DEFINER are implementation details, not public RPCs.
REVOKE ALL ON FUNCTION public.wf32_event_window(uuid,date,text),public.wf32_check_event(uuid,uuid,date,text),
  public.wf32_queue_event(uuid,uuid,date,text,text,uuid[]) FROM PUBLIC,anon,authenticated;

-- Repair stale leadership left by pre-043 assignment removal/suspension.
UPDATE public.schedule_event_controls c SET leader_minister_id=NULL,updated_at=now()
  WHERE c.leader_minister_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.schedule_assignments a JOIN public.ministers m ON m.id=a.minister_id
    WHERE a.church_id=c.church_id AND a.quarter_id=c.quarter_id AND a.event_date=c.event_date AND a.event_type=c.event_type
      AND m.id=c.leader_minister_id AND m.church_id=c.church_id AND m.is_active AND m.access_state='active');
NOTIFY pgrst,'reload schema';
COMMIT;
