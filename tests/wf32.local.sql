-- Run against the isolated local Postgres only. All fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_error(expected text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM)>0 THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;
  END;
  RAISE EXCEPTION 'Expected error %, but statement succeeded',expected;
END $$;
DO $$
DECLARE c uuid; foreign_c uuid; admin_id uuid; person uuid; media uuid; foreign_person uuid; inactive uuid; q uuid;
  role_id uuid; sound uuid; a uuid; b uuid; d uuid; result jsonb; n integer; before_count integer;
BEGIN
  INSERT INTO public.churches(name,slug,environment,email_mode) VALUES('WF32 regression','wf32-regression-'||gen_random_uuid(),'test','disabled') RETURNING id INTO c;
  INSERT INTO public.churches(name,slug,environment,email_mode) VALUES('WF32 foreign','wf32-foreign-'||gen_random_uuid(),'test','disabled') RETURNING id INTO foreign_c;
  INSERT INTO public.ministers(church_id,name,role,access_state,email) VALUES(c,'Admin','admin','active','admin@wf32.test') RETURNING id INTO admin_id;
  INSERT INTO public.ministers(church_id,name,role,access_state,email) VALUES(c,'Person','minister','active','person@wf32.test') RETURNING id INTO person;
  INSERT INTO public.ministers(church_id,name,role,access_state,email) VALUES(c,'Media','midia','active','media@wf32.test') RETURNING id INTO media;
  INSERT INTO public.ministers(church_id,name,role,access_state) VALUES(foreign_c,'Foreign','minister','active') RETURNING id INTO foreign_person;
  INSERT INTO public.ministers(church_id,name,role,access_state) VALUES(c,'Inactive','minister','suspended') RETURNING id INTO inactive;
  SELECT id INTO STRICT role_id FROM public.schedule_roles WHERE category<>'midia' LIMIT 1;
  SELECT id INTO STRICT sound FROM public.schedule_roles WHERE category='midia' LIMIT 1;
  INSERT INTO public.schedule_quarters(church_id,name,start_date,end_date,thursday_arrival_time,thursday_service_time,sunday_arrival_time,sunday_service_time)
    VALUES(c,'WF32 regression','2026-01-01','2026-03-31','16:00','17:00','19:00','20:00') RETURNING id INTO q;
  INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,event_date,event_type,minister_id)
    VALUES(c,q,role_id,'2026-01-08','thursday',person) RETURNING id INTO a;
  INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,event_date,event_type)
    VALUES(c,q,role_id,'2026-01-08','sunday') RETURNING id INTO b;
  INSERT INTO public.schedule_assignments(church_id,quarter_id,role_id,event_date,event_type)
    VALUES(c,q,sound,'2026-01-08','sunday') RETURNING id INTO d;

  PERFORM pg_temp.expect_error('WF32_INVALID_MINISTER',format('SELECT public.wf32_mutate_schedule(%L,%L,''import'',%L::jsonb)',c,admin_id,
    jsonb_build_object('quarter_id',q,'items',jsonb_build_array(jsonb_build_object('assignment_id',b,'minister_id',foreign_person)))));
  PERFORM pg_temp.expect_error('WF32_INVALID_MINISTER',format('SELECT public.wf32_mutate_schedule(%L,%L,''import'',%L::jsonb)',c,admin_id,
    jsonb_build_object('quarter_id',q,'items',jsonb_build_array(jsonb_build_object('assignment_id',b,'minister_id',inactive)))));
  PERFORM pg_temp.expect_error('WF32_IMMUTABLE_ASSIGNMENT',format('SELECT public.wf32_mutate_schedule(%L,%L,''assignment'',%L::jsonb)',c,admin_id,
    jsonb_build_object('id',d,'role_id',role_id,'minister_id',person)));
  PERFORM pg_temp.expect_error('WF32_INVALID_MINISTER',format('SELECT public.wf32_mutate_schedule(%L,%L,''assignment'',%L::jsonb)',c,admin_id,
    jsonb_build_object('id',d,'minister_id',person)));

  -- Candidate rehearsal must participate in conflict checks, including imports.
  PERFORM public.wf32_mutate_schedule(c,admin_id,'rehearsal',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','17:00'));
  PERFORM pg_temp.expect_error('WF32_SCHEDULE_CONFLICT',format('SELECT public.wf32_mutate_schedule(%L,%L,''assignment'',%L::jsonb)',c,admin_id,jsonb_build_object('id',b,'minister_id',person)));
  PERFORM pg_temp.expect_error('WF32_SCHEDULE_CONFLICT',format('SELECT public.wf32_mutate_schedule(%L,%L,''import'',%L::jsonb)',c,admin_id,
    jsonb_build_object('quarter_id',q,'items',jsonb_build_array(jsonb_build_object('assignment_id',d,'minister_id',media),jsonb_build_object('assignment_id',b,'minister_id',person)))));
  IF (SELECT minister_id FROM public.schedule_assignments WHERE id=d) IS NOT NULL THEN RAISE EXCEPTION 'Partial import committed'; END IF;

  -- Compatible assignments become conflicting if the leader changes rehearsal.
  PERFORM public.wf32_mutate_schedule(c,admin_id,'rehearsal',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','19:00'));
  PERFORM public.wf32_mutate_schedule(c,admin_id,'assignment',jsonb_build_object('id',b,'minister_id',person));
  PERFORM pg_temp.expect_error('WF32_SCHEDULE_CONFLICT',format('SELECT public.wf32_mutate_schedule(%L,%L,''rehearsal'',%L::jsonb)',c,admin_id,
    jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','17:00')));

  -- Transactional exception audit and rollback if a later batch item is invalid.
  SELECT count(*) INTO before_count FROM public.schedule_conflict_overrides WHERE church_id=c;
  PERFORM pg_temp.expect_error('WF32_INVALID_MINISTER',format('SELECT public.wf32_mutate_schedule(%L,%L,''import'',%L::jsonb,''Test override'')',c,admin_id,
    jsonb_build_object('quarter_id',q,'items',jsonb_build_array(jsonb_build_object('assignment_id',d,'minister_id',foreign_person)))));
  IF (SELECT count(*) FROM public.schedule_conflict_overrides WHERE church_id=c)<>before_count THEN RAISE EXCEPTION 'Audit escaped rollback'; END IF;
  PERFORM public.wf32_mutate_schedule(c,admin_id,'rehearsal',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','17:00'),'Admin approved regression test');
  IF NOT EXISTS (SELECT 1 FROM public.schedule_conflict_overrides WHERE church_id=c AND overridden_by=admin_id) THEN RAISE EXCEPTION 'Missing atomic audit'; END IF;
  PERFORM public.wf32_mutate_schedule(c,admin_id,'rehearsal',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','19:00'));

  -- Publication writes queue rows even without any HTTP worker.
  PERFORM public.wf32_mutate_schedule(c,admin_id,'publish',jsonb_build_object('quarter_id',q,'is_published',true));
  SELECT count(*) INTO n FROM public.schedule_email_notifications WHERE church_id=c AND notification_type='quarter_published';
  IF n<>1 THEN RAISE EXCEPTION 'Expected one publication email, got %',n; END IF;
  PERFORM public.wf32_mutate_schedule(c,admin_id,'publish',jsonb_build_object('quarter_id',q,'is_published',true));
  IF (SELECT count(*) FROM public.schedule_email_notifications WHERE church_id=c AND notification_type='quarter_published')<>n THEN RAISE EXCEPTION 'Retry duplicated publication'; END IF;

  -- Media may lead an assigned event and edit its rehearsal, not other events.
  PERFORM public.wf32_mutate_schedule(c,admin_id,'assignment',jsonb_build_object('id',d,'minister_id',media));
  PERFORM public.wf32_mutate_schedule(c,admin_id,'control',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','leader_minister_id',media));
  PERFORM public.wf32_mutate_schedule(c,media,'rehearsal',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','19:00','rehearsal_place','Media leader'));
  PERFORM pg_temp.expect_error('WF32_FORBIDDEN',format('SELECT public.wf32_mutate_schedule(%L,%L,''rehearsal'',%L::jsonb)',c,person,
    jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','19:00')));
  PERFORM public.wf32_mutate_schedule(c,admin_id,'assignment',jsonb_build_object('id',d,'minister_id',null));
  IF EXISTS (SELECT 1 FROM public.schedule_event_controls WHERE quarter_id=q AND leader_minister_id=media) THEN RAISE EXCEPTION 'Removed leader retained'; END IF;
  PERFORM pg_temp.expect_error('WF32_FORBIDDEN',format('SELECT public.wf32_mutate_schedule(%L,%L,''rehearsal'',%L::jsonb)',c,media,
    jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','19:00')));

  PERFORM public.wf32_mutate_schedule(c,admin_id,'control',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','action','cancel'));
  PERFORM public.wf32_mutate_schedule(c,admin_id,'rehearsal',jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','rehearsal_time','17:00'));
  PERFORM pg_temp.expect_error('WF32_SCHEDULE_CONFLICT',format('SELECT public.wf32_mutate_schedule(%L,%L,''control'',%L::jsonb)',c,admin_id,
    jsonb_build_object('quarter_id',q,'event_date','2026-01-08','event_type','sunday','action','reactivate')));
  IF NOT EXISTS (SELECT 1 FROM public.schedule_event_controls WHERE quarter_id=q AND event_type='sunday' AND status='cancelled') THEN RAISE EXCEPTION 'Failed reactivation changed status'; END IF;

  -- Record IDs for direct RLS checks below. Create only a synthetic Auth identity.
  INSERT INTO auth.users(id,email) VALUES(person,'rls@wf32.local.test');
  -- Membership identity is immutable; a separate synthetic membership uses it.
  INSERT INTO public.ministers(church_id,user_id,name,role,access_state) VALUES(c,person,'RLS member','minister','active');
  PERFORM set_config('request.jwt.claim.sub',person::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person,'role','authenticated')::text,true);
  PERFORM set_config('wf32.test_church',c::text,true);
  PERFORM set_config('wf32.test_quarter',q::text,true);
  PERFORM set_config('wf32.test_actor',admin_id::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n integer; c uuid:=current_setting('wf32.test_church')::uuid; q uuid:=current_setting('wf32.test_quarter')::uuid;
BEGIN
  SELECT count(*) INTO n FROM public.schedule_rehearsals WHERE church_id=c;
  IF n=0 THEN RAISE EXCEPTION 'RLS fixture not visible; test would be vacuous'; END IF;
  UPDATE public.schedule_rehearsals SET rehearsal_place='BYPASS' WHERE church_id=c;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Direct rehearsal UPDATE bypass'; END IF;
  DELETE FROM public.schedule_rehearsals WHERE church_id=c;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Direct rehearsal DELETE bypass'; END IF;
  PERFORM pg_temp.expect_error('row-level security',format('INSERT INTO public.schedule_rehearsals(church_id,quarter_id,event_date,event_type) VALUES(%L,%L,''2026-01-09'',''thursday'')',c,q));
  PERFORM pg_temp.expect_error('permission denied',format('SELECT public.wf32_mutate_schedule(%L,%L,''publish'',''{}'')',c,current_setting('wf32.test_actor')));
END $$;
RESET ROLE;
SELECT 'WF32 local database regression checks passed (fixtures rolled back)' AS result;
ROLLBACK;
