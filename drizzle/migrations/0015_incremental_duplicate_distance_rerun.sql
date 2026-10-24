CREATE OR REPLACE FUNCTION public.apply_duplicate_distance_update(_old_preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_preview public.winery_duplicate_previews; pair jsonb; pending jsonb; a uuid; b uuid; kept uuid; removed uuid; distance_dismissed integer:=0; auto_dismissed integer:=0; merges integer:=0; remaining integer; summary jsonb; complete boolean;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT r.summary INTO summary FROM public.winery_duplicate_runs r WHERE run_key='distance-60m-domain-300m' FOR UPDATE;
 IF summary IS NOT NULL THEN
  IF coalesce((summary->>'complete')::boolean,false) THEN RETURN summary; END IF;
  distance_dismissed:=(summary->>'distance_dismissed')::integer; auto_dismissed:=(summary->>'automatic_dismissed')::integer; merges:=(summary->>'merged')::integer;
 ELSE
  SELECT * INTO old_preview FROM public.winery_duplicate_previews WHERE id=_old_preview AND user_id=auth.uid();
  IF old_preview.id IS NULL THEN RAISE EXCEPTION 'Original pending list not found'; END IF;
  FOR pair IN SELECT value FROM jsonb_array_elements(old_preview.pairs) LOOP
   IF public.duplicate_distance_qualifies((pair->>'distance_metres')::float8,pair->'winery_a'->>'website',pair->'winery_b'->>'website') THEN CONTINUE; END IF;
   INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by,reason)
   SELECT least(a.id,b.id),greatest(a.id,b.id),auth.uid(),'more than 60 m apart' FROM public.wineries a JOIN public.wineries b ON b.id=(pair->'winery_b'->>'id')::uuid WHERE a.id=(pair->'winery_a'->>'id')::uuid AND a.merged_into IS NULL AND b.merged_into IS NULL ON CONFLICT DO NOTHING;
   IF FOUND THEN distance_dismissed:=distance_dismissed+1; END IF;
  END LOOP;
 END IF;
 pending:=public.winery_duplicate_candidates();
 SELECT value INTO pair FROM jsonb_array_elements(pending) WITH ORDINALITY t(value,ord) WHERE value->>'classification'<>'manual' ORDER BY CASE WHEN value->>'classification'='unique_osm' THEN 0 ELSE 1 END,ord LIMIT 1;
 IF pair IS NOT NULL THEN
  a:=(pair->'winery_a'->>'id')::uuid; b:=(pair->'winery_b'->>'id')::uuid;
  IF pair->>'classification'='different' THEN
   INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by,reason) VALUES(least(a,b),greatest(a,b),auth.uid(),'different house number') ON CONFLICT DO NOTHING;
   IF FOUND THEN auto_dismissed:=auto_dismissed+1; END IF;
  ELSIF pair->>'classification'='unique_osm' THEN PERFORM public.merge_unique_osm_duplicate(a,b); merges:=merges+1;
  ELSE
   kept:=a; removed:=b;
   IF public.duplicate_filled_count(pair->'winery_b')>public.duplicate_filled_count(pair->'winery_a') OR (public.duplicate_filled_count(pair->'winery_b')=public.duplicate_filled_count(pair->'winery_a') AND public.duplicate_has_source(pair->'winery_b','datatourisme') AND NOT public.duplicate_has_source(pair->'winery_a','datatourisme')) THEN kept:=b; removed:=a; END IF;
   PERFORM public.merge_winery_duplicate(kept,removed);
   UPDATE public.winery_merge_history SET mode='automatic' WHERE kept_id=kept AND removed_id=removed AND undone_at IS NULL;
   merges:=merges+1;
  END IF;
 END IF;
 pending:=public.winery_duplicate_candidates();
 SELECT count(*) INTO remaining FROM jsonb_array_elements(pending) p WHERE p->>'classification'='manual';
 complete:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pending) p WHERE p->>'classification'<>'manual');
 summary:=jsonb_build_object('dismissed',distance_dismissed+auto_dismissed,'distance_dismissed',distance_dismissed,'automatic_dismissed',auto_dismissed,'merged',merges,'manual_remaining',remaining,'complete',complete);
 INSERT INTO public.winery_duplicate_runs(run_key,summary) VALUES('distance-60m-domain-300m',summary) ON CONFLICT(run_key) DO UPDATE SET summary=excluded.summary;
 RETURN summary;
END; $$;