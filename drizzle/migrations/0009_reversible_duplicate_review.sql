ALTER TABLE public.wineries ADD COLUMN merged_into uuid REFERENCES public.wineries(id);
ALTER TABLE public.winery_duplicate_dismissals ADD COLUMN reason text NOT NULL DEFAULT 'manual review';
CREATE TABLE public.winery_merge_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kept_id uuid NOT NULL REFERENCES public.wineries(id), removed_id uuid NOT NULL REFERENCES public.wineries(id), mode text NOT NULL DEFAULT 'manual', before_state jsonb NOT NULL, after_state jsonb NOT NULL, merged_by uuid, created_at timestamptz NOT NULL DEFAULT now(), undone_at timestamptz);
GRANT SELECT ON public.winery_merge_history TO authenticated;
GRANT ALL ON public.winery_merge_history TO service_role;
ALTER TABLE public.winery_merge_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read merge history" ON public.winery_merge_history FOR SELECT TO authenticated USING(public.is_admin());
CREATE TABLE public.winery_duplicate_previews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, pairs jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz);
GRANT SELECT ON public.winery_duplicate_previews TO authenticated;
GRANT ALL ON public.winery_duplicate_previews TO service_role;
ALTER TABLE public.winery_duplicate_previews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read own previews" ON public.winery_duplicate_previews FOR SELECT TO authenticated USING(public.is_admin() AND user_id=auth.uid());
CREATE POLICY "Hide merged wineries" ON public.wineries AS RESTRICTIVE FOR SELECT TO public USING(merged_into IS NULL);
CREATE OR REPLACE FUNCTION public.duplicate_street(_value text) RETURNS text LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT btrim(regexp_replace(regexp_replace(regexp_replace(lower(unaccent(coalesce(_value,''))), '[^a-z0-9]+',' ','g'), '\m(rue|r|route|rte)\M','rue','g'), '\s+',' ','g'));
$$;
CREATE OR REPLACE FUNCTION public.duplicate_address(_w jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
DECLARE hn text; street text; addr text; src jsonb;
BEGIN
 FOR src IN SELECT value FROM jsonb_array_elements(coalesce(nullif(_w->'sources','null'::jsonb),'[]'::jsonb)) LOOP
  IF src->>'source'='osm' THEN
   hn:=coalesce(hn,nullif(btrim(src->'tags'->>'addr:housenumber'),''));
   street:=coalesce(street,nullif(btrim(src->'tags'->>'addr:street'),''));
  END IF;
 END LOOP;
 addr:=split_part(coalesce(_w->>'address',''),',',1);
 hn:=coalesce(hn,substring(addr from '^\s*([0-9]+\s*[a-zA-Z]?(?:\s*[-–]\s*[0-9]+\s*[a-zA-Z]?)?)'));
 street:=coalesce(street,regexp_replace(addr,'^\s*[0-9]+\s*[a-zA-Z]?(?:\s*[-–]\s*[0-9]+\s*[a-zA-Z]?)?\s*',''));
 RETURN jsonb_build_object('house',regexp_replace(replace(lower(coalesce(hn,'')),'–','-'),'\s+','','g'),'street',public.duplicate_street(street));
END; $$;
CREATE OR REPLACE FUNCTION public.duplicate_house_matches(_a text,_b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT EXISTS(SELECT 1 FROM unnest(string_to_array(_a,'-')) a JOIN unnest(string_to_array(_b,'-')) b ON a=b WHERE a<>'');
$$;
CREATE OR REPLACE FUNCTION public.duplicate_classification(_a jsonb,_b jsonb) RETURNS text LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
DECLARE a jsonb:=public.duplicate_address(_a); b jsonb:=public.duplicate_address(_b);
BEGIN
 IF a->>'house'='' OR b->>'house'='' OR a->>'street'='' OR b->>'street'='' OR a->>'street'<>b->>'street' THEN RETURN 'manual'; END IF;
 IF NOT public.duplicate_house_matches(a->>'house',b->>'house') THEN RETURN 'different'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(string_to_array(public.normalized_winery_name(_a->>'name'),' ')) word WHERE length(word)>=3 AND word=ANY(string_to_array(public.normalized_winery_name(_b->>'name'),' '))) THEN RETURN 'same'; END IF;
 RETURN 'manual';
END; $$;
CREATE OR REPLACE FUNCTION public.duplicate_filled_count(_w jsonb) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
 SELECT count(*)::integer FROM jsonb_each(_w) e WHERE key NOT IN('id','created_at','created_by','region_id','merged_into','sources') AND value<>'null'::jsonb AND value<>'[]'::jsonb AND value<>'{}'::jsonb AND NOT(jsonb_typeof(value)='string' AND btrim(value#>>'{}')='');
$$;
CREATE OR REPLACE FUNCTION public.winery_duplicate_candidates() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH pairs AS(SELECT to_jsonb(a) winery_a,to_jsonb(b) winery_b, ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) distance_metres
 FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id JOIN public.regions r ON r.id=a.region_id AND r.name='Alsace'
 WHERE a.merged_into IS NULL AND b.merged_into IS NULL AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,150) AND public.winery_names_match(a.name,b.name)
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id))
 SELECT coalesce(jsonb_agg(to_jsonb(pairs)||jsonb_build_object('classification',public.duplicate_classification(winery_a,winery_b),'address_a',public.duplicate_address(winery_a),'address_b',public.duplicate_address(winery_b)) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]') INTO result FROM pairs;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.duplicate_state(_a uuid,_b uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('wineries',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]') FROM public.wineries w WHERE id IN(_a,_b)), 'recommendations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.recommendations r WHERE winery_id IN(_a,_b)), 'saves',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.saves s WHERE winery_id IN(_a,_b)));
$$;
REVOKE ALL ON FUNCTION public.duplicate_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.merge_winery_duplicate(_keep uuid,_remove uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE kept public.wineries; removed public.wineries; filled jsonb; merged_sources jsonb; snapshot jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 IF _keep=_remove THEN RAISE EXCEPTION 'Choose two different wineries'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO kept FROM public.wineries WHERE id=_keep; SELECT * INTO removed FROM public.wineries WHERE id=_remove;
 IF kept.id IS NULL OR removed.id IS NULL OR kept.merged_into IS NOT NULL OR removed.merged_into IS NOT NULL THEN RAISE EXCEPTION 'A winery has changed; refresh the list'; END IF;
 IF kept.region_id<>removed.region_id OR NOT EXISTS(SELECT 1 FROM public.regions WHERE id=kept.region_id AND name='Alsace') THEN RAISE EXCEPTION 'Both wineries must belong to Alsace'; END IF;
 snapshot:=public.duplicate_state(_keep,_remove);
 SELECT jsonb_object_agg(k.key,CASE WHEN k.value='null'::jsonb OR k.value='[]'::jsonb OR (jsonb_typeof(k.value)='string' AND btrim(k.value#>>'{}')='') THEN coalesce(to_jsonb(removed)->k.key,k.value) ELSE k.value END) INTO filled FROM jsonb_each(to_jsonb(kept)) k;
 SELECT coalesce(jsonb_agg(entry),'[]') INTO merged_sources FROM(SELECT DISTINCT value entry FROM jsonb_array_elements(coalesce(kept.sources,'[]')||coalesce(removed.sources,'[]'))) entries;
 filled:=filled||jsonb_build_object('sources',merged_sources,'featured',kept.featured OR removed.featured,'merged_into',NULL);
 SELECT * INTO kept FROM jsonb_populate_record(NULL::public.wineries,filled);
 UPDATE public.wineries SET address=kept.address,photo_url=kept.photo_url,tasting_fee=kept.tasting_fee,languages=kept.languages,opening_days=kept.opening_days,village=kept.village,created_by=kept.created_by,sources=kept.sources,visitable=kept.visitable,booking_required=kept.booking_required,opening_hours=kept.opening_hours,website=kept.website,enrichment_evidence=kept.enrichment_evidence,enrichment_confidence=kept.enrichment_confidence,last_verified_at=kept.last_verified_at,phone=kept.phone,description=kept.description,featured=kept.featured WHERE id=_keep;
 UPDATE public.recommendations r SET merge_preserved=true WHERE winery_id=_remove AND user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.recommendations k WHERE k.winery_id=_keep AND k.user_id=r.user_id AND NOT k.merge_preserved);
 UPDATE public.recommendations SET winery_id=_keep WHERE winery_id=_remove;
 INSERT INTO public.saves(user_id,winery_id,status,created_at) SELECT user_id,_keep,status,created_at FROM public.saves WHERE winery_id=_remove ON CONFLICT(user_id,winery_id,status) DO UPDATE SET created_at=least(public.saves.created_at,excluded.created_at);
 DELETE FROM public.saves WHERE winery_id=_remove;
 UPDATE public.wineries SET merged_into=_keep WHERE id=_remove;
 INSERT INTO public.winery_merge_history(kept_id,removed_id,before_state,after_state,merged_by) VALUES(_keep,_remove,snapshot,public.duplicate_state(_keep,_remove),auth.uid());
 RETURN _keep;
END; $$;
CREATE OR REPLACE FUNCTION public.undo_winery_merge(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE h public.winery_merge_history; w public.wineries; assignments text;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO h FROM public.winery_merge_history WHERE id=_id FOR UPDATE;
 IF h.id IS NULL OR h.undone_at IS NOT NULL THEN RAISE EXCEPTION 'This merge is no longer active'; END IF;
 IF public.duplicate_state(h.kept_id,h.removed_id) IS DISTINCT FROM h.after_state THEN RAISE EXCEPTION 'These records changed after the merge. Undo later merges first; new edits or notes are protected from being overwritten.'; END IF;
 DELETE FROM public.recommendations WHERE winery_id IN(h.kept_id,h.removed_id);
 DELETE FROM public.saves WHERE winery_id IN(h.kept_id,h.removed_id);
 SELECT string_agg(format('%I = restored.%I',column_name,column_name),',') INTO assignments FROM information_schema.columns WHERE table_schema='public' AND table_name='wineries' AND column_name<>'id';
 EXECUTE 'UPDATE public.wineries w SET '||assignments||' FROM jsonb_populate_recordset(NULL::public.wineries,$1) restored WHERE w.id=restored.id' USING h.before_state->'wineries';
 INSERT INTO public.recommendations SELECT * FROM jsonb_populate_recordset(NULL::public.recommendations,h.before_state->'recommendations');
 INSERT INTO public.saves SELECT * FROM jsonb_populate_recordset(NULL::public.saves,h.before_state->'saves');
 UPDATE public.winery_merge_history SET undone_at=now() WHERE id=_id;
END; $$;
CREATE OR REPLACE FUNCTION public.restore_winery_duplicate(_a uuid,_b uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 DELETE FROM public.winery_duplicate_dismissals WHERE winery_a=least(_a,_b) AND winery_b=greatest(_a,_b);
END; $$;
CREATE OR REPLACE FUNCTION public.duplicate_review_history() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('merged',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'mode',mode,'created_at',created_at,'kept_id',kept_id,'removed_id',removed_id,'wineries',before_state->'wineries') ORDER BY created_at DESC,id),'[]') FROM public.winery_merge_history WHERE undone_at IS NULL),'dismissed',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('winery_a',to_jsonb(a),'winery_b',to_jsonb(b)) ORDER BY d.created_at DESC),'[]') FROM public.winery_duplicate_dismissals d JOIN public.wineries a ON a.id=d.winery_a JOIN public.wineries b ON b.id=d.winery_b));
END; $$;
CREATE OR REPLACE FUNCTION public.preview_winery_duplicates() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pairs jsonb; token uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 pairs:=public.winery_duplicate_candidates();
 INSERT INTO public.winery_duplicate_previews(user_id,pairs) VALUES(auth.uid(),pairs) RETURNING id INTO token;
 RETURN jsonb_build_object('id',token,'pairs',pairs);
END; $$;
CREATE OR REPLACE FUNCTION public.apply_winery_duplicates(_preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.winery_duplicate_previews; pair jsonb; a uuid; b uuid; kept uuid; removed uuid; aw jsonb; bw jsonb; merges integer:=0; dismissals integer:=0;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO p FROM public.winery_duplicate_previews WHERE id=_preview AND user_id=auth.uid() FOR UPDATE;
 IF p.id IS NULL OR p.applied_at IS NOT NULL OR p.created_at<now()-interval '30 minutes' THEN RAISE EXCEPTION 'Preview expired or already applied. Preview again.'; END IF;
 IF p.pairs IS DISTINCT FROM public.winery_duplicate_candidates() THEN RAISE EXCEPTION 'The list changed. Preview again before applying.'; END IF;
 FOR pair IN SELECT value FROM jsonb_array_elements(p.pairs) LOOP
  IF pair->>'classification'='manual' THEN CONTINUE; END IF;
  a:=(pair->'winery_a'->>'id')::uuid; b:=(pair->'winery_b'->>'id')::uuid;
  WHILE (SELECT merged_into FROM public.wineries WHERE id=a) IS NOT NULL LOOP SELECT merged_into INTO a FROM public.wineries WHERE id=a; END LOOP;
  WHILE (SELECT merged_into FROM public.wineries WHERE id=b) IS NOT NULL LOOP SELECT merged_into INTO b FROM public.wineries WHERE id=b; END LOOP;
  IF a=b THEN CONTINUE; END IF;
  SELECT to_jsonb(w) INTO aw FROM public.wineries w WHERE id=a; SELECT to_jsonb(w) INTO bw FROM public.wineries w WHERE id=b;
  IF public.duplicate_classification(aw,bw)<>pair->>'classification' THEN CONTINUE; END IF;
  IF pair->>'classification'='different' THEN
   INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by,reason) VALUES(least(a,b),greatest(a,b),auth.uid(),'different house number') ON CONFLICT DO NOTHING;
   IF FOUND THEN dismissals:=dismissals+1; END IF;
  ELSE
   kept:=a; removed:=b;
   IF public.duplicate_filled_count(bw)>public.duplicate_filled_count(aw) OR (public.duplicate_filled_count(bw)=public.duplicate_filled_count(aw) AND bw->'sources' @> '[{"source":"datatourisme"}]'::jsonb AND NOT coalesce(aw->'sources' @> '[{"source":"datatourisme"}]'::jsonb,false)) THEN kept:=b; removed:=a; END IF;
   PERFORM public.merge_winery_duplicate(kept,removed);
   UPDATE public.winery_merge_history SET mode='automatic' WHERE kept_id=kept AND removed_id=removed AND undone_at IS NULL;
   merges:=merges+1;
  END IF;
 END LOOP;
 UPDATE public.winery_duplicate_previews SET applied_at=now() WHERE id=_preview;
 RETURN jsonb_build_object('merged',merges,'dismissed',dismissals);
END; $$;
REVOKE ALL ON FUNCTION public.undo_winery_merge(uuid),public.restore_winery_duplicate(uuid,uuid),public.duplicate_review_history(),public.preview_winery_duplicates(),public.apply_winery_duplicates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.undo_winery_merge(uuid),public.restore_winery_duplicate(uuid,uuid),public.duplicate_review_history(),public.preview_winery_duplicates(),public.apply_winery_duplicates(uuid) TO authenticated,service_role;