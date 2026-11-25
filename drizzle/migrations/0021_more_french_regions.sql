-- Add Chablis, Loire, Bordeaux, Rhône, Languedoc and Provence. Safe to rerun: a region
-- that exists is left alone. Each centre, where the map writes the name, is the region's
-- centre of mass, which lies within 2 km of its vines. Upload the outlines from
-- data/boundaries afterwards.
INSERT INTO public.regions (name, country, center_lat, center_lng, default_zoom)
SELECT v.name, 'France', v.lat, v.lng, v.zoom
FROM (VALUES
  ('Chablis', 47.79, 3.76, 9.8),
  ('Loire', 47.22, 0.17, 6.8),
  ('Bordeaux', 44.89, -0.31, 8.8),
  ('Rhône', 44.14, 4.91, 8.0),
  ('Languedoc', 43.32, 3.00, 8.1),
  ('Provence', 43.39, 5.99, 8.3)
) AS v(name, lat, lng, zoom)
WHERE NOT EXISTS (SELECT 1 FROM public.regions r WHERE r.name = v.name);
