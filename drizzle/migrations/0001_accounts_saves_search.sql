CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 60),
  avatar_url text CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 200000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are public" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.wineries ADD COLUMN featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.wineries ADD COLUMN village text;
ALTER TABLE public.wineries ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
UPDATE public.wineries SET featured = true;
GRANT INSERT ON public.wineries TO authenticated;
CREATE POLICY "Signed-in users add wineries" ON public.wineries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND featured = false AND char_length(name) BETWEEN 1 AND 120 AND COALESCE(char_length(village), 0) <= 120);

ALTER TABLE public.recommendations ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.recommendations ALTER COLUMN note SET DEFAULT '';
CREATE UNIQUE INDEX recommendations_user_winery ON public.recommendations (user_id, winery_id) WHERE user_id IS NOT NULL;
DROP POLICY "Public add recs" ON public.recommendations;
GRANT SELECT ON public.recommendations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO authenticated;
GRANT ALL ON public.recommendations TO service_role;
CREATE POLICY "Users add own recs" ON public.recommendations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND verdict IN ('go','skip') AND char_length(author_name) BETWEEN 1 AND 80 AND char_length(note) <= 2000 AND COALESCE(char_length(wines_to_try), 0) <= 500);
CREATE POLICY "Users edit own recs" ON public.recommendations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND verdict IN ('go','skip') AND char_length(note) <= 2000 AND COALESCE(char_length(wines_to_try), 0) <= 500);
CREATE POLICY "Users delete own recs" ON public.recommendations FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.saves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  winery_id uuid NOT NULL REFERENCES public.wineries(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('want_to_visit','been_here')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, winery_id, status)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saves TO authenticated;
GRANT ALL ON public.saves TO service_role;
ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own saves or public been-here" ON public.saves FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR status = 'been_here');
CREATE POLICY "Insert own saves" ON public.saves FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own saves" ON public.saves FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete own saves" ON public.saves FOR DELETE TO authenticated USING (auth.uid() = user_id);