ALTER TABLE public.wineries
  ADD COLUMN IF NOT EXISTS sources jsonb,
  ADD COLUMN IF NOT EXISTS visitable boolean,
  ADD COLUMN IF NOT EXISTS booking_required boolean,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS enrichment_evidence jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_confidence numeric,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;
-- region_id already exists on public.wineries, so it is not re-added.

ALTER TABLE public.wineries
  ADD CONSTRAINT wineries_enrichment_status_check CHECK (enrichment_status IN ('pending', 'done', 'no_website', 'failed')),
  ADD CONSTRAINT wineries_review_status_check CHECK (review_status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT wineries_enrichment_confidence_check CHECK (enrichment_confidence IS NULL OR (enrichment_confidence >= 0 AND enrichment_confidence <= 1));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
-- Only the backend may change the admin flag; users can update their own profile but never this column.
REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
$$;

DROP POLICY "Public read wineries" ON public.wineries;
CREATE POLICY "Public read wineries" ON public.wineries
  FOR SELECT USING (review_status IS DISTINCT FROM 'rejected');
CREATE POLICY "Admins read all wineries" ON public.wineries
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins update wineries" ON public.wineries
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());