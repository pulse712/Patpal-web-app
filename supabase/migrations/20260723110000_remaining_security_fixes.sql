-- Remaining security fixes:
-- - Always register new users as client (ignore metadata role)
-- - Remove self-service pat_pals insert
-- - Tighten conversations + ratings RLS
-- - Restrict has_role probing
-- - end_session_billing: actor auth, skip cancelled sessions

-- ── 1. Signup: always client, never auto-promote to pat_pal ──────
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
  _full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  _phone     := NEW.raw_user_meta_data->>'phone';
  _bio       := NEW.raw_user_meta_data->>'bio';

  INSERT INTO public.profiles (id, full_name, bio, created_at, updated_at)
  VALUES (NEW.id, _full_name, _bio, now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
  VALUES (NEW.id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  IF _phone IS NOT NULL AND _phone != '' THEN
    INSERT INTO public.profile_contacts (user_id, phone, updated_at)
    VALUES (NEW.id, _phone, now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 2. pat_pals: no self-registration ────────────────────────────
DROP POLICY IF EXISTS "pat_pals insert own" ON public.pat_pals;

-- ── 3. conversations: pal must exist, no self-chat ─────────────
DROP POLICY IF EXISTS "conversations insert" ON public.conversations;
DROP POLICY IF EXISTS "conversations client insert" ON public.conversations;

CREATE POLICY "conversations insert" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = client_id
    AND client_id <> pal_id
    AND EXISTS (SELECT 1 FROM public.pat_pals WHERE user_id = pal_id)
  );

-- ── 4. ratings: server-only insert (via submitRating service role) ─
DROP POLICY IF EXISTS "ratings insert" ON public.ratings;
DROP POLICY IF EXISTS "ratings_client_insert" ON public.ratings;

-- ── 5. has_role: prevent probing other users' roles ──────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
     )
  THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$$;

-- ── 6. end_session_billing: either participant may finalize ──────
CREATE OR REPLACE FUNCTION public.end_session_billing(
  p_session_id UUID,
  p_actor_id   UUID,
  p_seconds    INT,
  p_cost_cents INT,
  p_note       TEXT
)
RETURNS TABLE(new_balance INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_client UUID;
  v_pal    UUID;
  v_unlimited TIMESTAMPTZ;
  v_balance INT;
BEGIN
  SELECT status, client_id, pal_id
  INTO v_status, v_client, v_pal
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF p_actor_id <> v_client AND p_actor_id <> v_pal THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  IF v_status = 'ended' THEN
    SELECT balance_seconds INTO v_balance FROM public.wallets WHERE user_id = v_client;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    SELECT balance_seconds INTO v_balance FROM public.wallets WHERE user_id = v_client;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT unlimited_until, balance_seconds
  INTO v_unlimited, v_balance
  FROM public.wallets
  WHERE user_id = v_client
  FOR UPDATE;

  IF v_unlimited IS NULL OR v_unlimited <= now() THEN
    UPDATE public.wallets
    SET
      balance_seconds = GREATEST(0, COALESCE(v_balance, 0) - p_seconds),
      updated_at      = now()
    WHERE user_id = v_client;

    INSERT INTO public.credit_transactions
      (user_id, kind, seconds_delta, cents_amount, session_id, note)
    VALUES
      (v_client, 'debit', -p_seconds, p_cost_cents, p_session_id, p_note);
  END IF;

  UPDATE public.sessions
  SET
    status       = 'ended',
    ended_at     = now(),
    seconds_used = p_seconds,
    cost_cents   = p_cost_cents
  WHERE id = p_session_id;

  SELECT balance_seconds INTO v_balance FROM public.wallets WHERE user_id = v_client;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_session_billing TO service_role;
