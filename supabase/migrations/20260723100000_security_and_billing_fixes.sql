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
