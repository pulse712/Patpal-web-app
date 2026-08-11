-- cancel_session_before_connect() deliberately refuses to touch a session
-- once connected_at is set (raises 'Cannot cancel: call already connected'),
-- so a call that connects and then never gets a proper hang-up signal from
-- either client (app killed by iOS, crash, force-quit) is left with
-- status='active' forever — blocking that client from starting any future
-- call ("You already have an active call. End it before starting another.")
-- with no way to self-recover.
--
-- This RPC is the connected-session counterpart: it releases the stuck slot.
-- We deliberately do NOT attempt to bill for the unknown actual elapsed
-- usage — neither party's client survived to report a real end time, so
-- guessing a duration risks overcharging, which is worse than undercharging
-- in this already-rare edge case. seconds_used/cost_cents stay at whatever
-- was already recorded (0, since end_session_billing never ran for this row).
CREATE OR REPLACE FUNCTION public.cancel_abandoned_connected_session(
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

  IF v_connected IS NULL THEN
    RAISE EXCEPTION 'Session was never connected — use cancel_session_before_connect instead';
  END IF;

  UPDATE public.sessions
  SET status = 'ended', ended_at = now()
  WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_abandoned_connected_session TO service_role;
