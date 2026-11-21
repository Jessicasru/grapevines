-- Review flags mark wineries that need a human look. They never change
-- review_status and never hide a winery from the public map.
--
-- Flag codes:
--   not_winery_name     the name suggests a distillery, brewery or similar
--   no_website          no website on record
--   single_source       found in fewer than two sources
--   possible_duplicate  listed as a candidate pair on /admin/duplicates

ALTER TABLE public.wineries ADD COLUMN IF NOT EXISTS review_flags text[] NOT NULL DEFAULT '{}';

-- Whole words only, so surnames such as Brenner, Braun or Regin do not match.
CREATE OR REPLACE FUNCTION public.winery_name_suggests_other_business(_name text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,extensions AS $$
 SELECT lower(unaccent(coalesce(_name,''))) ~ ('\m(' ||
  'distilleries?|distillery|distillateurs?|distillation|destillerie|(schnaps)?brennerei|' ||
  '(micro)?brasseries?|brasseurs?|brewery|breweries|brewing|(haus)?brauerei|' ||
  'bieres?|bier|beers?|' ||
  'spiritueux|spirits?|spirituosen|eaux?[ -]de[ -]vie|liqueurs?|likor|likoer|' ||
  'whisky|whiskey|gin|rhum|rum|vodka|schnaps|' ||
  'cidres?|cidrerie|cider|cidery' ||
  ')\M');
$$;

-- The pair rule below must stay the same as in winery_duplicate_candidates(),
-- so the flag matches the list on /admin/duplicates. That function is
-- admin-only and returns whole rows; this one returns only ids and is internal.
CREATE OR REPLACE FUNCTION public.winery_duplicate_candidate_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
 WITH nearby AS MATERIALIZED(
  SELECT a.id aid, b.id bid, a.name aname, b.name bname, a.website awebsite, b.website bwebsite,
   ST_Distance(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography) distance_metres
  FROM public.wineries a JOIN public.wineries b ON a.id<b.id AND a.region_id=b.region_id JOIN public.regions r ON r.id=a.region_id AND r.name='Alsace'
  WHERE a.merged_into IS NULL AND b.merged_into IS NULL
  AND ((abs(a.latitude-b.latitude)<0.003 AND abs(a.longitude-b.longitude)<0.005 AND ST_DWithin(ST_SetSRID(ST_MakePoint(a.longitude,a.latitude),4326)::geography,ST_SetSRID(ST_MakePoint(b.longitude,b.latitude),4326)::geography,300)) OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=a.id AND x.winery_b=b.id))
  AND NOT EXISTS(SELECT 1 FROM public.winery_duplicate_dismissals d WHERE d.winery_a=a.id AND d.winery_b=b.id)),
 qualified AS(
  SELECT aid, bid FROM nearby p WHERE public.winery_names_match(p.aname,p.bname)
  AND (public.duplicate_distance_qualifies(p.distance_metres,p.awebsite,p.bwebsite) OR EXISTS(SELECT 1 FROM public.winery_duplicate_restorations x WHERE x.winery_a=p.aid AND x.winery_b=p.bid)))
 SELECT aid FROM qualified UNION SELECT bid FROM qualified;
$$;
REVOKE ALL ON FUNCTION public.winery_duplicate_candidate_ids() FROM PUBLIC, anon, authenticated;

-- What the flags should be right now, for every winery that is not merged away.
CREATE OR REPLACE FUNCTION public.winery_review_flags_now() RETURNS TABLE(id uuid, flags text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
 WITH dup AS MATERIALIZED(SELECT d id FROM public.winery_duplicate_candidate_ids() d)
 SELECT w.id, array_remove(ARRAY[
   CASE WHEN public.winery_name_suggests_other_business(w.name) THEN 'not_winery_name' END,
   CASE WHEN btrim(coalesce(w.website,''))='' THEN 'no_website' END,
   CASE WHEN (SELECT count(DISTINCT s->>'source') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.sources)='array' THEN w.sources ELSE '[]'::jsonb END) s)<2 THEN 'single_source' END,
   CASE WHEN EXISTS(SELECT 1 FROM dup WHERE dup.id=w.id) THEN 'possible_duplicate' END
  ], NULL)
 FROM public.wineries w WHERE w.merged_into IS NULL;
$$;
REVOKE ALL ON FUNCTION public.winery_review_flags_now() FROM PUBLIC, anon, authenticated;

-- Recompute and store the flags. Safe to rerun: it only writes rows whose
-- flags changed, and returns how many those were.
CREATE OR REPLACE FUNCTION public.refresh_winery_review_flags() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE changed integer;
BEGIN
 -- Signed-in callers must be admin. A migration has no signed-in user.
 IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 WITH wanted AS (
  SELECT w.id, coalesce(f.flags,'{}') flags FROM public.wineries w LEFT JOIN public.winery_review_flags_now() f ON f.id=w.id)
 UPDATE public.wineries w SET review_flags=wanted.flags FROM wanted
 WHERE wanted.id=w.id AND w.review_flags IS DISTINCT FROM wanted.flags;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_winery_review_flags() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_winery_review_flags() TO authenticated;

-- Approve every pending winery in a region that has no flag. The caller says
-- how many it expects; any other number approves nothing.
CREATE OR REPLACE FUNCTION public.approve_unflagged_wineries(_region uuid, _expected integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE approved integer;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.wineries IN SHARE ROW EXCLUSIVE MODE;
 PERFORM public.refresh_winery_review_flags();
 UPDATE public.wineries SET review_status='approved', last_verified_at=now()
 WHERE region_id=_region AND merged_into IS NULL AND review_status='pending' AND review_flags='{}';
 GET DIAGNOSTICS approved=ROW_COUNT;
 IF approved IS DISTINCT FROM _expected THEN
  RAISE EXCEPTION 'The list changed: % unflagged pending wineries, not %. Nothing was approved. Check the count and try again.', approved, _expected;
 END IF;
 RETURN approved;
END; $$;
REVOKE ALL ON FUNCTION public.approve_unflagged_wineries(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_unflagged_wineries(uuid, integer) TO authenticated;

-- Apply the flags to the wineries already imported.
SELECT public.refresh_winery_review_flags();
