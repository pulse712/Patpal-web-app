-- Pals should only show as available after they turn on "Accepting calls"
-- on their dashboard. Admin approve and older migrations set everyone to available.

UPDATE public.pat_pals
SET availability = 'offline', updated_at = now()
WHERE is_team = false
  AND availability IN ('available', 'busy');
