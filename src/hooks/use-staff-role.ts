import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";

/** True when the signed-in user is admin or super_admin. */
export function useStaffRole() {
  const { user, loading: sessionLoading } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;

    if (!user) {
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const [{ data: admin }, { data: superAdmin }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: user.id, _role: "super_admin" }),
      ]);
      if (cancelled) return;
      setIsAdmin(!!admin);
      setIsSuperAdmin(!!superAdmin);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, sessionLoading]);

  const isStaff = isAdmin || isSuperAdmin;

  return { isAdmin, isSuperAdmin, isStaff, loading };
}
