import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";

type StaffRoleState = {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isStaff: boolean;
  loading: boolean;
};

const StaffRoleContext = createContext<StaffRoleState | null>(null);

let cachedUserId: string | null = null;
let cachedIsAdmin = false;
let cachedIsSuperAdmin = false;

function readCache(userId: string | undefined): StaffRoleState {
  if (userId && cachedUserId === userId) {
    return {
      isAdmin: cachedIsAdmin,
      isSuperAdmin: cachedIsSuperAdmin,
      isStaff: cachedIsAdmin || cachedIsSuperAdmin,
      loading: false,
    };
  }

  return {
    isAdmin: false,
    isSuperAdmin: false,
    isStaff: false,
    loading: !!userId,
  };
}

/** Fetches admin role once per session — avoids nav flicker on route changes. */
export function StaffRoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: sessionLoading } = useSession();
  const [state, setState] = useState<StaffRoleState>(() => readCache(user?.id));

  useEffect(() => {
    if (sessionLoading) return;

    if (!user) {
      cachedUserId = null;
      cachedIsAdmin = false;
      cachedIsSuperAdmin = false;
      setState({ isAdmin: false, isSuperAdmin: false, isStaff: false, loading: false });
      return;
    }

    if (cachedUserId === user.id) {
      setState(readCache(user.id));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));

    (async () => {
      const [{ data: admin }, { data: superAdmin }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: user.id, _role: "super_admin" }),
      ]);
      if (cancelled) return;

      cachedUserId = user.id;
      cachedIsAdmin = !!admin;
      cachedIsSuperAdmin = !!superAdmin;

      setState({
        isAdmin: cachedIsAdmin,
        isSuperAdmin: cachedIsSuperAdmin,
        isStaff: cachedIsAdmin || cachedIsSuperAdmin,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, sessionLoading]);

  return <StaffRoleContext.Provider value={state}>{children}</StaffRoleContext.Provider>;
}

export function useStaffRole(): StaffRoleState {
  const ctx = useContext(StaffRoleContext);
  if (!ctx) {
    throw new Error("useStaffRole must be used within StaffRoleProvider");
  }
  return ctx;
}
