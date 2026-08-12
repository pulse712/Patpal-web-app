-- Admin user deletion support. deleteUserAccount() calls
-- supabaseAdmin.auth.admin.deleteUser(), which hard-deletes the auth.users
-- row and relies on ON DELETE CASCADE across every table to clean up. Every
-- FK to auth.users(id) already cascades except sessions.initiated_by (added
-- later, in 20260810120000_session_initiated_by.sql, without an explicit
-- ON DELETE clause — defaults to NO ACTION). In practice initiated_by always
-- equals that same row's client_id or pal_id, both of which do cascade, so
-- the row is gone before NO ACTION would ever see a dangling reference —
-- but fixing it explicitly removes any reliance on that reasoning holding
-- for a genuinely irreversible admin action.

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_initiated_by_fkey;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_initiated_by_fkey
    FOREIGN KEY (initiated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
