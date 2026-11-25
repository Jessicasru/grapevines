-- Imports, region outlines and duplicate review used to work for Alsace only.
-- Now a winery belongs to the region whose outline is nearest, if that outline is
-- within 2 km. Champagne and Bourgogne come within 1 km of each other, so "nearest"
-- decides which one a winery between them belongs to, whatever the upload order.

-- Measuring 2 km from a large outline for every row made imports six times slower.
-- So each vineyard area of an outline is stored once, widened by 2 km, with an index:
-- a winery inside one of them is within 2 km of the outline. Kept out of the regions
-- table, which every visitor reads.
CREATE TABLE IF NOT EXISTS public.region_areas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  area extensions.geometry(Geometry, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS region_areas_area_gix ON public.region_areas USING gist (area);
CREATE INDEX IF NOT EXISTS region_areas_region_idx ON public.region_areas (region_id);
ALTER TABLE public.region_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.region_areas FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_region_areas(_region_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public, extensions
AS $$
  DELETE FROM public.region_areas WHERE region_id = _region_id;
  INSERT INTO public.region_areas (region_id, area)
    SELECT r.id, ST_Buffer(d.geom::geography, 2000)::geometry
    FROM public.regions r, ST_Dump(r.boundary) d
    WHERE r.id = _region_id AND r.boundary IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.refresh_region_areas(uuid) FROM PUBLIC, anon, authenticated;
SELECT public.refresh_region_areas(id) FROM public.regions WHERE boundary IS NOT NULL;

-- The nearest region within 2 km, or null. Distance is only measured when two regions qualify.
CREATE OR REPLACE FUNCTION public.region_for_point(_lat float8, _lng float8)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH p AS (SELECT ST_SetSRID(ST_MakePoint(_lng, _lat), 4326) AS g),
  near AS (SELECT DISTINCT a.region_id FROM public.region_areas a, p WHERE ST_Intersects(a.area, p.g))
  SELECT n.region_id
  FROM near n JOIN public.regions r ON r.id = n.region_id, p
  ORDER BY CASE WHEN (SELECT count(*) FROM near) > 1 THEN ST_Distance(p.g::geography, r.boundary::geography) END, r.name
  LIMIT 1;
$$;

-- Admin-only: store a region outline, then move every winery whose nearest outline it is.
CREATE OR REPLACE FUNCTION public.set_region_boundary(_region_id uuid, _geojson jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  g geometry;
  n integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF _geojson->>'type' <> 'FeatureCollection' THEN
    RAISE EXCEPTION 'Expected a GeoJSON FeatureCollection';
  END IF;
  SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326))), 3))
    INTO g
    FROM jsonb_array_elements(_geojson->'features') AS f
    WHERE f->'geometry' IS NOT NULL
      AND f->'geometry'->>'type' IN ('Polygon', 'MultiPolygon');
  IF g IS NULL OR ST_IsEmpty(g) THEN
    RAISE EXCEPTION 'No polygon features found';
  END IF;
  UPDATE public.regions SET boundary = g WHERE id = _region_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Region not found'; END IF;
  PERFORM public.refresh_region_areas(_region_id);
  UPDATE public.wineries w SET region_id = _region_id
    WHERE EXISTS (SELECT 1 FROM public.region_areas a WHERE a.region_id = _region_id
                  AND ST_Intersects(a.area, ST_SetSRID(ST_MakePoint(w.longitude, w.latitude), 4326)))
      AND public.region_for_point(w.latitude, w.longitude) = _region_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_osm_wineries(_elements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  rid uuid; e jsonb; t jsonb; sid text; lat float8; lng float8;
  addr text; existing uuid; entry jsonb;
  created int := 0; updated int := 0; no_name int := 0; outside int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.regions WHERE boundary IS NOT NULL) THEN
    RAISE EXCEPTION 'Upload a region boundary first';
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(_elements) LOOP
    t := coalesce(e->'tags', '{}'::jsonb);
    IF coalesce(btrim(t->>'name'), '') = '' THEN no_name := no_name + 1; CONTINUE; END IF;
    lat := coalesce((e->>'lat')::float8, (e->'center'->>'lat')::float8);
    lng := coalesce((e->>'lon')::float8, (e->'center'->>'lon')::float8);
    rid := CASE WHEN lat IS NULL OR lng IS NULL THEN NULL ELSE public.region_for_point(lat, lng) END;
    IF rid IS NULL THEN outside := outside + 1; CONTINUE; END IF;
    sid := (e->>'type') || '/' || (e->>'id');
    addr := nullif(concat_ws(', ',
      nullif(concat_ws(' ', t->>'addr:housenumber', t->>'addr:street'), ''),
      nullif(concat_ws(' ', t->>'addr:postcode', t->>'addr:city'), '')), '');
    entry := jsonb_build_object('source', 'osm', 'source_id', sid, 'imported_at', now(), 'tags', t);

    SELECT id INTO existing FROM public.wineries
      WHERE sources @> jsonb_build_array(jsonb_build_object('source', 'osm', 'source_id', sid)) LIMIT 1;
    IF existing IS NOT NULL THEN
      UPDATE public.wineries SET
        region_id = rid,
        name = left(t->>'name', 120), latitude = lat, longitude = lng,
        website = coalesce(t->>'website', t->>'contact:website'),
        phone = coalesce(t->>'phone', t->>'contact:phone'),
        address = addr, village = t->>'addr:city', opening_hours = t->>'opening_hours',
        sources = coalesce((SELECT jsonb_agg(s) FROM jsonb_array_elements(sources) s
                   WHERE NOT (s->>'source' = 'osm' AND s->>'source_id' = sid)), '[]'::jsonb) || jsonb_build_array(entry)
        WHERE id = existing;
      updated := updated + 1;
    ELSE
      INSERT INTO public.wineries (region_id, name, latitude, longitude, website, phone, address, village, opening_hours,
        sources, review_status, enrichment_status, created_by)
      VALUES (rid, left(t->>'name', 120), lat, lng, coalesce(t->>'website', t->>'contact:website'),
        coalesce(t->>'phone', t->>'contact:phone'), addr, t->>'addr:city', t->>'opening_hours',
        jsonb_build_array(entry), 'pending', 'pending', auth.uid());
      created := created + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', created, 'updated', updated, 'skipped_no_name', no_name, 'skipped_outside', outside);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_csv_wineries(_source text, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
 rid uuid; raw_row jsonb; sid text; lat float8; lng float8;
 existing uuid; entry jsonb; row_name text; row_website text; row_address text; row_description text;
 created int := 0; updated int := 0; outside int := 0;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
 IF _source IS NULL OR _source NOT IN ('datatourisme', 'overture') THEN RAISE EXCEPTION 'Invalid CSV source'; END IF;
 IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'Expected CSV rows'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.regions WHERE boundary IS NOT NULL) THEN RAISE EXCEPTION 'Upload a region boundary first'; END IF;
 -- Serialize CSV imports for a source so concurrent uploads cannot create duplicate identities.
 PERFORM pg_advisory_xact_lock(hashtextextended('csv-wineries:' || _source, 0));
 FOR raw_row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  IF jsonb_typeof(raw_row) <> 'object' THEN RAISE EXCEPTION 'Invalid CSV row'; END IF;
  BEGIN
   lat := nullif(btrim(raw_row->>'latitude'), '')::float8;
   lng := nullif(btrim(raw_row->>'longitude'), '')::float8;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   lat := NULL; lng := NULL;
  END;
  IF lat IS NULL OR lng IS NULL OR NOT (lat BETWEEN -90 AND 90) OR NOT (lng BETWEEN -180 AND 180) THEN
   outside := outside + 1; CONTINUE;
  END IF;
  rid := public.region_for_point(lat, lng);
  IF rid IS NULL THEN outside := outside + 1; CONTINUE; END IF;
  sid := nullif(btrim(raw_row->>'source_id'), '');
  IF sid IS NULL THEN RAISE EXCEPTION 'An in-boundary row has an empty source_id; no rows were imported'; END IF;
  row_name := coalesce(nullif(btrim(raw_row->>'name'), ''), sid);
  row_website := nullif(btrim(raw_row->>'website'), '');
  row_address := nullif(concat_ws(', ', nullif(btrim(raw_row->>'address'), ''),
    nullif(concat_ws(' ', nullif(btrim(raw_row->>'postcode'), ''), nullif(btrim(raw_row->>'locality'), '')), '')), '');
  row_description := nullif(btrim(raw_row->>'description'), '');
  entry := jsonb_build_object('source', _source, 'source_id', sid, 'imported_at', now(), 'raw', raw_row);
  SELECT id INTO existing FROM public.wineries
   WHERE sources @> jsonb_build_array(jsonb_build_object('source', _source, 'source_id', sid)) LIMIT 1;
  IF existing IS NOT NULL THEN
   UPDATE public.wineries SET
    region_id = rid,
    name = CASE WHEN nullif(btrim(raw_row->>'name'), '') IS NULL THEN name ELSE left(row_name, 120) END,
    latitude = lat, longitude = lng,
    website = CASE WHEN nullif(btrim(website), '') IS NULL THEN row_website ELSE website END,
    address = CASE WHEN nullif(btrim(address), '') IS NULL THEN row_address ELSE address END,
    description = CASE WHEN nullif(btrim(description), '') IS NULL THEN row_description ELSE description END,
    village = coalesce(nullif(btrim(raw_row->>'locality'), ''), village),
    sources = coalesce((SELECT jsonb_agg(s) FROM jsonb_array_elements(coalesce(sources, '[]'::jsonb)) s
     WHERE NOT (s @> jsonb_build_object('source', _source, 'source_id', sid))), '[]'::jsonb) || jsonb_build_array(entry)
   WHERE id = existing;
   updated := updated + 1;
  ELSE
   INSERT INTO public.wineries (region_id, name, latitude, longitude, website, address, description, village,
    sources, review_status, enrichment_status, created_by)
   VALUES (rid, left(row_name, 120), lat, lng, row_website, row_address, row_description,
    nullif(btrim(raw_row->>'locality'), ''), jsonb_build_array(entry), 'pending', 'pending', auth.uid());
   created := created + 1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('created', created, 'updated', updated, 'skipped_outside', outside);
END;
$$;

-- Words that say nothing about which winery it is. "champagne" and "bourgogne" start most
-- names in those regions, and "Père et Fils" or "Frères" are common in Bourgogne; without
-- this, neighbours such as "Champagne Ployez" and "Champagne Moutard" would look alike.
CREATE OR REPLACE FUNCTION public.normalized_winery_name(_name text) RETURNS text
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT coalesce(string_agg(word,' ' ORDER BY ord),'') FROM regexp_split_to_table(
 regexp_replace(lower(unaccent(coalesce(_name,''))), '[^a-z0-9]+', ' ', 'g'),'\s+') WITH ORDINALITY t(word,ord)
 WHERE word <> '' AND word <> ALL(ARRAY['domaine','vins','vin','vignoble','vignobles','cave','caves','caveau','maison','alsace','champagne','bourgogne','d','de','du','des','la','le','les','et','pere','fils','fille','filles','freres','famille','earl','scea','gaec','sarl','sas']);
$$;

-- Same as 0017, without the Alsace filter. Pairs still come from one region.
CREATE OR REPLACE FUNCTION public.winery_duplicate_candidates() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE result jsonb; candidates jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH nearby AS MATERIALIZED(SELECT a.id aid,b.id bid,to_jsonb(a) winery_a,to_jsonb(b) winery_b, ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) distance_metres
 FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id
 WHERE a.merged_into IS NULL AND b.merged_into IS NULL
 AND ((abs(a.latitude-b.latitude)<0.003 AND abs(a.longitude-b.longitude)<0.005 AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,300)) OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=a.id AND x.winery_b=b.id))
 AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id)), qualified AS(SELECT p.winery_a,p.winery_b,p.distance_metres FROM nearby p WHERE public.winery_names_match(p.winery_a->>'name',p.winery_b->>'name') AND (public.duplicate_distance_qualifies(p.distance_metres,p.winery_a->>'website',p.winery_b->>'website') OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=p.aid AND x.winery_b=p.bid)))
 SELECT coalesce(jsonb_agg(to_jsonb(qualified) ORDER BY distance_metres,winery_a->>'id',winery_b->>'id'),'[]') INTO candidates FROM qualified;
 SELECT coalesce(jsonb_agg(p||jsonb_build_object('classification',CASE WHEN NOT public.duplicate_distance_qualifies((p->>'distance_metres')::float8,p->'winery_a'->>'website',p->'winery_b'->>'website') THEN 'manual' WHEN public.duplicate_classification(p->'winery_a',p->'winery_b')='different' THEN 'different' WHEN public.duplicate_unique_osm(p,candidates) THEN 'unique_osm' ELSE public.duplicate_classification(p->'winery_a',p->'winery_b') END,'address_a',public.duplicate_address(p->'winery_a'),'address_b',public.duplicate_address(p->'winery_b')) ORDER BY ord),'[]') INTO result FROM jsonb_array_elements(candidates) WITH ORDINALITY t(p,ord);
 RETURN result;
END; $$;

-- Same as 0009, except that both wineries may be in any one region.
CREATE OR REPLACE FUNCTION public.merge_winery_duplicate(_keep uuid,_remove uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE kept public.wineries; removed public.wineries; filled jsonb; merged_sources jsonb; snapshot jsonb;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 IF _keep=_remove THEN RAISE EXCEPTION 'Choose two different wineries'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('duplicate-review',0));
 LOCK TABLE public.wineries,public.recommendations,public.saves IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO kept FROM public.wineries WHERE id=_keep; SELECT * INTO removed FROM public.wineries WHERE id=_remove;
 IF kept.id IS NULL OR removed.id IS NULL OR kept.merged_into IS NOT NULL OR removed.merged_into IS NOT NULL THEN RAISE EXCEPTION 'A winery has changed; refresh the list'; END IF;
 IF kept.region_id<>removed.region_id THEN RAISE EXCEPTION 'Both wineries must belong to the same region'; END IF;
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
