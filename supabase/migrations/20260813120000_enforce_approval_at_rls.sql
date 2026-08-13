-- The signup-approval gate was only ever enforced client-side, on the
-- _authenticated layout's React render. pal.$palId.tsx (the Pat Pal profile
-- page with Start chat / Start call) is a top-level route outside that
-- layout, and its handlers only check that a session exists — not approval
-- status. Worse, conversations/sessions/messages are created via direct
-- Supabase client inserts from the browser, bypassing server functions
-- entirely, so a client-side-only fix can't close this: it has to be
-- enforced at the RLS layer to be authoritative regardless of which page or
-- code path the request comes from.

CREATE OR REPLACE FUNCTION public.is_account_usable(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_active AND approval_status = 'approved'
       FROM public.profiles WHERE id = _user_id),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_account_usable(UUID) TO authenticated;

DROP POLICY IF EXISTS "conversations insert" ON public.conversations;
CREATE POLICY "conversations insert" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = client_id
    AND client_id <> pal_id
    AND EXISTS (SELECT 1 FROM public.pat_pals WHERE user_id = pal_id)
    AND public.is_account_usable(auth.uid())
  );

DROP POLICY IF EXISTS "sessions client insert" ON public.sessions;
CREATE POLICY "sessions client insert" ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id AND public.is_account_usable(auth.uid()));

DROP POLICY IF EXISTS "messages insert participants" ON public.messages;
CREATE POLICY "messages insert participants" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_id
                  AND (c.client_id = auth.uid() OR c.pal_id = auth.uid()))
    AND public.is_account_usable(auth.uid())
  );
