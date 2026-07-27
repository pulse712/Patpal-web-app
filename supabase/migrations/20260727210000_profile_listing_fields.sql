-- Extended profile fields for browse listings and profile page editing.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS introduction TEXT,
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.pat_pals
  ADD COLUMN IF NOT EXISTS service_range TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_introduction_length_chk;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_introduction_length_chk
  CHECK (introduction IS NULL OR char_length(introduction) <= 1000);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_languages_count_chk;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_languages_count_chk
  CHECK (cardinality(languages) <= 10);

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, full_name, avatar_url, bio, introduction, languages
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;
