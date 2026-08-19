import { useEffect } from "react";
import { syncPushSubscriptionIfGranted, tellServiceWorkerCurrentUser } from "@/lib/push-client";

/** Registers this browser for push when the user is already logged in. */
export function PushRegistration({ userId }: { userId: string }) {
  useEffect(() => {
    tellServiceWorkerCurrentUser(userId);
    void syncPushSubscriptionIfGranted();
    return () => tellServiceWorkerCurrentUser(null);
  }, [userId]);

  return null;
}
