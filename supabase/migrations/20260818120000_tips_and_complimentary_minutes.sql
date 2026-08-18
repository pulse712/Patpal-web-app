-- Post-call tips, and a one-time 3 or 5 minute staff gift during a call.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS complimentary_seconds INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.session_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pal_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL CHECK (amount_cents >= 100),
  stripe_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS session_tips_one_per_client
  ON public.session_tips (session_id, client_id);

CREATE INDEX IF NOT EXISTS session_tips_pal_created_idx
  ON public.session_tips (pal_id, created_at DESC);

ALTER TABLE public.session_tips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_tips read own" ON public.session_tips;
CREATE POLICY "session_tips read own"
  ON public.session_tips FOR SELECT TO authenticated
  USING (auth.uid() = client_id OR auth.uid() = pal_id);

GRANT SELECT ON public.session_tips TO authenticated;
GRANT ALL ON public.session_tips TO service_role;

-- Staff (admin / super_admin / team Pal) can add 3 or 5 free minutes once.
CREATE OR REPLACE FUNCTION public.grant_complimentary_minutes(
  p_session_id UUID,
  p_actor_id UUID,
  p_minutes INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_pal UUID;
  v_comp INT;
  v_seconds INT;
  v_allowed BOOLEAN;
BEGIN
  IF p_minutes NOT IN (3, 5) THEN
    RAISE EXCEPTION 'Complimentary add-on must be 3 or 5 minutes';
  END IF;

  SELECT status, pal_id, complimentary_seconds
  INTO v_status, v_pal, v_comp
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Call is not active';
  END IF;

  IF v_comp > 0 THEN
    RAISE EXCEPTION 'Free minutes already added to this call';
  END IF;

  SELECT
    p_actor_id = v_pal
    AND (
      EXISTS (SELECT 1 FROM public.pat_pals p WHERE p.user_id = p_actor_id AND p.is_team = true)
      OR EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = p_actor_id AND r.role IN ('admin', 'super_admin')
      )
    )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Only staff can add free minutes';
  END IF;

  v_seconds := p_minutes * 60;

  UPDATE public.sessions
  SET
    complimentary_seconds = v_seconds,
    remaining_seconds_at_start = remaining_seconds_at_start + v_seconds
  WHERE id = p_session_id;

  RETURN v_seconds;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_complimentary_minutes TO service_role;

-- Do not bill the complimentary minutes.
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
  v_comp       INT;
  v_unlimited  TIMESTAMPTZ;
  v_balance    INT;
  v_seconds    INT;
  v_billable   INT;
  v_cost       INT;
  v_is_staff   BOOLEAN;
BEGIN
  SELECT status, client_id, pal_id, connected_at, remaining_seconds_at_start, price_cents_per_minute, complimentary_seconds
  INTO v_status, v_client, v_pal, v_connected, v_remaining, v_price_cpm, v_comp
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
  v_billable := GREATEST(0, v_seconds - COALESCE(v_comp, 0));
  v_cost := ROUND((v_billable::NUMERIC / 60.0) * v_price_cpm)::INT;

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
      balance_seconds = GREATEST(0, COALESCE(v_balance, 0) - v_billable),
      updated_at      = now()
    WHERE user_id = v_client;

    INSERT INTO public.credit_transactions
      (user_id, kind, seconds_delta, cents_amount, session_id, note)
    VALUES
      (v_client, 'debit', -v_billable, v_cost, p_session_id, p_note);
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
