-- ================================================================
-- PatPal — run AFTER MASTER_MIGRATION.sql (one time)
-- Do NOT run 20260715065810 or other base migrations — they duplicate MASTER.
-- ================================================================

-- ── from 20260723000001_atomic_wallet_ops.sql ──
-- ================================================================
-- Atomic wallet operations
-- Ensures wallet balance and credit_transactions are always in sync
-- by wrapping both writes in a single database transaction.
-- ================================================================

-- ── debit_wallet: called when a session ends ─────────────────────
-- Subtracts seconds from the wallet and inserts a debit transaction.
-- No-ops if the session is already ended (idempotent via session check).
CREATE OR REPLACE FUNCTION public.debit_wallet(
  p_user_id     UUID,
  p_session_id  UUID,
  p_seconds     INT,
  p_cost_cents  INT,
  p_note        TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deduct from wallet (floor at 0)
  UPDATE public.wallets
  SET
    balance_seconds = GREATEST(0, balance_seconds - p_seconds),
    updated_at      = now()
  WHERE user_id = p_user_id;

  -- Record the debit transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, session_id, note)
  VALUES
    (p_user_id, 'debit', -p_seconds, p_cost_cents, p_session_id, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_wallet TO service_role;


-- ── credit_wallet: called after successful Stripe payment ────────
-- Adds seconds to the wallet and inserts a purchase transaction.
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
BEGIN
  -- Upsert wallet (create row if first purchase)
  INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
  VALUES (p_user_id, p_seconds, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance_seconds = public.wallets.balance_seconds + p_seconds,
        updated_at      = now();

  -- Record the purchase transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
  VALUES
    (p_user_id, 'purchase', p_seconds, p_cents_amount, p_stripe_ref, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_wallet TO service_role;


-- ── apply_trial_code: atomically grants trial access ────────────
-- Can grant either unlimited access (until timestamp) or fixed seconds.
CREATE OR REPLACE FUNCTION public.apply_trial_code(
  p_user_id         UUID,
  p_seconds         INT,      -- 0 if unlimited
  p_unlimited_until TIMESTAMPTZ, -- NULL if not unlimited
  p_note            TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_unlimited_until IS NOT NULL THEN
    -- Grant unlimited access until timestamp
    INSERT INTO public.wallets (user_id, unlimited_until, updated_at)
    VALUES (p_user_id, p_unlimited_until, now())
    ON CONFLICT (user_id) DO UPDATE
      SET unlimited_until = p_unlimited_until,
          updated_at      = now();
  ELSE
    -- Grant fixed seconds
    INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
    VALUES (p_user_id, p_seconds, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance_seconds = public.wallets.balance_seconds + p_seconds,
          updated_at      = now();
  END IF;

  -- Record trial transaction
  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, note)
  VALUES
    (p_user_id, 'trial', p_seconds, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_trial_code TO service_role;

-- ── from 20260723100000_security_and_billing_fixes.sql ──
-- Security and billing fixes
-- - Remove direct session INSERT for authenticated users
-- - Idempotent Stripe credits
-- - Atomic end-session billing
-- - Atomic trial redemption guard

-- ── 1. Sessions: only service role may insert ────────────────────
DROP POLICY IF EXISTS "sessions insert" ON public.sessions;
DROP POLICY IF EXISTS "sessions client insert" ON public.sessions;

-- ── 2. Idempotent Stripe credits ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_stripe_ref_unique
  ON public.credit_transactions (stripe_reference)
  WHERE stripe_reference IS NOT NULL;

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
BEGIN
  -- Skip duplicate webhook deliveries
  IF p_stripe_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.credit_transactions WHERE stripe_reference = p_stripe_ref
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
  VALUES (p_user_id, p_seconds, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance_seconds = public.wallets.balance_seconds + p_seconds,
        updated_at      = now();

  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
  VALUES
    (p_user_id, 'purchase', p_seconds, p_cents_amount, p_stripe_ref, p_note);
END;
$$;

-- ── 3. Extend session billing cap after mid-call top-up ──────────
CREATE OR REPLACE FUNCTION public.extend_session_billing_cap(
  p_session_id UUID,
  p_seconds    INT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sessions
  SET remaining_seconds_at_start = remaining_seconds_at_start + p_seconds
  WHERE id = p_session_id
    AND status = 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_session_billing_cap TO service_role;

-- ── 4. Atomic end-session billing ────────────────────────────────
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

  IF v_status IN ('ended', 'cancelled') THEN
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

-- ── 5. Trial code: one redemption per user per code note ─────────
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_trial_note_unique
  ON public.credit_transactions (user_id, note)
  WHERE kind = 'trial';

CREATE OR REPLACE FUNCTION public.apply_trial_code(
  p_user_id         UUID,
  p_seconds         INT,
  p_unlimited_until TIMESTAMPTZ,
  p_note            TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE user_id = p_user_id AND kind = 'trial' AND note = p_note
  ) THEN
    RAISE EXCEPTION 'Trial code already redeemed';
  END IF;

  IF p_unlimited_until IS NOT NULL THEN
    INSERT INTO public.wallets (user_id, unlimited_until, updated_at)
    VALUES (p_user_id, p_unlimited_until, now())
    ON CONFLICT (user_id) DO UPDATE
      SET unlimited_until = p_unlimited_until,
          updated_at      = now();
  ELSE
    INSERT INTO public.wallets (user_id, balance_seconds, updated_at)
    VALUES (p_user_id, p_seconds, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance_seconds = public.wallets.balance_seconds + p_seconds,
          updated_at      = now();
  END IF;

  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, note)
  VALUES
    (p_user_id, 'trial', p_seconds, p_note);
END;
$$;

-- ── from 20260723110000_remaining_security_fixes.sql ──
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

-- ── from 20260723120000_comprehensive_bug_fixes.sql ──
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

-- ── from 20260723130000_regression_fixes.sql ──
-- Regression fixes for deployments that ran the earlier trial_codes REVOKE

GRANT SELECT ON public.trial_codes TO authenticated;

DROP POLICY IF EXISTS "trial_codes read active" ON public.trial_codes;
DROP POLICY IF EXISTS "trial_codes admin read" ON public.trial_codes;

CREATE POLICY "trial_codes admin read" ON public.trial_codes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Ensure public_profiles view exists for cross-user name/avatar lookups
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = false) AS
  SELECT id, full_name, avatar_url, bio
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO authenticated, anon;

-- ── from 20260723140000_refund_wallet.sql ──
CREATE OR REPLACE FUNCTION public.refund_wallet(
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
  v_refund_seconds INT := ABS(p_seconds);
BEGIN
  IF p_stripe_ref IS NULL OR v_refund_seconds <= 0 THEN
    RAISE EXCEPTION 'Invalid refund parameters';
  END IF;

  INSERT INTO public.credit_transactions
    (user_id, kind, seconds_delta, cents_amount, stripe_reference, note)
  VALUES
    (p_user_id, 'refund', -v_refund_seconds, -ABS(p_cents_amount), p_stripe_ref, p_note)
  ON CONFLICT (stripe_reference) WHERE stripe_reference IS NOT NULL DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.wallets
  SET balance_seconds = GREATEST(0, balance_seconds - v_refund_seconds),
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_wallet TO service_role;

