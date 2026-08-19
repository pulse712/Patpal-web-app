// Pat My Back — Service Worker
// Keep HTML + hashed /assets on network so deploys never 404 stale bundles.

const CACHE_NAME = "patmyback-v4";

const PRECACHE_URLS = ["/manifest.webmanifest", "/favicon.png", "/logo.png", "/icons/icon-192.png", "/icons/icon-512.png"];

const NETWORK_ONLY = ["/api/", "/assets/", "supabase.co", "stripe.com", "agora.io"];

function isNetworkOnly(url) {
  return NETWORK_ONLY.some((pattern) => url.includes(pattern));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

let currentUserId = null;

self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_PUSH_USER") {
    currentUserId = event.data.userId ?? null;
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (!url.protocol.startsWith("http")) return;
  if (isNetworkOnly(request.url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Never cache HTML navigations — always fetch latest shell + asset manifest.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  // Hashed bundles (legacy paths without /assets prefix).
  if (url.pathname.match(/\.(js|css|mjs)$/)) {
    event.respondWith(fetch(request));
    return;
  }

  // Icons / manifest — cache first for offline PWA shell.
  if (url.pathname.startsWith("/icons/") || url.pathname.endsWith("manifest.webmanifest")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(fetch(request));
});

self.addEventListener("push", (event) => {
  let data = { title: "Pat My Back", body: "You have a new notification." };
  try {
    data = event.data?.json() ?? data;
  } catch {
    data.body = event.data?.text() ?? data.body;
  }

  const isIncomingCall = (data.tag ?? "").startsWith("call-");

  event.waitUntil(
    (async () => {
      // Never alert the sender on this device (shared/test logins, stale subscriptions).
      if (!isIncomingCall && data.senderId && currentUserId && data.senderId === currentUserId) {
        return;
      }

      const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const hasVisibleClient = windowClients.some((client) => client.visibilityState === "visible");
      // Visible tab already shows the in-app toast / incoming-call overlay.
      if (hasVisibleClient && !isIncomingCall) return;

      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.tag ?? "patmyback",
        data: data.url ? { url: data.url } : undefined,
        vibrate: isIncomingCall ? [300, 100, 300, 100, 300] : [200, 100, 200],
        requireInteraction: isIncomingCall || !!data.requireInteraction,
        renotify: isIncomingCall,
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url ?? "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    }),
  );
});
