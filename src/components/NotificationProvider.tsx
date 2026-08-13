import type { ReactNode } from "react";
import { useMessageNotifications } from "@/hooks/use-message-notifications";
import { useSignupNotifications } from "@/hooks/use-signup-notifications";
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
  useSignupNotifications();

  return (
    <>
      {children}
      <NotificationPromptBanner />
    </>
  );
}
