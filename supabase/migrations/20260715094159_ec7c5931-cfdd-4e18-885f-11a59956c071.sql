
-- Drop the flagged SECURITY DEFINER view
DROP VIEW IF EXISTS public.public_profiles;

-- Create private contacts table for sensitive fields
CREATE TABLE public.profile_contacts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_contacts TO authenticated;
GRANT ALL ON public.profile_contacts TO service_role;

ALTER TABLE public.profile_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_contacts owner read"
  ON public.profile_contacts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "profile_contacts owner write"
  ON public.profile_contacts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profile_contacts owner update"
  ON public.profile_contacts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Migrate existing phone data
INSERT INTO public.profile_contacts (user_id, phone)
SELECT id, phone FROM public.profiles WHERE phone IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Drop phone from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;

-- Restore an authenticated read policy on profiles now that phone is gone.
-- Profiles now contain only name, avatar, bio — non-sensitive display info.
CREATE POLICY "profiles read authenticated safe fields"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Update handle_new_user to also seed profile_contacts
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profile_contacts (user_id, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_seconds) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'client'))
  ON CONFLICT (user_id, role) DO NOTHING;

  IF COALESCE(NEW.raw_user_meta_data->>'role', 'client') = 'pat_pal' THEN
    INSERT INTO public.pat_pals (user_id, headline)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'bio')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END; $function$;

-- Lock down function execute again after CREATE OR REPLACE
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
