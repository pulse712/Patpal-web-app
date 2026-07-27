-- Allow signup role selection: client (customer) or pat_pal only.
-- Admin/super_admin cannot be self-assigned via signup metadata.

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
  _category  TEXT;
BEGIN
  BEGIN
    _full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
    _phone     := NEW.raw_user_meta_data->>'phone';
    _bio       := NEW.raw_user_meta_data->>'bio';
    _role      := COALESCE(NEW.raw_user_meta_data->>'role', 'client');
    _category  := NULLIF(TRIM(NEW.raw_user_meta_data->>'category_slug'), '');
  EXCEPTION WHEN OTHERS THEN
    _full_name := '';
    _phone     := NULL;
    _bio       := NULL;
    _role      := 'client';
    _category  := NULL;
  END;

  -- Never allow self-promotion to admin roles via signup metadata.
  IF _role NOT IN ('client', 'pat_pal') THEN
    _role := 'client';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, full_name, bio, created_at, updated_at)
    VALUES (NEW.id, _full_name, _bio, now(), now())
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
    VALUES (NEW.id, 0, now())
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF _phone IS NOT NULL AND _phone != '' THEN
      INSERT INTO public.profile_contacts (user_id, phone, updated_at)
      VALUES (NEW.id, _phone, now())
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'client')
    ON CONFLICT (user_id, role) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF _role = 'pat_pal' THEN
    BEGIN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'pat_pal')
      ON CONFLICT (user_id, role) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      INSERT INTO public.pat_pals (
        user_id,
        headline,
        availability,
        price_cents_per_minute,
        tier,
        category_slugs
      )
      VALUES (
        NEW.id,
        COALESCE(NULLIF(_bio, ''), 'Available for support'),
        'offline',
        100,
        'trusted',
        CASE
          WHEN _category IS NOT NULL THEN ARRAY[_category]
          ELSE ARRAY[]::TEXT[]
        END
      )
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_new_user TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO supabase_auth_admin;
