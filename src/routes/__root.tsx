import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { getOgImageUrl } from "@/lib/app-url";
import { supabase } from "@/integrations/supabase/client";
import { setPresenceUser } from "@/lib/presence";
import { syncPalAvailabilityForSession } from "@/lib/availability";
import { bindAppAudioUnlock } from "@/lib/app-audio";
import {
  isChunkLoadError,
  reloadForStaleChunkOnce,
  clearStaleChunkGuardAfterDelay,
} from "@/lib/chunk-reload";
import { Toaster } from "@/components/ui/sonner";
import { PublicEnvScript } from "@/components/PublicEnvScript";
import { StaffRoleProvider } from "@/hooks/use-staff-role";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    // A stale tab from a previous deploy: router.invalidate()/reset() re-run
    // the SAME already-loaded (and now hash-mismatched) module graph, so
    // they can't fix this — only a full reload fetches the current entry.
    if (isChunkLoadError(error) && reloadForStaleChunkOnce()) return;
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again or head home.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0EA5A0" },
      // iOS PWA meta tags
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Pat My Back" },
      { name: "mobile-web-app-capable", content: "yes" },
      { title: "Pat My Back — Talk to someone who has your back" },
      {
        name: "description",
        content:
          "Chat, call, and video with vetted Pat Pals by the minute. Anonymous, judgment-free support whenever you need it.",
      },
      { property: "og:title", content: "Pat My Back — Talk to someone who has your back" },
      {
        property: "og:description",
        content:
          "Chat, call, and video with vetted Pat Pals by the minute. Anonymous, judgment-free support whenever you need it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Pat My Back — Talk to someone who has your back" },
      {
        name: "twitter:description",
        content:
          "Chat, call, and video with vetted Pat Pals by the minute. Anonymous, judgment-free support whenever you need it.",
      },
      {
        property: "og:image",
        content: getOgImageUrl(),
      },
      {
        name: "twitter:image",
        content: getOgImageUrl(),
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <PublicEnvScript />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    // A new deploy shipped while this tab was open — its module graph
    // references chunk hashes that no longer exist. Vite fires this event
    // instead of letting the failure surface as an uncaught error; reload
    // once to fetch the current entry. clearStaleChunkGuardAfterDelay resets
    // the guard once we've been running fine for a bit, so a future deploy
    // still gets its own fresh-reload attempt.
    function handlePreloadError(event: Event) {
      event.preventDefault();
      reloadForStaleChunkOnce();
    }
    window.addEventListener("vite:preloadError", handlePreloadError);

    // Last-resort net: a chunk-load failure that surfaces during React's
    // concurrent-render recovery (its own synchronous retry after an initial
    // failure) can end up truly uncaught, bypassing both the event above and
    // the router's route-tree ErrorComponent boundary. Catch it here too so
    // it still resolves with one reload instead of a blank/crashed page.
    function handleWindowError(event: ErrorEvent) {
      if (isChunkLoadError(event.error)) {
        event.preventDefault();
        reloadForStaleChunkOnce();
      }
    }
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) {
        event.preventDefault();
        reloadForStaleChunkOnce();
      }
    }
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    function handleSwMessage(event: MessageEvent) {
      if (event.data?.type === "STALE_ASSETS") reloadForStaleChunkOnce();
    }
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);
    const clearGuard = clearStaleChunkGuardAfterDelay();

    // Register service worker for PWA support
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          void registration.update();
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "activated" && navigator.serviceWorker.controller) {
                window.location.reload();
              }
            });
          });
        })
        .catch((err) => console.error("SW registration failed:", err));
    }

    const unbindAudio = bindAppAudioUnlock();

    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id ?? null;
      setPresenceUser(userId);
      void syncPalAvailabilityForSession(userId);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const userId = session?.user.id ?? null;
      setPresenceUser(userId);
      if (event === "SIGNED_IN") void syncPalAvailabilityForSession(userId);
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => {
      window.removeEventListener("vite:preloadError", handlePreloadError);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
      clearGuard();
      unbindAudio();
      sub.subscription.unsubscribe();
    };
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <StaffRoleProvider>
        <Outlet />
        <Toaster position="top-center" richColors />
      </StaffRoleProvider>
    </QueryClientProvider>
  );
}
