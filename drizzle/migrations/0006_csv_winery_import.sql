ALTER TABLE public.wineries ADD COLUMN IF NOT EXISTS description text;

CREATE OR REPLACE FUNCTION public.import_csv_wineries(_source text, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
 rid uuid; boundary_geom geometry; raw_row jsonb; sid text; lat float8; lng float8;
 existing uuid; entry jsonb; row_name text; row_website text; row_address text; row_description text;
 created int := 0; updated int := 0; outside int := 0;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
 IF _source IS NULL OR _source NOT IN ('datatourisme', 'overture') THEN RAISE EXCEPTION 'Invalid CSV source'; END IF;
 IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'Expected CSV rows'; END IF;
 SELECT id, boundary INTO rid, boundary_geom FROM public.regions WHERE name = 'Alsace' LIMIT 1;
 IF rid IS NULL THEN RAISE EXCEPTION 'Alsace region not found'; END IF;
 IF boundary_geom IS NULL THEN RAISE EXCEPTION 'Upload the Alsace boundary first'; END IF;
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
  IF NOT ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, boundary_geom::geography, 2000) THEN
   outside := outside + 1; CONTINUE;
  END IF;
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
REVOKE ALL ON FUNCTION public.import_csv_wineries(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_csv_wineries(text, jsonb) TO authenticated;