-- ================================================================
-- Auto-create profile, wallet, and contacts for new users
-- Triggered on auth.users INSERT via Supabase Auth hooks
-- ================================================================

-- ── Function: auto-create user records ───────────────────────────
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
  _role      TEXT;
BEGIN
  -- Extract metadata from the new auth user
  _full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  _phone     := NEW.raw_user_meta_data->>'phone';
  _bio       := NEW.raw_user_meta_data->>'bio';
  _role      := COALESCE(NEW.raw_user_meta_data->>'role', 'client');

  -- 1. Create profile
  INSERT INTO public.profiles (id, full_name, bio, created_at, updated_at)
  VALUES (NEW.id, _full_name, _bio, now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- 2. Create wallet with zero balance
  INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
  VALUES (NEW.id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  -- 3. Create profile_contacts if phone was provided
  IF _phone IS NOT NULL AND _phone != '' THEN
    INSERT INTO public.profile_contacts (user_id, phone, updated_at)
    VALUES (NEW.id, _phone, now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 4. Assign default role (client)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 5. If user registered as pat_pal, add that role + create pat_pals record
  IF _role = 'pat_pal' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'pat_pal')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.pat_pals (
      user_id,
      headline,
      availability,
      price_cents_per_minute,
      tier
    )
    VALUES (
      NEW.id,
      COALESCE(_bio, 'Available for support'),
      'offline',
      100, -- $1.00/min default
      'trusted'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger: on auth.users insert ─────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.handle_new_user TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO supabase_auth_admin;
