-- Add Champagne and Bourgogne. Safe to rerun: a region that exists is left alone.
-- The centre is where the map writes the region name, so it sits on the vineyards:
-- Champagne's centre of mass, and the Côte d'Or for Bourgogne (its centre of mass
-- falls west of every vineyard). Upload the outlines from data/boundaries afterwards.
INSERT INTO public.regions (name, country, center_lat, center_lng, default_zoom)
SELECT v.name, 'France', v.lat, v.lng, v.zoom
FROM (VALUES ('Champagne', 48.84, 4.01, 8.0), ('Bourgogne', 46.98, 4.74, 7.8)) AS v(name, lat, lng, zoom)
WHERE NOT EXISTS (SELECT 1 FROM public.regions r WHERE r.name = v.name);
