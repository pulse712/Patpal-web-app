import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStaffRole } from "@/hooks/use-staff-role";
import { showLocalNotification } from "@/lib/local-notifications";
import { playMessageChime } from "@/lib/message-chime";
import { Button } from "@/components/ui/button";

export type PendingPalAlert = {
  userId: string;
  name: string;
};

const DISMISS_KEY = "dismissed-pal-alerts";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
}

/** Sticky live alert for admins until they tap Review. */
export function useSignupNotifications() {
  const { isStaff } = useStaffRole();
  const [alerts, setAlerts] = useState<PendingPalAlert[]>([]);

  useEffect(() => {
    if (!isStaff) {
      setAlerts([]);
      return;
    }

    let cancelled = false;
    const dismissed = loadDismissed();

    async function hydrate() {
      const { data: pals } = await supabase
        .from("pat_pals")
        .select("user_id")
        .eq("is_approved", false);
      if (cancelled || !pals?.length) return;

      const ids = pals.map((p) => p.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, approval_status")
        .in("id", ids)
        .eq("approval_status", "pending");
      if (cancelled) return;

      setAlerts(
        (profiles ?? [])
          .filter((p) => !dismissed.has(p.id))
          .map((p) => ({
            userId: p.id,
            name: p.full_name?.trim() || "New Pat Pal",
          })),
      );
    }

    void hydrate();

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
          const row = payload.new as { user_id?: string };
          if (!row.user_id) return;
          if (loadDismissed().has(row.user_id)) return;

          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", row.user_id)
            .maybeSingle();
          if (cancelled) return;

          const name = profile?.full_name?.trim() || "New Pat Pal";
          const title = "New Pat Pal pending approval";
          const preview = `${name} signed up and is waiting for approval.`;

          playMessageChime();
          void showLocalNotification({
            title,
            body: preview,
            url: "/admin?tab=pals",
            tag: `signup-${row.user_id}`,
            requireInteraction: true,
          });

          setAlerts((prev) =>
            prev.some((a) => a.userId === row.user_id)
              ? prev
              : [...prev, { userId: row.user_id!, name }],
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [isStaff]);

  function dismissAll() {
    const ids = loadDismissed();
    for (const alert of alerts) ids.add(alert.userId);
    saveDismissed(ids);
    setAlerts([]);
  }

  return { alerts, dismissAll };
}

export function PendingPalAlertBanner({
  alerts,
  onReview,
}: {
  alerts: PendingPalAlert[];
  onReview: () => void;
}) {
  if (alerts.length === 0) return null;

  const title =
    alerts.length === 1
      ? "New Pat Pal pending approval"
      : `${alerts.length} Pat Pals pending approval`;
  const preview =
    alerts.length === 1
      ? `${alerts[0].name} signed up and is waiting for approval.`
      : alerts.map((a) => a.name).join(", ");

  return (
    <div className="fixed inset-x-4 top-3 z-[80] md:inset-x-auto md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2">
      <button
        type="button"
        onClick={onReview}
        className="flex w-full items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left shadow-lg dark:border-amber-700 dark:bg-amber-950"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{preview}</p>
          <p className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
            Tap to review — this stays until you open it.
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" tabIndex={-1}>
          Review
        </Button>
      </button>
    </div>
  );
}
