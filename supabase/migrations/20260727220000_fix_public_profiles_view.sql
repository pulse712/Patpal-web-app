-- Keep public_profiles in sync with profile listing fields (browse + pal pages).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS introduction TEXT,
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.pat_pals
  ADD COLUMN IF NOT EXISTS service_range TEXT;

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, full_name, avatar_url, bio, introduction, languages
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;
