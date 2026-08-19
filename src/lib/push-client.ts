/**
 * Browser-side Web Push helpers — register this device for notifications.
 * Each browser gets its own subscription (stored by endpoint in push_subscriptions).
 */
import { getPublicEnv } from "@/lib/public-env";
import { savePushSubscription, removePushSubscription } from "@/lib/push-subscription.functions";

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return "Notification" in window && "serviceWorker" in navigator;
}

/** Re-save subscription on this browser when permission is already granted. */
export async function syncPushSubscriptionIfGranted(): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (Notification.permission !== "granted") return false;

  const vapidPublic = getPublicEnv("VITE_VAPID_PUBLIC_KEY");
  if (!vapidPublic || vapidPublic.includes("YOUR_")) return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      });
    }

    const rawKey = sub.getKey("p256dh");
    const rawAuth = sub.getKey("auth");
    const p256dh = rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))) : "";
    const authKey = rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : "";

    await savePushSubscription({
      data: { endpoint: sub.endpoint, p256dh, auth: authKey },
    });

    return true;
  } catch (err) {
    console.warn("[Push] sync failed:", err);
    return false;
  }
}

export function tellServiceWorkerCurrentUser(userId: string | null | undefined) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((reg) => {
    const worker = reg.active ?? navigator.serviceWorker.controller;
    worker?.postMessage({ type: "SET_PUSH_USER", userId: userId ?? null });
  });
}

/** Drop this browser's push row so the next account (or signed-out device) is not notified. */
export async function clearPushSubscriptionForThisBrowser(): Promise<void> {
  if (!isPushSupported()) return;
  tellServiceWorkerCurrentUser(null);
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await removePushSubscription({ data: { endpoint: sub.endpoint } });
  } catch (err) {
    console.warn("[Push] clear on sign-out failed:", err);
  }
}
