CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE TABLE public.winery_duplicate_dismissals (
 winery_a uuid NOT NULL REFERENCES public.wineries(id) ON DELETE CASCADE,
 winery_b uuid NOT NULL REFERENCES public.wineries(id) ON DELETE CASCADE,
 dismissed_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(winery_a,winery_b), CHECK(winery_a < winery_b)
);
GRANT SELECT, INSERT ON public.winery_duplicate_dismissals TO authenticated;
GRANT ALL ON public.winery_duplicate_dismissals TO service_role;
ALTER TABLE public.winery_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read dismissed pairs" ON public.winery_duplicate_dismissals FOR SELECT TO authenticated USING(public.is_admin());
CREATE POLICY "Admins dismiss pairs" ON public.winery_duplicate_dismissals FOR INSERT TO authenticated WITH CHECK(public.is_admin());
ALTER TABLE public.recommendations ADD COLUMN merge_preserved boolean NOT NULL DEFAULT false;
-- Preserve conflicting recommendations on merges without changing ordinary one-per-user writes.
DROP INDEX public.recommendations_user_winery;
CREATE UNIQUE INDEX recommendations_user_winery ON public.recommendations(user_id,winery_id) WHERE user_id IS NOT NULL AND NOT merge_preserved;
CREATE OR REPLACE FUNCTION public.normalized_winery_name(_name text) RETURNS text
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT coalesce(string_agg(word,' ' ORDER BY ord),'') FROM regexp_split_to_table(
 regexp_replace(lower(unaccent(coalesce(_name,''))), '[^a-z0-9]+', ' ', 'g'),'\s+') WITH ORDINALITY t(word,ord)
 WHERE word <> '' AND word <> ALL(ARRAY['domaine','vins','vin','vignoble','vignobles','cave','caves','caveau','maison','alsace','d','de','du','des','la','le','les','et','fils','fille','filles','famille','earl','scea','gaec','sarl','sas']);
$$;
CREATE OR REPLACE FUNCTION public.winery_names_match(_a text,_b text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 WITH n AS (SELECT public.normalized_winery_name(_a) a,public.normalized_winery_name(_b) b)
 SELECT similarity(a,b)>0.5 OR EXISTS(SELECT 1 FROM unnest(string_to_array(a,' ')) word WHERE char_length(word)>=3 AND word=ANY(string_to_array(b,' '))) FROM n;
$$;
CREATE OR REPLACE FUNCTION public.winery_duplicate_candidates() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH pairs AS (
 SELECT to_jsonb(a) AS winery_a,to_jsonb(b) AS winery_b,
 ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) AS distance_metres
 FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id
 JOIN public.regions r ON r.id=a.region_id AND r.name='Alsace'
 WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,150)
 AND public.winery_names_match(a.name,b.name)
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id)
 ) SELECT coalesce(jsonb_agg(to_jsonb(pairs) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]'::jsonb) INTO result FROM pairs;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.dismiss_winery_duplicate(_a uuid,_b uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 IF _a=_b THEN RAISE EXCEPTION 'Choose two different wineries'; END IF;
 INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by) VALUES(least(_a,_b),greatest(_a,_b),auth.uid()) ON CONFLICT DO NOTHING;
END; $$;
CREATE OR REPLACE FUNCTION public.merge_winery_duplicate(_keep uuid,_remove uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE kept public.wineries; removed public.wineries; filled jsonb; merged_sources jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 IF _keep=_remove THEN RAISE EXCEPTION 'Choose two different wineries'; END IF;
 PERFORM id FROM public.wineries WHERE id IN(_keep,_remove) ORDER BY id FOR UPDATE;
 SELECT * INTO kept FROM public.wineries WHERE id=_keep;
 SELECT * INTO removed FROM public.wineries WHERE id=_remove;
 IF kept.id IS NULL OR removed.id IS NULL THEN RAISE EXCEPTION 'A winery no longer exists; refresh the list'; END IF;
 IF kept.region_id<>removed.region_id OR NOT EXISTS(SELECT 1 FROM public.regions WHERE id=kept.region_id AND name='Alsace') THEN RAISE EXCEPTION 'Both wineries must belong to Alsace'; END IF;
 SELECT jsonb_object_agg(k.key,CASE WHEN k.value='null'::jsonb OR k.value='[]'::jsonb OR (jsonb_typeof(k.value)='string' AND btrim(k.value#>>'{}')='') THEN coalesce(to_jsonb(removed)->k.key,k.value) ELSE k.value END)
 INTO filled FROM jsonb_each(to_jsonb(kept)) k;
 SELECT coalesce(jsonb_agg(entry),'[]'::jsonb) INTO merged_sources FROM (
 SELECT DISTINCT value entry FROM jsonb_array_elements(coalesce(kept.sources,'[]')||coalesce(removed.sources,'[]'))
 ) entries;
 filled:=filled||jsonb_build_object('sources',merged_sources,'featured',kept.featured OR removed.featured);
 SELECT * INTO kept FROM jsonb_populate_record(NULL::public.wineries,filled);
 UPDATE public.wineries SET address=kept.address,photo_url=kept.photo_url,tasting_fee=kept.tasting_fee,languages=kept.languages,
 opening_days=kept.opening_days,village=kept.village,created_by=kept.created_by,sources=kept.sources,visitable=kept.visitable,
 booking_required=kept.booking_required,opening_hours=kept.opening_hours,website=kept.website,enrichment_evidence=kept.enrichment_evidence,
 enrichment_confidence=kept.enrichment_confidence,last_verified_at=kept.last_verified_at,phone=kept.phone,description=kept.description,featured=kept.featured WHERE id=_keep;
 UPDATE public.recommendations r SET merge_preserved=true WHERE winery_id=_remove AND user_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.recommendations k WHERE k.winery_id=_keep AND k.user_id=r.user_id AND NOT k.merge_preserved);
 UPDATE public.recommendations SET winery_id=_keep WHERE winery_id=_remove;
 INSERT INTO public.saves(user_id,winery_id,status,created_at) SELECT user_id,_keep,status,created_at FROM public.saves WHERE winery_id=_remove
 ON CONFLICT(user_id,winery_id,status) DO UPDATE SET created_at=least(public.saves.created_at,excluded.created_at);
 DELETE FROM public.saves WHERE winery_id=_remove;
 INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by,created_at)
 SELECT least(_keep,CASE WHEN winery_a=_remove THEN winery_b ELSE winery_a END),greatest(_keep,CASE WHEN winery_a=_remove THEN winery_b ELSE winery_a END),dismissed_by,created_at
 FROM public.winery_duplicate_dismissals WHERE (winery_a=_remove OR winery_b=_remove) AND winery_a<>_keep AND winery_b<>_keep ON CONFLICT DO NOTHING;
 DELETE FROM public.wineries WHERE id=_remove;
 RETURN _keep;
END; $$;
REVOKE ALL ON FUNCTION public.winery_duplicate_candidates(),public.dismiss_winery_duplicate(uuid,uuid),public.merge_winery_duplicate(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.winery_duplicate_candidates(),public.dismiss_winery_duplicate(uuid,uuid),public.merge_winery_duplicate(uuid,uuid) TO authenticated;