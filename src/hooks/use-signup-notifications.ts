import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStaffRole } from "@/hooks/use-staff-role";
import { showLocalNotification } from "@/lib/local-notifications";
import { playMessageChime } from "@/lib/message-chime";

type ProfileRow = {
  id: string;
  full_name: string | null;
};

/** Live alert for admins/super_admins when a new signup needs approval. */
export function useSignupNotifications() {
  const { isStaff } = useStaffRole();

  useEffect(() => {
    if (!isStaff) return;

    const channel = supabase
      .channel("signup-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "profiles",
          // Only newly-pending signups — excludes the rare self-heal insert
          // (ensureMyProfile), which explicitly sets approval_status to
          // "approved" rather than leaving it at the column default.
          filter: "approval_status=eq.pending",
        },
        (payload) => {
          const row = payload.new as ProfileRow;
          const name = row.full_name?.trim() || "New user";
          const title = "New signup pending approval";
          const preview = `${name} is waiting for approval.`;
          const url = "/admin";

          playMessageChime();

          if (document.hidden) {
            void showLocalNotification({
              title,
              body: preview,
              url,
              tag: `signup-${row.id}`,
            });
            return;
          }

          toast.message(title, {
            description: preview,
            action: {
              label: "Review",
              onClick: () => {
                window.location.href = url;
              },
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isStaff]);
}
