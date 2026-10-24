CREATE OR REPLACE FUNCTION public.duplicate_website_domain(_website text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE host text;
BEGIN
 host:=lower(btrim(coalesce(_website,'')));
 IF host='' THEN RETURN NULL; END IF;
 IF host ~ '^[a-z][a-z0-9+.-]*://' AND host !~ '^https?://' THEN RETURN NULL; END IF;
 host:=regexp_replace(host,'^https?://',''); host:=regexp_replace(host,'^//','');
 host:=split_part(split_part(split_part(host,'/',1),'?',1),'#',1);
 IF host LIKE '%@%' THEN RETURN NULL; END IF;
 host:=split_part(host,':',1); host:=regexp_replace(host,'^www\.',''); host:=rtrim(host,'.');
 IF host !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' THEN RETURN NULL; END IF;
 RETURN host;
END; $$;
CREATE OR REPLACE FUNCTION public.duplicate_distance_qualifies(_distance double precision,_website_a text,_website_b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(_distance<=60 OR (_distance<=300 AND public.duplicate_website_domain(_website_a) IS NOT NULL AND public.duplicate_website_domain(_website_a)=public.duplicate_website_domain(_website_b)),false);
$$;
CREATE TABLE public.winery_duplicate_restorations(winery_a uuid NOT NULL REFERENCES public.wineries(id) ON DELETE CASCADE,winery_b uuid NOT NULL REFERENCES public.wineries(id) ON DELETE CASCADE,restored_by uuid,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(winery_a,winery_b),CHECK(winery_a<winery_b));
GRANT SELECT ON public.winery_duplicate_restorations TO authenticated;
GRANT ALL ON public.winery_duplicate_restorations TO service_role;
ALTER TABLE public.winery_duplicate_restorations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read restored pairs" ON public.winery_duplicate_restorations FOR SELECT TO authenticated USING(public.is_admin());
CREATE TABLE public.winery_duplicate_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_key text UNIQUE NOT NULL,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.winery_duplicate_runs TO authenticated;
GRANT ALL ON public.winery_duplicate_runs TO service_role;
ALTER TABLE public.winery_duplicate_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read duplicate runs" ON public.winery_duplicate_runs FOR SELECT TO authenticated USING(public.is_admin());
CREATE OR REPLACE FUNCTION public.duplicate_unique_osm(_pair jsonb,_pairs jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
DECLARE a jsonb:=_pair->'winery_a'; b jsonb:=_pair->'winery_b'; osm jsonb; dt jsonb; others integer;
BEGIN
 IF public.duplicate_osm_only(a) AND public.duplicate_has_source(b,'datatourisme') THEN osm:=a; dt:=b;
 ELSIF public.duplicate_osm_only(b) AND public.duplicate_has_source(a,'datatourisme') THEN osm:=b; dt:=a;
 ELSE RETURN false; END IF;
 IF (_pair->>'distance_metres')::numeric>60 THEN RETURN false; END IF;
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
 WHERE a.merged_into IS NULL AND b.merged_into IS NULL AND public.winery_names_match(a.name,b.name)
 AND (ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,300) OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=a.id AND x.winery_b=b.id))
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id)), qualified AS(SELECT * FROM pairs WHERE public.duplicate_distance_qualifies(distance_metres,winery_a->>'website',winery_b->>'website') OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=(winery_a->>'id')::uuid AND x.winery_b=(winery_b->>'id')::uuid))
 SELECT coalesce(jsonb_agg(to_jsonb(qualified) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]') INTO candidates FROM qualified;
 SELECT coalesce(jsonb_agg(p||jsonb_build_object('classification',CASE WHEN NOT public.duplicate_distance_qualifies((p->>'distance_metres')::float8,p->'winery_a'->>'website',p->'winery_b'->>'website') THEN 'manual' WHEN public.duplicate_classification(p->'winery_a',p->'winery_b')='different' THEN 'different' WHEN public.duplicate_unique_osm(p,candidates) THEN 'unique_osm' ELSE public.duplicate_classification(p->'winery_a',p->'winery_b') END,'address_a',public.duplicate_address(p->'winery_a'),'address_b',public.duplicate_address(p->'winery_b')) ORDER BY ord),'[]') INTO result FROM jsonb_array_elements(candidates) WITH ORDINALITY t(p,ord);
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.restore_winery_duplicate(_a uuid,_b uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE why text;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 SELECT reason INTO why FROM public.winery_duplicate_dismissals WHERE winery_a=least(_a,_b) AND winery_b=greatest(_a,_b);
 IF why='more than 60 m apart' THEN INSERT INTO public.winery_duplicate_restorations(winery_a,winery_b,restored_by) VALUES(least(_a,_b),greatest(_a,_b),auth.uid()) ON CONFLICT DO NOTHING; END IF;
 DELETE FROM public.winery_duplicate_dismissals WHERE winery_a=least(_a,_b) AND winery_b=greatest(_a,_b);
END; $$;
CREATE OR REPLACE FUNCTION public.apply_duplicate_distance_update(_old_preview uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_preview public.winery_duplicate_previews; pair jsonb; outcome jsonb; pending jsonb; preview_id uuid; distance_dismissed integer:=0; auto_dismissed integer:=0; merges integer:=0; remaining integer; summary jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT r.summary INTO summary FROM public.winery_duplicate_runs r WHERE run_key='distance-60m-domain-300m';
 IF summary IS NOT NULL THEN RETURN summary; END IF;
 SELECT * INTO old_preview FROM public.winery_duplicate_previews WHERE id=_old_preview AND user_id=auth.uid();
 IF old_preview.id IS NULL THEN RAISE EXCEPTION 'Original pending list not found'; END IF;
 FOR pair IN SELECT value FROM jsonb_array_elements(old_preview.pairs) LOOP
  IF public.duplicate_distance_qualifies((pair->>'distance_metres')::float8,pair->'winery_a'->>'website',pair->'winery_b'->>'website') THEN CONTINUE; END IF;
  INSERT INTO public.winery_duplicate_dismissals(winery_a,winery_b,dismissed_by,reason)
  SELECT least(a.id,b.id),greatest(a.id,b.id),auth.uid(),'more than 60 m apart' FROM public.wineries a JOIN public.wineries b ON b.id=(pair->'winery_b'->>'id')::uuid WHERE a.id=(pair->'winery_a'->>'id')::uuid AND a.merged_into IS NULL AND b.merged_into IS NULL ON CONFLICT DO NOTHING;
  IF FOUND THEN distance_dismissed:=distance_dismissed+1; END IF;
 END LOOP;
 LOOP
  pending:=public.winery_duplicate_candidates();
  EXIT WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pending) p WHERE p->>'classification'<>'manual');
  INSERT INTO public.winery_duplicate_previews(user_id,pairs) VALUES(auth.uid(),pending) RETURNING id INTO preview_id;
  outcome:=public.apply_winery_duplicates(preview_id);
  auto_dismissed:=auto_dismissed+coalesce((outcome->>'dismissed')::integer,0); merges:=merges+coalesce((outcome->>'merged')::integer,0);
  EXIT WHEN coalesce((outcome->>'dismissed')::integer,0)+coalesce((outcome->>'merged')::integer,0)=0;
 END LOOP;
 SELECT count(*) INTO remaining FROM jsonb_array_elements(public.winery_duplicate_candidates()) p WHERE p->>'classification'='manual';
 summary:=jsonb_build_object('dismissed',distance_dismissed+auto_dismissed,'distance_dismissed',distance_dismissed,'automatic_dismissed',auto_dismissed,'merged',merges,'manual_remaining',remaining);
 INSERT INTO public.winery_duplicate_runs(run_key,summary) VALUES('distance-60m-domain-300m',summary);
 RETURN summary;
END; $$;
REVOKE ALL ON FUNCTION public.apply_duplicate_distance_update(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_duplicate_distance_update(uuid) TO authenticated,service_role;