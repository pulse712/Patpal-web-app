import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStaffRole } from "@/hooks/use-staff-role";

const POLL_MS = 30_000;

/** Count of signups awaiting admin approval — drives the red-dot on staff nav entry points. */
export function usePendingSignupCount(): number {
  const { isStaff } = useStaffRole();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isStaff) {
      setCount(0);
      return;
    }

    let cancelled = false;

    async function poll() {
      const { count: c, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending");
      if (cancelled) return;
      // Migration not applied yet, or any other error — show nothing rather
      // than a misleading count.
      setCount(error ? 0 : (c ?? 0));
    }

    void poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isStaff]);

  return count;
}
