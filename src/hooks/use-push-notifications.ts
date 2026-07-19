/**
 * usePushNotifications
 *
 * Handles the full browser-side push subscription lifecycle:
 *  - Check current permission state
 *  - Request permission + subscribe to VAPID push
 *  - Save / remove subscription on server
 *  - Returns helpers to enable/disable from any component
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { savePushSubscription, removePushSubscription } from "@/lib/push.functions";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function usePushNotifications() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const vapidPublic = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

  // Sync state from browser on mount
  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);

    // Check if already subscribed
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    });
  }, []);

  const enable = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast.error("Push notifications are not supported in this browser.");
      return;
    }

    if (!vapidPublic || vapidPublic.includes("YOUR_")) {
      toast.error("Push notifications are not configured yet.");
      return;
    }

    setLoading(true);
    try {
      // 1. Request permission
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);

      if (result !== "granted") {
        toast.error("Notification permission denied.");
        return;
      }

      // 2. Subscribe via service worker
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      });

      // 3. Extract keys
      const rawKey    = sub.getKey("p256dh");
      const rawAuth   = sub.getKey("auth");
      const p256dh    = rawKey  ? btoa(String.fromCharCode(...new Uint8Array(rawKey)))  : "";
      const authKey   = rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : "";

      // 4. Save to server
      await savePushSubscription({
        data: { endpoint: sub.endpoint, p256dh, auth: authKey },
      });

      setSubscribed(true);
      toast.success("Notifications enabled 🔔");
    } catch (err) {
      console.error("[Push] enable error:", err);
      toast.error("Could not enable notifications.");
    } finally {
      setLoading(false);
    }
  }, [vapidPublic]);

  const disable = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.info("Notifications disabled.");
    } catch (err) {
      console.error("[Push] disable error:", err);
      toast.error("Could not disable notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  return { permission, subscribed, loading, enable, disable };
}

// Convert VAPID base64 public key to Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
