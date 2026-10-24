CREATE OR REPLACE FUNCTION public.winery_duplicate_candidates() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; candidates jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH pairs AS(SELECT to_jsonb(a) winery_a,to_jsonb(b) winery_b, ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) distance_metres
 FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id JOIN public.regions r ON r.id=a.region_id AND r.name='Alsace'
 WHERE a.merged_into IS NULL AND b.merged_into IS NULL AND public.winery_names_match(a.name,b.name)
 AND (ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,300) OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=a.id AND x.winery_b=b.id))
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id)), qualified AS(SELECT p.* FROM pairs p WHERE public.duplicate_distance_qualifies(p.distance_metres,p.winery_a->>'website',p.winery_b->>'website') OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=(p.winery_a->>'id')::uuid AND x.winery_b=(p.winery_b->>'id')::uuid))
 SELECT coalesce(jsonb_agg(to_jsonb(qualified) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]') INTO candidates FROM qualified;
 SELECT coalesce(jsonb_agg(p||jsonb_build_object('classification',CASE WHEN NOT public.duplicate_distance_qualifies((p->>'distance_metres')::float8,p->'winery_a'->>'website',p->'winery_b'->>'website') THEN 'manual' WHEN public.duplicate_classification(p->'winery_a',p->'winery_b')='different' THEN 'different' WHEN public.duplicate_unique_osm(p,candidates) THEN 'unique_osm' ELSE public.duplicate_classification(p->'winery_a',p->'winery_b') END,'address_a',public.duplicate_address(p->'winery_a'),'address_b',public.duplicate_address(p->'winery_b')) ORDER BY ord),'[]') INTO result FROM jsonb_array_elements(candidates) WITH ORDINALITY t(p,ord);
 RETURN result;
END; $$;