-- Customers (clients) can sign in without admin approval.
-- Pat Pals stay pending until an admin Approves them on the Pals tab.
-- Approving a Pal (pat_pals.is_approved = true) must also unlock login.

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Anyone who is not a Pat Pal and is still pending can sign in.
UPDATE public.profiles p
SET approval_status = 'approved'
WHERE p.approval_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role = 'pat_pal'
  );

-- Pals already listed/approved in the control panel must be able to sign in.
UPDATE public.profiles p
SET approval_status = 'approved'
FROM public.pat_pals pp
WHERE pp.user_id = p.id
  AND pp.is_approved = true
  AND p.approval_status <> 'approved';

-- ── Signup trigger: clients approved, Pat Pals pending ───────────────────────
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
  _service   TEXT;
  _approval  TEXT;
BEGIN
  BEGIN
    _full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
    _phone     := NEW.raw_user_meta_data->>'phone';
    _bio       := NEW.raw_user_meta_data->>'bio';
    _role      := COALESCE(NEW.raw_user_meta_data->>'role', 'client');
    _category  := NULLIF(TRIM(NEW.raw_user_meta_data->>'category_slug'), '');
    _service   := NULLIF(TRIM(COALESCE(
      NEW.raw_user_meta_data->>'service',
      NEW.raw_user_meta_data->>'headline',
      ''
    )), '');
  EXCEPTION WHEN OTHERS THEN
    _full_name := '';
    _phone     := NULL;
    _bio       := NULL;
    _role      := 'client';
    _category  := NULL;
    _service   := NULL;
  END;

  IF _role NOT IN ('client', 'pat_pal') THEN
    _role := 'client';
  END IF;

  _approval := CASE WHEN _role = 'pat_pal' THEN 'pending' ELSE 'approved' END;

  BEGIN
    INSERT INTO public.profiles (id, full_name, bio, approval_status, created_at, updated_at)
    VALUES (NEW.id, _full_name, _bio, _approval, now(), now())
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
    PERFORM public.set_user_role(NEW.id, _role::public.app_role);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF _role = 'pat_pal' THEN
    BEGIN
      INSERT INTO public.pat_pals (
        user_id,
        headline,
        availability,
        price_cents_per_minute,
        tier,
        category_slugs,
        is_approved
      )
      VALUES (
        NEW.id,
        COALESCE(_service, NULLIF(_bio, ''), 'Available for support'),
        'offline',
        100,
        'trusted',
        CASE
          WHEN _category IS NOT NULL THEN ARRAY[_category]
          ELSE ARRAY[]::TEXT[]
        END,
        false
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
