-- Track who actually initiated a session (client vs. Pat Pal calling back),
-- so the incoming-call UI can tell "a call was started against me" apart
-- from "I'm the one who just started this call" now that both client_id
-- and pal_id can each be the initiator.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES auth.users(id);

-- Backfill: every session before this migration was client-initiated
-- (Pat Pal callback did not exist yet).
UPDATE public.sessions SET initiated_by = client_id WHERE initiated_by IS NULL;

ALTER TABLE public.sessions ALTER COLUMN initiated_by SET NOT NULL;
