ALTER TABLE public.profiles RENAME TO users;
ALTER TABLE public.users RENAME COLUMN id TO auth_id;
CREATE SEQUENCE public.users_id_seq MINVALUE 0 START 0;
ALTER TABLE public.users ADD COLUMN id bigint;
UPDATE public.users u SET id = o.n FROM (SELECT auth_id, row_number() OVER (ORDER BY created_at, auth_id) - 1 AS n FROM public.users) o WHERE o.auth_id = u.auth_id;
SELECT setval('public.users_id_seq', coalesce((SELECT max(id) FROM public.users), 0), (SELECT count(*) > 0 FROM public.users));
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'), ALTER COLUMN id SET NOT NULL, ADD CONSTRAINT users_id_key UNIQUE (id);
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
REVOKE INSERT (id), UPDATE (id) ON public.users FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.users (auth_id, avatar_url) VALUES (NEW.id, NEW.raw_user_meta_data->>'avatar_url') ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT is_admin FROM public.users WHERE auth_id = auth.uid()), false)
$$;