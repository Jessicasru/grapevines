CREATE TABLE public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text NOT NULL,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  default_zoom double precision NOT NULL DEFAULT 9,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wineries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  photo_url text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  appointment_required boolean NOT NULL DEFAULT false,
  tasting_fee text,
  languages text[] NOT NULL DEFAULT '{}',
  ships_abroad boolean NOT NULL DEFAULT false,
  opening_days text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  winery_id uuid NOT NULL REFERENCES public.wineries(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  note text NOT NULL,
  wines_to_try text,
  verdict text NOT NULL CHECK (verdict IN ('go','skip')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.regions, public.wineries TO anon, authenticated;
GRANT SELECT, INSERT ON public.recommendations TO anon, authenticated;
GRANT ALL ON public.regions, public.wineries, public.recommendations TO service_role;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wineries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read regions" ON public.regions FOR SELECT USING (true);
CREATE POLICY "Public read wineries" ON public.wineries FOR SELECT USING (true);
CREATE POLICY "Public read recs" ON public.recommendations FOR SELECT USING (true);
CREATE POLICY "Public add recs" ON public.recommendations FOR INSERT WITH CHECK (
  length(author_name) BETWEEN 1 AND 80 AND length(note) BETWEEN 1 AND 2000 AND coalesce(length(wines_to_try),0) <= 500
);

WITH r AS (
  INSERT INTO public.regions (name, country, center_lat, center_lng, default_zoom)
  VALUES ('Alsace', 'France', 48.20, 7.35, 8.6) RETURNING id
)
INSERT INTO public.wineries (region_id, name, address, photo_url, latitude, longitude, appointment_required, tasting_fee, languages, ships_abroad, opening_days)
SELECT r.id, v.* FROM r, (VALUES
 ('Domaine Weinbach', '25 Route du Vin, 68240 Kaysersberg', '/images/winery-1.jpg', 48.1442, 7.2575, true, '€25', ARRAY['French','English','German'], true, 'Mon–Sat'),
 ('Domaine Zind-Humbrecht', '4 Route de Colmar, 68230 Turckheim', '/images/winery-2.jpg', 48.0870, 7.2830, true, '€30', ARRAY['French','English'], true, 'Mon–Fri'),
 ('Maison Trimbach', '15 Route de Bergheim, 68150 Ribeauvillé', '/images/winery-3.jpg', 48.1950, 7.3220, false, '€15', ARRAY['French','English','German'], true, 'Mon–Sat'),
 ('Domaine Marcel Deiss', '15 Route du Vin, 68750 Bergheim', '/images/winery-4.jpg', 48.2060, 7.3630, true, '€20', ARRAY['French','English'], false, 'Tue–Sat'),
 ('Hugel & Fils', '3 Rue de la 1ère Armée, 68340 Riquewihr', '/images/winery-1.jpg', 48.1665, 7.2980, false, 'Free', ARRAY['French','English','German','Japanese'], true, 'Daily'),
 ('Domaine Albert Boxler', '78 Rue des Trois Épis, 68230 Niedermorschwihr', '/images/winery-2.jpg', 48.0960, 7.2620, true, '€15', ARRAY['French','German'], false, 'Mon–Sat'),
 ('Domaine Ostertag', '87 Rue Finkwiller, 67680 Epfig', '/images/winery-3.jpg', 48.3590, 7.4650, true, '€20', ARRAY['French','English'], true, 'Mon–Fri'),
 ('Domaine Schoffit', '68 Nonnenholzweg, 68000 Colmar', '/images/winery-4.jpg', 48.0880, 7.3700, false, '€10', ARRAY['French','English','German'], true, 'Mon–Sat'),
 ('Domaine Paul Blanck', '32 Grand''Rue, 68240 Kientzheim', '/images/winery-1.jpg', 48.1380, 7.2880, false, 'Free', ARRAY['French','English','German'], true, 'Daily'),
 ('Domaine Barmès-Buecher', '30 Rue Sainte-Gertrude, 68920 Wettolsheim', '/images/winery-2.jpg', 48.0560, 7.3000, true, '€15', ARRAY['French','English'], false, 'Mon–Sat')
) AS v(name,address,photo_url,latitude,longitude,appointment_required,tasting_fee,languages,ships_abroad,opening_days);