import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Phone, PhoneMissed, Video, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { listCallHistory, type CallHistoryRow } from "@/lib/session.functions";
import { formatCallDuration, formatCallTimestamp } from "@/lib/format-message-time";
import { outcomeLabel } from "@/lib/call-history";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({
    meta: [{ title: "Call History — Pat My Back" }, { name: "robots", content: "noindex" }],
  }),
  component: CallHistoryPage,
});

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return <img src={url} alt={name} className="h-11 w-11 rounded-full object-cover" />;
  }
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function outcomeColor(outcome: CallHistoryRow["outcome"]): string {
  switch (outcome) {
    case "answered":
      return "text-success";
    case "missed":
    case "declined":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function CallRow({ call }: { call: CallHistoryRow }) {
  const KindIcon = call.kind === "video" ? Video : Phone;
  const missedLike = call.outcome === "missed" || call.outcome === "declined";
  const DirectionIcon = missedLike
    ? PhoneMissed
    : call.direction === "incoming"
      ? ArrowDownLeft
      : ArrowUpRight;

  const callAgainTo = call.conversationId
    ? {
        to: "/chat/$conversationId" as const,
        params: { conversationId: call.conversationId },
        search: { call: call.kind },
      }
    : call.otherIsPal
      ? { to: "/pal/$palId" as const, params: { palId: call.otherId } }
      : null;

  const profileTo = call.otherIsPal
    ? { to: "/pal/$palId" as const, params: { palId: call.otherId } }
    : null;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border p-3">
      {profileTo ? (
        <Link {...profileTo} className="shrink-0">
          <Avatar name={call.otherName} url={call.otherAvatarUrl} />
        </Link>
      ) : (
        <Avatar name={call.otherName} url={call.otherAvatarUrl} />
      )}
      <div className="min-w-0 flex-1">
        {profileTo ? (
          <Link {...profileTo} className="truncate text-sm font-semibold hover:underline">
            {call.otherName}
          </Link>
        ) : (
          <p className="truncate text-sm font-semibold">{call.otherName}</p>
        )}
        <div className={cn("mt-0.5 flex items-center gap-1 text-xs", outcomeColor(call.outcome))}>
          <DirectionIcon className="h-3 w-3 shrink-0" />
          <span>{outcomeLabel(call.outcome)}</span>
          <KindIcon className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatCallTimestamp(call.startedAt)}
          {call.outcome === "answered" ? ` · ${formatCallDuration(call.durationSeconds)}` : ""}
        </p>
      </div>
      {callAgainTo ? (
        <Link
          {...callAgainTo}
          aria-label={`Call ${call.otherName} again`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Phone className="h-4 w-4" />
        </Link>
      ) : null}
    </li>
  );
}

function CallHistoryPage() {
  const { user } = useSession();
  const listCallHistoryFn = useServerFn(listCallHistory);
  const [loading, setLoading] = useState(true);
  const [calls, setCalls] = useState<CallHistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const { calls: rows } = await listCallHistoryFn();
        if (!cancelled) setCalls(rows);
      } catch (err) {
        if (!cancelled)
          toast.error(err instanceof Error ? err.message : "Could not load call history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void refresh();
    if (!user) return;

    // A call can complete on another device while this page is open —
    // re-fetch on any relevant sessions change so the list doesn't need a
    // manual reload. Two filters: Realtime postgres_changes doesn't support
    // OR, and either side of the session row can be the current user.
    const channel = supabase
      .channel(`call-history:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `client_id=eq.${user.id}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `pal_id=eq.${user.id}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [listCallHistoryFn, user]);

  return (
    <AppShell>
      <div className="space-y-4 p-4 pb-24">
        <header>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            History
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <History className="h-6 w-6 text-primary" />
            Call History
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every call you've made or received, on this device or any other.
          </p>
        </header>

        <Card className="p-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : calls.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No calls yet.</p>
          ) : (
            <ul className="space-y-2">
              {calls.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
