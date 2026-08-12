-- New-signup approval gate: every new account must be approved by an admin
-- or super_admin before it can use the app. Existing accounts are
-- grandfathered in as approved so this does not lock out anyone already
-- using the product.

ALTER TABLE public.profiles
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- Backfill: every row that existed before this migration ran is grandfathered
-- in as approved. Only rows inserted after this point pick up the 'pending'
-- column default.
UPDATE public.profiles SET approval_status = 'approved';

-- Defense in depth: admins/super_admins are always approved, regardless of
-- how their profile row was created.
UPDATE public.profiles p
SET approval_status = 'approved'
FROM public.user_roles ur
WHERE ur.user_id = p.id
  AND ur.role IN ('admin', 'super_admin')
  AND p.approval_status <> 'approved';

-- Extend the existing self-tamper guard (added for is_active) so a non-admin
-- also cannot approve/un-reject their own signup via a direct client update.
CREATE OR REPLACE FUNCTION public.guard_profiles_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.id
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin')
  THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      NEW.is_active := OLD.is_active;
    END IF;
    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      NEW.approval_status := OLD.approval_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
