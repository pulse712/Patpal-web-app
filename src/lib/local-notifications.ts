/**
 * Browser notifications for chat and calls while the app tab is open.
 * Web Push (service worker) handles closed/minimized browsers.
 */

export type LocalNotificationOptions = {
  title: string;
  body: string;
  url: string;
  tag: string;
  requireInteraction?: boolean;
};

export function canShowLocalNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

export function isViewingConversation(conversationId: string): boolean {
  return (
    typeof window !== "undefined" &&
    !document.hidden &&
    window.location.pathname === `/chat/${conversationId}`
  );
}

export async function showLocalNotification(
  opts: LocalNotificationOptions,
): Promise<void> {
  if (!canShowLocalNotifications()) return;

  const notificationOptions: NotificationOptions = {
    body: opts.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: opts.tag,
    requireInteraction: opts.requireInteraction ?? false,
    data: { url: opts.url },
  };

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(opts.title, notificationOptions);
      return;
    }
  } catch {
    /* fall through to Notification API */
  }

  const notification = new Notification(opts.title, notificationOptions);
  notification.onclick = () => {
    window.focus();
    window.location.href = opts.url;
    notification.close();
  };
}
