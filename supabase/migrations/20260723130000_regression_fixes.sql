-- Regression fixes for deployments that ran the earlier trial_codes REVOKE

GRANT SELECT ON public.trial_codes TO authenticated;

DROP POLICY IF EXISTS "trial_codes read active" ON public.trial_codes;
DROP POLICY IF EXISTS "trial_codes admin read" ON public.trial_codes;

CREATE POLICY "trial_codes admin read" ON public.trial_codes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Ensure public_profiles view exists for cross-user name/avatar lookups
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, full_name, avatar_url, bio
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;
