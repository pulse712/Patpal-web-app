import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStaffRole } from "@/hooks/use-staff-role";
import { showLocalNotification } from "@/lib/local-notifications";
import { playMessageChime } from "@/lib/message-chime";

type PalRow = {
  user_id: string;
};

/** Toast / device alert for admins when a new Pat Pal signs up and needs approval. */
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
          table: "pat_pals",
        },
        async (payload) => {
          const row = payload.new as PalRow;
          if (!row.user_id) return;

          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", row.user_id)
            .maybeSingle();
          const name = profile?.full_name?.trim() || "New Pat Pal";
          const title = "New Pat Pal pending approval";
          const preview = `${name} signed up and is waiting for approval.`;
          const url = "/admin";

          playMessageChime();

          if (document.hidden) {
            void showLocalNotification({
              title,
              body: preview,
              url,
              tag: `signup-${row.user_id}`,
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
