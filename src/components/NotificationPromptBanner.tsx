import { useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/use-push-notifications";

const DISMISS_KEY = "notif-prompt-dismissed";

export function NotificationPromptBanner() {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "1",
  );

  if (
    dismissed ||
    push.subscribed ||
    push.permission === "denied" ||
    push.permission === "unsupported"
  ) {
    return null;
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="fixed inset-x-4 bottom-20 z-50 md:bottom-6 md:left-auto md:right-6 md:max-w-sm">
      <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-background p-4 shadow-lg">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Enable notifications</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Get alerts for new chat messages and incoming audio or video calls.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={push.loading} onClick={() => void push.enable()}>
              {push.loading ? "Enabling…" : "Enable"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
