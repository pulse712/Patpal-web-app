-- Comprehensive bug fixes: billing bypass, RLS hardening, session lifecycle

-- ── 1. Session lifecycle: connected_at + one active session per client ────────
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_client
  ON public.sessions (client_id)
  WHERE status = 'active';

REVOKE UPDATE ON public.sessions FROM authenticated;

-- Mark call as connected (billing starts from this timestamp)
CREATE OR REPLACE FUNCTION public.mark_session_connected(
  p_session_id UUID,
  p_actor_id   UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client UUID;
  v_pal    UUID;
  v_status TEXT;
BEGIN
  SELECT client_id, pal_id, status
  INTO v_client, v_pal, v_status
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF p_actor_id <> v_client AND p_actor_id <> v_pal THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  IF v_status <> 'active' THEN
    RETURN;
  END IF;

  UPDATE public.sessions
  SET connected_at = now()
  WHERE id = p_session_id
    AND connected_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_session_connected TO service_role;

-- Cancel only before media connects
CREATE OR REPLACE FUNCTION public.cancel_session_before_connect(
  p_session_id UUID,
  p_actor_id   UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status    TEXT;
  v_client    UUID;
  v_pal       UUID;
  v_connected TIMESTAMPTZ;
BEGIN
  SELECT status, client_id, pal_id, connected_at
  INTO v_status, v_client, v_pal, v_connected
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF p_actor_id <> v_client AND p_actor_id <> v_pal THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  IF v_status <> 'active' THEN
    RETURN;
  END IF;

  IF v_connected IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot cancel: call already connected';
  END IF;

  UPDATE public.sessions
  SET
    status       = 'cancelled',
    ended_at     = now(),
    seconds_used = 0,
    cost_cents   = 0
  WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_session_before_connect TO service_role;

-- ── 2. end_session_billing: bill from connected_at only ───────────────────────
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
  v_status     TEXT;
  v_client     UUID;
  v_pal        UUID;
  v_connected  TIMESTAMPTZ;
  v_remaining  INT;
  v_price_cpm  INT;
  v_unlimited  TIMESTAMPTZ;
  v_balance    INT;
  v_seconds    INT;
  v_cost       INT;
BEGIN
  SELECT status, client_id, pal_id, connected_at, remaining_seconds_at_start, price_cents_per_minute
  INTO v_status, v_client, v_pal, v_connected, v_remaining, v_price_cpm
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF p_actor_id <> v_client AND p_actor_id <> v_pal THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  IF v_status IN ('ended', 'cancelled') THEN
    SELECT balance_seconds INTO v_balance FROM public.wallets WHERE user_id = v_client;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_connected IS NULL THEN
    UPDATE public.sessions
    SET status = 'cancelled', ended_at = now(), seconds_used = 0, cost_cents = 0
    WHERE id = p_session_id;

    SELECT balance_seconds INTO v_balance FROM public.wallets WHERE user_id = v_client;
    new_balance := COALESCE(v_balance, 0);
    RETURN NEXT;
    RETURN;
  END IF;

  v_seconds := LEAST(
    GREATEST(0, EXTRACT(EPOCH FROM (now() - v_connected))::INT),
    COALESCE(v_remaining, 0)
  );
  v_cost := ROUND((v_seconds::NUMERIC / 60.0) * v_price_cpm)::INT;

  SELECT unlimited_until, balance_seconds
  INTO v_unlimited, v_balance
  FROM public.wallets
  WHERE user_id = v_client
  FOR UPDATE;

  IF v_unlimited IS NULL OR v_unlimited <= now() THEN
    UPDATE public.wallets
    SET
      balance_seconds = GREATEST(0, COALESCE(v_balance, 0) - v_seconds),
      updated_at      = now()
    WHERE user_id = v_client;

    INSERT INTO public.credit_transactions
      (user_id, kind, seconds_delta, cents_amount, session_id, note)
    VALUES
      (v_client, 'debit', -v_seconds, v_cost, p_session_id, p_note);
  END IF;

  UPDATE public.sessions
  SET
    status       = 'ended',
    ended_at     = now(),
    seconds_used = v_seconds,
    cost_cents   = v_cost
  WHERE id = p_session_id;

  SELECT balance_seconds INTO v_balance FROM public.wallets WHERE user_id = v_client;
  new_balance := COALESCE(v_balance, 0);
  RETURN NEXT;
END;
$$;

-- ── 3. credit_wallet: race-safe idempotency ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id        UUID,
  p_seconds        INT,
  p_cents_amount   INT,
  p_stripe_ref     TEXT,
  p_note           TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted UUID;
BEGIN
  IF p_stripe_ref IS NOT NULL THEN
    INSERT INTO public.credit_transactions
      (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
    VALUES
      (p_user_id, 'purchase', p_seconds, p_cents_amount, p_stripe_ref, p_note)
    ON CONFLICT (stripe_reference) WHERE stripe_reference IS NOT NULL DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NULL THEN
      RETURN;
    END IF;
  ELSE
    INSERT INTO public.credit_transactions
      (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
    VALUES
      (p_user_id, 'purchase', p_seconds, p_cents_amount, NULL, p_note);
  END IF;

  INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
  VALUES (p_user_id, p_seconds, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance_seconds = public.wallets.balance_seconds + p_seconds,
        updated_at      = now();
END;
$$;

-- ── 4. user_roles: no client-side writes (admin API uses service role) ──────
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
DROP POLICY IF EXISTS "user_roles admin manage" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles admin write" ON public.user_roles;

-- ── 5. trial_codes: admin-only read (no client enumeration) ─────────────────
DROP POLICY IF EXISTS "trial_codes read active" ON public.trial_codes;
DROP POLICY IF EXISTS "trial_codes admin read" ON public.trial_codes;
CREATE POLICY "trial_codes admin read" ON public.trial_codes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- ── 6. profiles: users cannot self-reactivate ───────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_profiles_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.id
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin')
     AND NEW.is_active IS DISTINCT FROM OLD.is_active
  THEN
    NEW.is_active := OLD.is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_update_trigger ON public.profiles;
CREATE TRIGGER guard_profiles_update_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_update();

-- ── 7. pat_pals: protect ratings / tier from self-tampering ───────────────────
CREATE OR REPLACE FUNCTION public.guard_pat_pals_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.user_id
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin')
  THEN
    IF NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
       OR NEW.rating_count IS DISTINCT FROM OLD.rating_count
       OR NEW.tier IS DISTINCT FROM OLD.tier
       OR NEW.is_team IS DISTINCT FROM OLD.is_team
    THEN
      RAISE EXCEPTION 'Cannot modify protected pat_pal fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_pat_pals_update_trigger ON public.pat_pals;
CREATE TRIGGER guard_pat_pals_update_trigger
  BEFORE UPDATE ON public.pat_pals
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_pat_pals_update();

-- ── 8. Drop overly permissive profile read policies (use public_profiles view) ─
DROP POLICY IF EXISTS "profiles read authenticated safe fields" ON public.profiles;
DROP POLICY IF EXISTS "profiles read authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
