-- Call log: tag how a never-connected session ended, so history can show
-- "Declined" (callee explicitly rejected) separately from "Missed"/"Cancelled"
-- (caller gave up or the callee never answered) instead of lumping both into
-- the generic 'cancelled' status.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS end_reason TEXT
    CHECK (end_reason IS NULL OR end_reason IN ('declined', 'no_answer'));

-- CREATE OR REPLACE only replaces a function when name AND argument types
-- match exactly; adding p_end_reason here changes the signature, so without
-- this drop the old 2-arg version would stick around as a second, ambiguous
-- overload alongside the new 3-arg one.
DROP FUNCTION IF EXISTS public.cancel_session_before_connect(UUID, UUID);

CREATE OR REPLACE FUNCTION public.cancel_session_before_connect(
  p_session_id UUID,
  p_actor_id   UUID,
  p_end_reason TEXT DEFAULT NULL
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
  -- This function is SECURITY DEFINER and, like the rest of this project's
  -- session/billing RPCs, is only meant to be reached through the app's
  -- service-role server functions (which already verify the caller's
  -- identity before building p_actor_id from it) — never called directly by
  -- an authenticated user's own request. auth.uid() is NULL for service-role
  -- calls, so this check is a no-op for the legitimate path and only ever
  -- fires for a direct call impersonating a different participant.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Session not found or access denied';
  END IF;

  IF p_end_reason IS NOT NULL AND p_end_reason NOT IN ('declined', 'no_answer') THEN
    RAISE EXCEPTION 'Invalid end reason';
  END IF;

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
    cost_cents   = 0,
    end_reason   = p_end_reason
  WHERE id = p_session_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_session_before_connect(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_session_before_connect(UUID, UUID, TEXT) TO service_role;
