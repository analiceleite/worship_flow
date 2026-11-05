-- WF-07. Apply during a coordinated maintenance window: old clients cannot write.
BEGIN;
LOCK TABLE public.repertoire IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.repertoire GROUP BY church_id, event_date,
      coalesce(event_name, ''), song_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'WF07_DUPLICATES: review duplicate songs before migration; no items removed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.repertoire r JOIN public.songs s ON s.id=r.song_id
      LEFT JOIN public.ministers m ON m.id=r.minister_id
      WHERE s.church_id<>r.church_id OR (r.minister_id IS NOT NULL AND m.church_id<>r.church_id)) THEN
    RAISE EXCEPTION 'WF07_INVALID_TENANT: review cross-church references';
  END IF;
END $$;

CREATE TABLE public.repertoire_sequences (
  church_id uuid NOT NULL REFERENCES public.churches(id),
  event_date date NOT NULL,
  event_key text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (church_id,event_date,event_key)
);
ALTER TABLE public.repertoire_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.repertoire_sequences FROM anon, authenticated;
GRANT ALL ON public.repertoire_sequences TO service_role;

UPDATE public.repertoire SET event_name=coalesce(event_name,'');
ALTER TABLE public.repertoire ALTER COLUMN event_name SET DEFAULT '';
ALTER TABLE public.repertoire ALTER COLUMN event_name SET NOT NULL;
WITH ordered AS (
 SELECT id,row_number() OVER (PARTITION BY church_id,event_date,event_name
   ORDER BY order_index ASC NULLS LAST,id) AS position FROM public.repertoire
)
UPDATE public.repertoire r SET order_index=o.position FROM ordered o WHERE o.id=r.id;
ALTER TABLE public.repertoire ALTER COLUMN order_index SET NOT NULL;
ALTER TABLE public.repertoire ADD CONSTRAINT repertoire_positive_order CHECK(order_index>0);
ALTER TABLE public.repertoire ADD CONSTRAINT repertoire_sequence_order
 UNIQUE(church_id,event_date,event_name,order_index) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.repertoire ADD CONSTRAINT repertoire_sequence_song
 UNIQUE(church_id,event_date,event_name,song_id);
INSERT INTO public.repertoire_sequences(church_id,event_date,event_key)
 SELECT DISTINCT church_id,event_date,event_name FROM public.repertoire;

-- Prevent bypass by legacy clients and administrative scripts as well.
CREATE FUNCTION public.wf07_guard_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('wf07.writing',true) IS DISTINCT FROM 'on' THEN
   RAISE EXCEPTION 'WF07_PROTOCOL_REQUIRED';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER repertoire_protocol BEFORE INSERT OR UPDATE OR DELETE ON public.repertoire
 FOR EACH ROW EXECUTE FUNCTION public.wf07_guard_write();
REVOKE INSERT, UPDATE, DELETE ON public.repertoire FROM anon, authenticated;

-- Actor and church come only from the authenticated server, not the HTTP body.
CREATE FUNCTION public.wf07_authorize(p_actor uuid,p_church uuid,p_impersonating boolean)
RETURNS public.ministers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.ministers;
BEGIN
 IF p_impersonating THEN
   IF NOT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=p_actor) THEN
     RAISE EXCEPTION 'WF07_FORBIDDEN';
   END IF;
   m.role := 'admin'; m.church_id := p_church;
 ELSE
   SELECT * INTO m FROM public.ministers WHERE user_id=p_actor AND church_id=p_church;
   IF m.id IS NULL THEN RAISE EXCEPTION 'WF07_FORBIDDEN'; END IF;
 END IF;
 RETURN m;
END $$;

CREATE FUNCTION public.wf07_snapshot(p_church uuid,p_date date,p_name text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('revision',coalesce((SELECT revision::text FROM public.repertoire_sequences
   WHERE church_id=p_church AND event_date=p_date AND event_key=p_name),'0'),
 'total',count(*),'items',coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
   'song',(to_jsonb(s)-'cifra_content')||jsonb_build_object('cifra_available',coalesce(cardinality(s.cifra_content),0)>0),
   'minister',CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('id',m.id,'name',m.name,'avatar_url',m.avatar_url) END)
   ORDER BY r.order_index,r.id),'[]'::jsonb))
 FROM public.repertoire r JOIN public.songs s ON s.id=r.song_id
 LEFT JOIN public.ministers m ON m.id=r.minister_id
 WHERE r.church_id=p_church AND r.event_date=p_date AND r.event_name=p_name
$$;

CREATE FUNCTION public.wf07_read(p_actor uuid,p_church uuid,p_impersonating boolean,p_date date,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.wf07_authorize(p_actor,p_church,p_impersonating);
 RETURN public.wf07_snapshot(p_church,p_date,p_name);
END $$;

CREATE FUNCTION public.wf07_mutate(p_actor uuid,p_church uuid,p_impersonating boolean,
 p_date date,p_name text,p_revision text,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.ministers; v bigint; ids uuid[]; item uuid; target integer; n integer;
 song public.songs; assignee uuid; ev public.special_events; action text:=p_command->>'action';
BEGIN
 m:=public.wf07_authorize(p_actor,p_church,p_impersonating);
 INSERT INTO public.repertoire_sequences(church_id,event_date,event_key)
 VALUES(p_church,p_date,p_name) ON CONFLICT DO NOTHING;
 SELECT revision INTO v FROM public.repertoire_sequences
 WHERE church_id=p_church AND event_date=p_date AND event_key=p_name FOR UPDATE;
 IF v::text<>p_revision THEN RAISE EXCEPTION 'WF07_CONFLICT'; END IF;
 IF action='deleteEvent' THEN
   SELECT * INTO ev FROM public.special_events WHERE id=(p_command->>'eventId')::uuid
     AND church_id=p_church AND event_date=p_date AND name=p_name FOR UPDATE;
   IF ev.id IS NULL THEN RAISE EXCEPTION 'WF07_NOT_FOUND'; END IF;
   IF m.role<>'admin' AND (ev.created_by IS DISTINCT FROM m.id OR m.role='midia') THEN
     RAISE EXCEPTION 'WF07_FORBIDDEN'; END IF;
 ELSIF m.role<>'admin' AND NOT ('voz'=ANY(regexp_split_to_array(lower(btrim(coalesce(m.instrument,''))),'\s*,\s*'))) THEN
   RAISE EXCEPTION 'WF07_FORBIDDEN';
 END IF;
 PERFORM set_config('wf07.writing','on',true);
 SELECT coalesce(array_agg(id ORDER BY order_index,id),'{}'::uuid[]) INTO ids
 FROM public.repertoire WHERE church_id=p_church AND event_date=p_date AND event_name=p_name;
 IF action='add' THEN
   SELECT * INTO song FROM public.songs WHERE id=(p_command->>'songId')::uuid AND church_id=p_church;
   assignee:=CASE WHEN m.role='admin' THEN (p_command->>'ministerId')::uuid ELSE m.id END;
   IF song.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.ministers WHERE id=assignee AND church_id=p_church)
     THEN RAISE EXCEPTION 'WF07_NOT_FOUND'; END IF;
   IF song.minister_id IS DISTINCT FROM assignee THEN RAISE EXCEPTION 'WF07_FORBIDDEN'; END IF;
   IF EXISTS(SELECT 1 FROM public.repertoire WHERE church_id=p_church AND event_date=p_date
     AND event_name=p_name AND song_id=song.id) THEN RAISE EXCEPTION 'WF07_DUPLICATE'; END IF;
   INSERT INTO public.repertoire(church_id,event_date,event_name,song_id,minister_id,order_index)
     VALUES(p_church,p_date,p_name,song.id,assignee,cardinality(ids)+1);
 ELSIF action='deleteEvent' THEN
   DELETE FROM public.repertoire WHERE id=ANY(ids);
   DELETE FROM public.special_events WHERE id=ev.id;
 ELSIF action IN ('move','remove') THEN
   item:=(p_command->>'itemId')::uuid;
   IF NOT item=ANY(ids) THEN RAISE EXCEPTION 'WF07_NOT_FOUND'; END IF;
   ids:=array_remove(ids,item);
   IF action='remove' THEN DELETE FROM public.repertoire WHERE id=item;
   ELSE
     target:=(p_command->>'position')::integer;
     IF target<1 OR target>cardinality(ids)+1 THEN RAISE EXCEPTION 'WF07_INVALID'; END IF;
     ids:=coalesce(ids[1:target-1],'{}'::uuid[])||ARRAY[item]||coalesce(ids[target:cardinality(ids)],'{}'::uuid[]);
   END IF;
   FOR n IN 1..cardinality(ids) LOOP
     UPDATE public.repertoire SET order_index=n WHERE id=ids[n];
   END LOOP;
 ELSE RAISE EXCEPTION 'WF07_INVALID'; END IF;
 UPDATE public.repertoire_sequences SET revision=revision+1
 WHERE church_id=p_church AND event_date=p_date AND event_key=p_name;
 PERFORM set_config('wf07.writing','off',true);
 RETURN public.wf07_snapshot(p_church,p_date,p_name);
END $$;

-- Minister removal uses the same locks/revisions; all its repertoire cleanup is atomic.
CREATE FUNCTION public.wf07_remove_minister_items(p_actor uuid,p_church uuid,p_impersonating boolean,p_minister uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.ministers; e record; r record; v text;
BEGIN
 m:=public.wf07_authorize(p_actor,p_church,p_impersonating);
 IF m.role<>'admin' THEN RAISE EXCEPTION 'WF07_FORBIDDEN'; END IF;
 FOR e IN SELECT DISTINCT event_date,event_name FROM public.repertoire
   WHERE church_id=p_church ORDER BY event_date,event_name LOOP
   INSERT INTO public.repertoire_sequences(church_id,event_date,event_key)
     VALUES(p_church,e.event_date,e.event_name) ON CONFLICT DO NOTHING;
   SELECT revision::text INTO v FROM public.repertoire_sequences WHERE church_id=p_church
     AND event_date=e.event_date AND event_key=e.event_name FOR UPDATE;
   FOR r IN SELECT rep.id FROM public.repertoire rep JOIN public.songs s ON s.id=rep.song_id
     WHERE rep.church_id=p_church AND rep.event_date=e.event_date AND rep.event_name=e.event_name
       AND (rep.minister_id=p_minister OR s.minister_id=p_minister) LOOP
     PERFORM public.wf07_mutate(p_actor,p_church,p_impersonating,e.event_date,e.event_name,v,
       jsonb_build_object('action','remove','itemId',r.id));
     v:=(v::bigint+1)::text;
   END LOOP;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.wf07_authorize(uuid,uuid,boolean),public.wf07_snapshot(uuid,date,text),
 public.wf07_read(uuid,uuid,boolean,date,text),public.wf07_mutate(uuid,uuid,boolean,date,text,text,jsonb),
 public.wf07_remove_minister_items(uuid,uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wf07_read(uuid,uuid,boolean,date,text),
 public.wf07_mutate(uuid,uuid,boolean,date,text,text,jsonb),
 public.wf07_remove_minister_items(uuid,uuid,boolean,uuid) TO service_role;
COMMIT;
