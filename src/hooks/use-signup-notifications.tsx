import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useStaffRole } from "@/hooks/use-staff-role";
import { useSession } from "@/lib/session";
import { showLocalNotification } from "@/lib/local-notifications";
import { playMessageChime } from "@/lib/message-chime";

export type PendingPalAlert = {
  userId: string;
  name: string;
};

function seenKey(adminId: string) {
  return `pal-alerts-seen:${adminId}`;
}

function loadSeen(adminId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(seenKey(adminId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(adminId: string, ids: Set<string>) {
  localStorage.setItem(seenKey(adminId), JSON.stringify([...ids]));
}

/** Sticky live alert: shown on admin login until they tap Review. */
export function useSignupNotifications() {
  const { isStaff, loading: staffLoading } = useStaffRole();
  const { user } = useSession();
  const [alerts, setAlerts] = useState<PendingPalAlert[]>([]);
  const dismissedRef = useRef(new Set<string>());
  const lastHydratedUser = useRef<string | null>(null);

  useEffect(() => {
    dismissedRef.current = user?.id ? loadSeen(user.id) : new Set();
    lastHydratedUser.current = null;
    setAlerts([]);
  }, [user?.id]);

  useEffect(() => {
    if (staffLoading) return;
    if (!isStaff || !user?.id) {
      setAlerts([]);
      return;
    }

    let cancelled = false;
    const adminId = user.id;

    async function hydrate() {
      try {
        const { listPendingPatPals } = await import("@/lib/admin.functions");
        const { pals } = await listPendingPatPals();
        if (cancelled) return;
        const pendingIds = new Set(pals.map((p) => p.userId));
        for (const id of [...dismissedRef.current]) {
          if (!pendingIds.has(id)) dismissedRef.current.delete(id);
        }
        saveSeen(adminId, dismissedRef.current);
        const unseen = pals.filter((p) => !dismissedRef.current.has(p.userId));
        setAlerts(unseen);
        const isFreshLogin = lastHydratedUser.current !== adminId;
        lastHydratedUser.current = adminId;
        if (unseen.length > 0 && isFreshLogin) {
          playMessageChime();
          if (document.hidden) {
            const first = unseen[0];
            void showLocalNotification({
              title:
                unseen.length === 1
                  ? "New Pat Pal pending approval"
                  : `${unseen.length} Pat Pals pending approval`,
              body:
                unseen.length === 1
                  ? `${first.name} signed up and is waiting for approval.`
                  : unseen.map((a) => a.name).join(", "),
              url: "/admin?tab=pals",
              tag: "signup-pending",
              requireInteraction: true,
            });
          }
        }
      } catch (err) {
        console.warn("[signup-alert] hydrate failed:", err);
      }
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
          if (dismissedRef.current.has(row.user_id)) return;

          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", row.user_id)
            .maybeSingle();
          if (cancelled) return;

          const name = profile?.full_name?.trim() || "New Pat Pal";
          playMessageChime();
          void showLocalNotification({
            title: "New Pat Pal pending approval",
            body: `${name} signed up and is waiting for approval.`,
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
  }, [isStaff, staffLoading, user?.id]);

  function dismissAll() {
    for (const alert of alerts) dismissedRef.current.add(alert.userId);
    if (user?.id) saveSeen(user.id, dismissedRef.current);
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (alerts.length === 0 || pathname === "/admin") return null;

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
        <span className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          Review
        </span>
      </button>
    </div>
  );
}
