import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMessageNotifications } from "@/hooks/use-message-notifications";
import { useSignupNotifications, PendingPalAlertBanner } from "@/hooks/use-signup-notifications";
import { NotificationPromptBanner } from "@/components/NotificationPromptBanner";

/** Wires in-app chat/call notification listeners for authenticated users. */
export function NotificationProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  useMessageNotifications(userId);
  const { alerts, dismissAll } = useSignupNotifications();
  const navigate = useNavigate();

  return (
    <>
      {children}
      <PendingPalAlertBanner
        alerts={alerts}
        onReview={() => {
          dismissAll();
          void navigate({ to: "/admin", search: { tab: "pals" }, replace: true });
        }}
      />
      <NotificationPromptBanner />
    </>
  );
}
