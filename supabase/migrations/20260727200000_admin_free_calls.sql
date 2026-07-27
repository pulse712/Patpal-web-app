-- Admin/super_admin client sessions are free — do not debit their wallets.

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
  v_is_staff   BOOLEAN;
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

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_client
      AND role IN ('admin', 'super_admin')
  )
  INTO v_is_staff;

  IF NOT v_is_staff AND (v_unlimited IS NULL OR v_unlimited <= now()) THEN
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

GRANT EXECUTE ON FUNCTION public.end_session_billing TO service_role;
