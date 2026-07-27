import { useEffect } from "react";
import { syncPushSubscriptionIfGranted } from "@/lib/push-client";

/** Registers this browser for push when the user is already logged in. */
export function PushRegistration() {
  useEffect(() => {
    void syncPushSubscriptionIfGranted();
  }, []);

  return null;
}
