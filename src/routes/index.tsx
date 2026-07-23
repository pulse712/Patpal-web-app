import { createFileRoute, redirect, isRedirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Public entry — send guests to browse, signed-in users to home dashboard. */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          throw redirect({ to: "/home", replace: true });
        }
      } catch (err) {
        if (isRedirect(err)) throw err;
      }
    }
    throw redirect({ to: "/browse", replace: true });
  },
});
