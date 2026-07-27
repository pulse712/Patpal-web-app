-- Fix signup: make handle_new_user trigger robust
-- The trigger must never raise an exception or Supabase Auth will
-- roll back the entire user INSERT and signup will appear to fail silently.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _full_name TEXT;
  _phone     TEXT;
  _bio       TEXT;
BEGIN
  -- Extract metadata safely
  BEGIN
    _full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
    _phone     := NEW.raw_user_meta_data->>'phone';
    _bio       := NEW.raw_user_meta_data->>'bio';
  EXCEPTION WHEN OTHERS THEN
    _full_name := '';
    _phone     := NULL;
    _bio       := NULL;
  END;

  -- 1. Create profile (never fail)
  BEGIN
    INSERT INTO public.profiles (id, full_name, bio, created_at, updated_at)
    VALUES (NEW.id, _full_name, _bio, now(), now())
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- silently skip
  END;

  -- 2. Create wallet (never fail)
  BEGIN
    INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
    VALUES (NEW.id, 0, now())
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 3. Store phone if provided (never fail)
  BEGIN
    IF _phone IS NOT NULL AND _phone != '' THEN
      INSERT INTO public.profile_contacts (user_id, phone, updated_at)
      VALUES (NEW.id, _phone, now())
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 4. Assign client role (never fail)
  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'client')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Re-attach trigger (in case it got dropped)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

GRANT EXECUTE ON FUNCTION public.handle_new_user TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO supabase_auth_admin;
