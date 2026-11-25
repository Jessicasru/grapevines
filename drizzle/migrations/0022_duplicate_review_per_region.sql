-- Duplicate review one region at a time. Over every region at once, finding candidates
-- took 5 s with 5,500 wineries, and the OpenStreetMap imports will add thousands more.
-- Without a region the functions behave as before, so the distance rerun is unchanged.

ALTER TABLE public.winery_duplicate_previews ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.regions(id) ON DELETE CASCADE;

-- A default argument would clash with the old no-argument versions, so drop those first.
DROP FUNCTION IF EXISTS public.winery_duplicate_candidates();
DROP FUNCTION IF EXISTS public.preview_winery_duplicates();

-- Same as 0019, limited to one region when one is given.
CREATE OR REPLACE FUNCTION public.winery_duplicate_candidates(_region_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; candidates jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH nearby AS MATERIALIZED(SELECT a.id aid,b.id bid,to_jsonb(a) winery_a,to_jsonb(b) winery_b, ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) distance_metres
 FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id
 WHERE a.merged_into IS NULL AND b.merged_into IS NULL AND (_region_id IS NULL OR a.region_id=_region_id)
 AND ((abs(a.latitude-b.latitude)<0.003 AND abs(a.longitude-b.longitude)<0.005 AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,300)) OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=a.id AND x.winery_b=b.id))
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id)), qualified AS(SELECT p.winery_a,p.winery_b,p.distance_metres FROM nearby p WHERE public.winery_names_match(p.winery_a->>'name',p.winery_b->>'name') AND (public.duplicate_distance_qualifies(p.distance_metres,p.winery_a->>'website',p.winery_b->>'website') OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=p.aid AND x.winery_b=p.bid)))
 SELECT coalesce(jsonb_agg(to_jsonb(qualified) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]') INTO candidates FROM qualified;
 SELECT coalesce(jsonb_agg(p||jsonb_build_object('classification',CASE WHEN NOT public.duplicate_distance_qualifies((p->>'distance_metres')::float8,p->'winery_a'->>'website',p->'winery_b'->>'website') THEN 'manual' WHEN public.duplicate_classification(p->'winery_a',p->'winery_b')='different' THEN 'different' WHEN public.duplicate_unique_osm(p,candidates) THEN 'unique_osm' ELSE public.duplicate_classification(p->'winery_a',p->'winery_b') END,'address_a',public.duplicate_address(p->'winery_a'),'address_b',public.duplicate_address(p->'winery_b')) ORDER BY ord),'[]') INTO result FROM jsonb_array_elements(candidates) WITH ORDINALITY t(p,ord);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.winery_duplicate_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.winery_duplicate_candidates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_winery_duplicates(_region_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pairs jsonb; token uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 pairs:=public.winery_duplicate_candidates(_region_id);
 INSERT INTO public.winery_duplicate_previews(user_id,pairs,region_id) VALUES(auth.uid(),pairs,_region_id) RETURNING id INTO token;
 RETURN jsonb_build_object('id',token,'pairs',pairs);
END; $$;
REVOKE ALL ON FUNCTION public.preview_winery_duplicates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_winery_duplicates(uuid) TO authenticated, service_role;

-- Same as 0012, except that it compares the preview with the same region's candidates.
CREATE OR REPLACE FUNCTION public.apply_winery_duplicates(_preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.winery_duplicate_previews; pair jsonb; a uuid; b uuid; kept uuid; removed uuid; aw jsonb; bw jsonb; merges integer:=0; dismissals integer:=0; unique_merges integer:=0;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO p FROM public.winery_duplicate_previews WHERE id=_preview AND user_id=auth.uid() FOR UPDATE;
 IF p.id IS NULL OR p.applied_at IS NOT NULL OR p.created_at<now()-interval '30 minutes' THEN RAISE EXCEPTION 'Preview expired or already applied. Preview again.'; END IF;
 IF p.pairs IS DISTINCT FROM public.winery_duplicate_candidates(p.region_id) THEN RAISE EXCEPTION 'The list changed. Preview again before applying.'; END IF;
 FOR pair IN SELECT value FROM jsonb_array_elements(p.pairs) WITH ORDINALITY t(value,ord) ORDER BY CASE WHEN value->>'classification'='unique_osm' THEN 0 ELSE 1 END,ord LOOP
  IF pair->>'classification'='manual' THEN CONTINUE; END IF;
  a:=(pair->'winery_a'->>'id')::uuid; b:=(pair->'winery_b'->>'id')::uuid;
  IF pair->>'classification'='unique_osm' THEN
   PERFORM public.merge_unique_osm_duplicate(a,b);
   merges:=merges+1; unique_merges:=unique_merges+1;
   CONTINUE;
  END IF;
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
   IF public.duplicate_filled_count(bw)>public.duplicate_filled_count(aw) OR (public.duplicate_filled_count(bw)=public.duplicate_filled_count(aw) AND public.duplicate_has_source(bw,'datatourisme') AND NOT public.duplicate_has_source(aw,'datatourisme')) THEN kept:=b; removed:=a; END IF;
   PERFORM public.merge_winery_duplicate(kept,removed);
   UPDATE public.winery_merge_history SET mode='automatic' WHERE kept_id=kept AND removed_id=removed AND undone_at IS NULL;
   merges:=merges+1;
  END IF;
 END LOOP;
 UPDATE public.winery_duplicate_previews SET applied_at=now() WHERE id=_preview;
 RETURN jsonb_build_object('merged',merges,'dismissed',dismissals,'unique_osm',unique_merges);
END; $$;
