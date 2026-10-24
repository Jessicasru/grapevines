CREATE OR REPLACE FUNCTION public.duplicate_address(_w jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,extensions AS $$
DECLARE hn text; street text; addr text; src jsonb;
BEGIN
 FOR src IN SELECT value FROM jsonb_array_elements(coalesce(nullif(_w->'sources','null'::jsonb),'[]'::jsonb)) LOOP
  IF src->>'source'='osm' THEN hn:=coalesce(hn,nullif(btrim(src->'tags'->>'addr:housenumber'),'')); street:=coalesce(street,nullif(btrim(src->'tags'->>'addr:street'),'')); END IF;
 END LOOP;
 addr:=split_part(coalesce(_w->>'address',''),',',1);
 hn:=coalesce(hn,substring(addr from '^\s*([0-9]+[a-zA-Z]?(?:\s*[-–]\s*[0-9]+[a-zA-Z]?)?)'));
 street:=coalesce(street,regexp_replace(addr,'^\s*[0-9]+[a-zA-Z]?(?:\s*[-–]\s*[0-9]+[a-zA-Z]?)?\s*',''));
 RETURN jsonb_build_object('house',regexp_replace(replace(lower(coalesce(hn,'')),'–','-'),'\s+','','g'),'street',public.duplicate_street(street));
END; $$;