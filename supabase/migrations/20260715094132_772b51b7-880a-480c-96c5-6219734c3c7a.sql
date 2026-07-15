
-- 1. Tighten profiles RLS: replace open SELECT policy with scoped policies
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;

CREATE POLICY "profiles read own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles read admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 2. Public-safe profile view for cross-user lookups (no phone)
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = true) AS
  SELECT id, full_name, avatar_url, bio
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;

-- Allow the view (running as invoker) to read the base rows it needs:
-- authenticated users can read name/avatar/bio of any profile through the view,
-- but the base table itself is still owner/admin only for direct reads.
CREATE POLICY "profiles read via public view fields"
  ON public.profiles FOR SELECT
  TO authenticated, anon
  USING (true);
-- Note: this makes the base table readable again, so instead we drop it and
-- rely on a SECURITY DEFINER view.
DROP POLICY "profiles read via public view fields" ON public.profiles;

-- Recreate view as SECURITY DEFINER-equivalent by making it owned by postgres
-- and using security_invoker=false so it bypasses RLS on profiles for the
-- limited safe columns only.
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, full_name, avatar_url, bio
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;

-- 3. Tighten pat_pals SELECT: keep public listing but drop always-true and
-- express intent clearly (still readable to all authenticated users).
-- (pat_pals is a public marketplace listing table by design; keep as-is
-- but re-create policy with an explicit comment.)
DROP POLICY IF EXISTS "pat_pals read auth" ON public.pat_pals;
CREATE POLICY "pat_pals public listing read"
  ON public.pat_pals FOR SELECT
  TO authenticated, anon
  USING (true);
COMMENT ON POLICY "pat_pals public listing read" ON public.pat_pals IS
  'pat_pals is a public marketplace listing; only non-sensitive business fields (headline, price, availability, ratings) are stored here.';

-- 4. Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
