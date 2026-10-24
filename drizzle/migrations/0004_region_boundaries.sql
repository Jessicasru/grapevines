CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS boundary extensions.geometry(MultiPolygon, 4326);
CREATE INDEX IF NOT EXISTS regions_boundary_gix ON public.regions USING gist (boundary);

-- Admin-only: store a GeoJSON FeatureCollection as the region boundary, then assign nearby wineries.
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
  UPDATE public.wineries w SET region_id = _region_id
    WHERE ST_DWithin(
      ST_SetSRID(ST_MakePoint(w.longitude, w.latitude), 4326)::geography,
      g::geography,
      2000);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.set_region_boundary(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_region_boundary(uuid, jsonb) TO authenticated;

-- Public read of boundaries as GeoJSON for the map.
CREATE OR REPLACE FUNCTION public.region_boundaries()
RETURNS TABLE(id uuid, geojson jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT r.id, ST_AsGeoJSON(r.boundary, 6)::jsonb FROM public.regions r WHERE r.boundary IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.region_boundaries() TO anon, authenticated;