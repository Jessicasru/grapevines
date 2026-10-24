CREATE OR REPLACE FUNCTION public.merge_unique_osm_duplicate(_a uuid,_b uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pairs jsonb; pair jsonb; aw jsonb; bw jsonb; kept uuid; removed uuid; osm_lat float8; osm_lng float8;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 pairs:=public.winery_duplicate_candidates();
 SELECT value INTO pair FROM jsonb_array_elements(pairs) WHERE (value->'winery_a'->>'id')::uuid=least(_a,_b) AND (value->'winery_b'->>'id')::uuid=greatest(_a,_b);
 IF pair IS NULL OR pair->>'classification'<>'unique_osm' THEN RAISE EXCEPTION 'This pair is not a unique OSM match'; END IF;
 aw:=pair->'winery_a'; bw:=pair->'winery_b';
 IF public.duplicate_osm_only(aw) THEN kept:=(bw->>'id')::uuid; removed:=(aw->>'id')::uuid; osm_lat:=(aw->>'latitude')::float8; osm_lng:=(aw->>'longitude')::float8;
 ELSE kept:=(aw->>'id')::uuid; removed:=(bw->>'id')::uuid; osm_lat:=(bw->>'latitude')::float8; osm_lng:=(bw->>'longitude')::float8; END IF;
 PERFORM public.merge_winery_duplicate(kept,removed);
 UPDATE public.wineries SET latitude=osm_lat,longitude=osm_lng WHERE id=kept;
 UPDATE public.winery_merge_history SET mode='unique_osm',after_state=public.duplicate_state(kept,removed) WHERE kept_id=kept AND removed_id=removed AND undone_at IS NULL;
 RETURN kept;
END; $$;
REVOKE ALL ON FUNCTION public.merge_unique_osm_duplicate(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_unique_osm_duplicate(uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.apply_winery_duplicates(_preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.winery_duplicate_previews; pair jsonb; a uuid; b uuid; kept uuid; removed uuid; aw jsonb; bw jsonb; merges integer:=0; dismissals integer:=0; unique_merges integer:=0;
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