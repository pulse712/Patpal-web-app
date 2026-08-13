-- Enables realtime UPDATE events on profiles so an already-logged-in user
-- can be redirected immediately when an admin deactivates/bans their
-- account, instead of waiting for their next page load.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
