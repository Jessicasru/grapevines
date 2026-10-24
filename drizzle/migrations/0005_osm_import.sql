ALTER TABLE public.wineries ADD COLUMN IF NOT EXISTS phone text;
CREATE INDEX IF NOT EXISTS wineries_sources_gin ON public.wineries USING gin (sources jsonb_path_ops);

CREATE OR REPLACE FUNCTION public.import_osm_wineries(_elements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  rid uuid; g geometry; e jsonb; t jsonb; sid text; lat float8; lng float8;
  addr text; existing uuid; entry jsonb;
  created int := 0; updated int := 0; no_name int := 0; outside int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, boundary INTO rid, g FROM public.regions WHERE name = 'Alsace' LIMIT 1;
  IF rid IS NULL THEN RAISE EXCEPTION 'Alsace region not found'; END IF;
  IF g IS NULL THEN RAISE EXCEPTION 'Upload the Alsace boundary first'; END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(_elements) LOOP
    t := coalesce(e->'tags', '{}'::jsonb);
    IF coalesce(btrim(t->>'name'), '') = '' THEN no_name := no_name + 1; CONTINUE; END IF;
    lat := coalesce((e->>'lat')::float8, (e->'center'->>'lat')::float8);
    lng := coalesce((e->>'lon')::float8, (e->'center'->>'lon')::float8);
    IF lat IS NULL OR lng IS NULL OR NOT ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, g::geography, 2000) THEN
      outside := outside + 1; CONTINUE;
    END IF;
    sid := (e->>'type') || '/' || (e->>'id');
    addr := nullif(concat_ws(', ',
      nullif(concat_ws(' ', t->>'addr:housenumber', t->>'addr:street'), ''),
      nullif(concat_ws(' ', t->>'addr:postcode', t->>'addr:city'), '')), '');
    entry := jsonb_build_object('source', 'osm', 'source_id', sid, 'imported_at', now(), 'tags', t);

    SELECT id INTO existing FROM public.wineries
      WHERE sources @> jsonb_build_array(jsonb_build_object('source', 'osm', 'source_id', sid)) LIMIT 1;
    IF existing IS NOT NULL THEN
      UPDATE public.wineries SET
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
REVOKE ALL ON FUNCTION public.import_osm_wineries(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_osm_wineries(jsonb) TO authenticated;