-- Backfill pat_pals for existing admin/super_admin users so they appear in Talk to the Team.
INSERT INTO public.pat_pals (user_id, headline, availability, price_cents_per_minute, tier, is_team)
SELECT DISTINCT ON (ur.user_id)
  ur.user_id,
  COALESCE(NULLIF(TRIM(p.bio), ''), 'Pat My Back team'),
  'offline',
  100,
  'trusted',
  true
FROM public.user_roles ur
JOIN public.profiles p ON p.id = ur.user_id
WHERE ur.role IN ('admin', 'super_admin')
  AND COALESCE(p.is_active, true) = true
ORDER BY ur.user_id, CASE ur.role WHEN 'super_admin' THEN 0 ELSE 1 END
ON CONFLICT (user_id) DO UPDATE
SET is_team = true;
