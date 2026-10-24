CREATE OR REPLACE FUNCTION public.duplicate_has_source(_w jsonb,_source text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(_w->'sources' @> jsonb_build_array(jsonb_build_object('source',_source)),false);
$$;
CREATE OR REPLACE FUNCTION public.duplicate_osm_only(_w jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT public.duplicate_has_source(_w,'osm') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(_w->'sources','null'::jsonb),'[]'::jsonb)) s WHERE s->>'source' IS DISTINCT FROM 'osm');
$$;
CREATE OR REPLACE FUNCTION public.duplicate_unique_osm(_pair jsonb,_pairs jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
DECLARE a jsonb:=_pair->'winery_a'; b jsonb:=_pair->'winery_b'; osm jsonb; dt jsonb; others integer;
BEGIN
 IF public.duplicate_osm_only(a) AND public.duplicate_has_source(b,'datatourisme') THEN osm:=a; dt:=b;
 ELSIF public.duplicate_osm_only(b) AND public.duplicate_has_source(a,'datatourisme') THEN osm:=b; dt:=a;
 ELSE RETURN false; END IF;
 IF (_pair->>'distance_metres')::numeric>100 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM unnest(string_to_array(public.normalized_winery_name(osm->>'name'),' ')) word WHERE length(word)>=3 AND word=ANY(string_to_array(public.normalized_winery_name(dt->>'name'),' '))) THEN RETURN false; END IF;
 SELECT count(*) INTO others FROM jsonb_array_elements(_pairs) p
 WHERE NOT ((p->'winery_a'->>'id'=a->>'id' AND p->'winery_b'->>'id'=b->>'id') OR (p->'winery_a'->>'id'=b->>'id' AND p->'winery_b'->>'id'=a->>'id'))
 AND ((p->'winery_a'->>'id'=osm->>'id' AND public.duplicate_has_source(p->'winery_b','datatourisme')) OR (p->'winery_b'->>'id'=osm->>'id' AND public.duplicate_has_source(p->'winery_a','datatourisme')) OR (p->'winery_a'->>'id'=dt->>'id' AND public.duplicate_has_source(p->'winery_b','osm')) OR (p->'winery_b'->>'id'=dt->>'id' AND public.duplicate_has_source(p->'winery_a','osm')));
 RETURN others=0;
END; $$;
CREATE OR REPLACE FUNCTION public.winery_duplicate_candidates() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; candidates jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH pairs AS(SELECT to_jsonb(a) winery_a,to_jsonb(b) winery_b, ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) distance_metres
 FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id JOIN public.regions r ON r.id=a.region_id AND r.name='Alsace'
 WHERE a.merged_into IS NULL AND b.merged_into IS NULL AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,150) AND public.winery_names_match(a.name,b.name)
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id))
 SELECT coalesce(jsonb_agg(to_jsonb(pairs) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]') INTO candidates FROM pairs;
 SELECT coalesce(jsonb_agg(p||jsonb_build_object('classification',CASE WHEN public.duplicate_classification(p->'winery_a',p->'winery_b')='different' THEN 'different' WHEN public.duplicate_unique_osm(p,candidates) THEN 'unique_osm' ELSE public.duplicate_classification(p->'winery_a',p->'winery_b') END,'address_a',public.duplicate_address(p->'winery_a'),'address_b',public.duplicate_address(p->'winery_b')) ORDER BY ord),'[]') INTO result FROM jsonb_array_elements(candidates) WITH ORDINALITY t(p,ord);
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.apply_winery_duplicates(_preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.winery_duplicate_previews; pair jsonb; a uuid; b uuid; kept uuid; removed uuid; aw jsonb; bw jsonb; osm_lat float8; osm_lng float8; merges integer:=0; dismissals integer:=0; unique_merges integer:=0;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO p FROM public.winery_duplicate_previews WHERE id=_preview AND user_id=auth.uid() FOR UPDATE;
 IF p.id IS NULL OR p.applied_at IS NOT NULL OR p.created_at<now()-interval '30 minutes' THEN RAISE EXCEPTION 'Preview expired or already applied. Preview again.'; END IF;
 IF p.pairs IS DISTINCT FROM public.winery_duplicate_candidates() THEN RAISE EXCEPTION 'The list changed. Preview again before applying.'; END IF;
 FOR pair IN SELECT value FROM jsonb_array_elements(p.pairs) WITH ORDINALITY t(value,ord) ORDER BY CASE WHEN value->>'classification'='unique_osm' THEN 0 ELSE 1 END,ord LOOP
  IF pair->>'classification'='manual' THEN CONTINUE; END IF;
  a:=(pair->'winery_a'->>'id')::uuid; b:=(pair->'winery_b'->>'id')::uuid;
  WHILE (SELECT merged_into FROM public.wineries WHERE id=a) IS NOT NULL LOOP SELECT merged_into INTO a FROM public.wineries WHERE id=a; END LOOP;
  WHILE (SELECT merged_into FROM public.wineries WHERE id=b) IS NOT NULL LOOP SELECT merged_into INTO b FROM public.wineries WHERE id=b; END LOOP;
  IF a=b THEN CONTINUE; END IF;
  SELECT to_jsonb(w) INTO aw FROM public.wineries w WHERE id=a; SELECT to_jsonb(w) INTO bw FROM public.wineries w WHERE id=b;
  IF pair->>'classification'='unique_osm' THEN
   IF NOT public.duplicate_unique_osm(pair,p.pairs) THEN CONTINUE; END IF;
   IF public.duplicate_osm_only(aw) AND public.duplicate_has_source(bw,'datatourisme') THEN kept:=b; removed:=a; osm_lat:=(aw->>'latitude')::float8; osm_lng:=(aw->>'longitude')::float8;
   ELSIF public.duplicate_osm_only(bw) AND public.duplicate_has_source(aw,'datatourisme') THEN kept:=a; removed:=b; osm_lat:=(bw->>'latitude')::float8; osm_lng:=(bw->>'longitude')::float8;
   ELSE CONTINUE; END IF;
   PERFORM public.merge_winery_duplicate(kept,removed);
   UPDATE public.wineries SET latitude=osm_lat,longitude=osm_lng WHERE id=kept;
   UPDATE public.winery_merge_history SET mode='unique_osm',after_state=public.duplicate_state(kept,removed) WHERE kept_id=kept AND removed_id=removed AND undone_at IS NULL;
   merges:=merges+1; unique_merges:=unique_merges+1;
   CONTINUE;
  END IF;
  IF public.duplicate_classification(aw,bw)<>pair->>'classification' THEN CONTINUE; END IF;
  IF pair->>'classification'='different' THEN
   INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by,reason) VALUES(least(a,b),greatest(a,b),auth.uid(),'different house number') ON CONFLICT DO NOTHING;
   IF FOUND THEN dismissals:=dismissals+1; END IF;
  ELSE
   kept:=a; removed:=b;
   IF public.duplicate_filled_count(bw)>public.duplicate_filled_count(aw) OR (public.duplicate_filled_count(bw)=public.duplicate_filled_count(aw) AND public.duplicate_has_source(bw,'datatourisme') AND NOT public.duplicate_has_source(aw,'datatourisme')) THEN kept:=b; removed:=a; END IF;
   PERFORM public.merge_winery_duplicate(kept,removed);
   UPDATE public.winery_merge_history SET mode='automatic' WHERE kept_id=kept AND removed_id=removed AND undone_at IS NULL;
   merges:=merges+1;
  END IF;
 END LOOP;
 UPDATE public.winery_duplicate_previews SET applied_at=now() WHERE id=_preview;
 RETURN jsonb_build_object('merged',merges,'dismissed',dismissals,'unique_osm',unique_merges);
END; $$;