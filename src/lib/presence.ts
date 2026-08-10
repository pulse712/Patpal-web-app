import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Global online-user presence store backed by a single Supabase Realtime
// channel. Every authenticated user tracks their own id; anyone subscribed
// receives sync/join/leave events and can look up online users by id.

const listeners = new Set<() => void>();
let onlineSet: Set<string> = new Set();
let channel: RealtimeChannel | null = null;
let currentUserId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// How often we refresh our own presence timestamp, and how long a peer can
// go without a heartbeat before we treat them as offline client-side. This
// covers ungraceful disconnects (crash, force-quit, network loss) where the
// realtime server's own leave detection can lag behind reality.
const HEARTBEAT_MS = 25_000;
const STALE_MS = 90_000;

// Per-peer bookkeeping for staleness. We deliberately do NOT compare against
// each peer's self-reported `online_at` directly (their device clock may be
// wrong/skewed). Instead we only trust that their payload *changed* — a sign
// a fresh heartbeat/track actually arrived — and stamp that moment with OUR
// own clock. `lastReportedOnlineAt` lets us detect a real change; `lastSeenAt`
// is what staleness is measured against.
const lastReportedOnlineAt = new Map<string, string>();
const lastSeenAt = new Map<string, number>();

function emit() {
  // Freeze a new reference so useSyncExternalStore detects the change.
  onlineSet = new Set(onlineSet);
  for (const l of listeners) l();
}

function resyncFromChannel() {
  if (!channel) return;
  const state = channel.presenceState() as Record<
    string,
    Array<{ user_id?: string; online_at?: string }>
  >;
  const now = Date.now();
  const present = new Set<string>();
  for (const key of Object.keys(state)) {
    for (const p of state[key]) {
      const id = p?.user_id ?? key;
      if (!id) continue;
      present.add(id);
      const reported = p?.online_at ?? "";
      // Only bump "last seen" when the peer's own payload actually changed
      // (a real new heartbeat from them) or we've never seen them before —
      // not just because some unrelated peer's event re-delivered the same
      // cached snapshot to us.
      if (reported !== lastReportedOnlineAt.get(id) || !lastSeenAt.has(id)) {
        lastReportedOnlineAt.set(id, reported);
        lastSeenAt.set(id, now);
      }
    }
  }
  for (const id of lastSeenAt.keys()) {
    if (!present.has(id)) {
      lastSeenAt.delete(id);
      lastReportedOnlineAt.delete(id);
    }
  }

  const next = new Set<string>();
  for (const [id, seenAt] of lastSeenAt) {
    if (now - seenAt <= STALE_MS) next.add(id);
  }
  onlineSet = next;
  emit();
}

export function setPresenceUser(userId: string | null) {
  if (userId === currentUserId) return;
  currentUserId = userId;

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (channel) {
    const prev = channel;
    void prev.untrack(); // broadcast an immediate "leave" instead of waiting on socket teardown
    supabase.removeChannel(prev);
    channel = null;
    onlineSet = new Set();
    lastSeenAt.clear();
    lastReportedOnlineAt.clear();
    emit();
  }
  if (!userId) return;

  const ch = supabase.channel("online-users", {
    config: { presence: { key: userId } },
  });
  ch.on("presence", { event: "sync" }, resyncFromChannel)
    .on("presence", { event: "join" }, resyncFromChannel)
    .on("presence", { event: "leave" }, resyncFromChannel)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ user_id: userId, online_at: new Date().toISOString() });
        // Realtime can re-invoke this callback with "SUBSCRIBED" after an
        // automatic rejoin (e.g. a brief socket drop) — clear any previous
        // interval first so heartbeats don't stack up over repeated reconnects.
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          void ch.track({ user_id: userId, online_at: new Date().toISOString() });
          resyncFromChannel(); // also prunes any peers that went stale
        }, HEARTBEAT_MS);
      }
    });
  channel = ch;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function getSnapshot() {
  return onlineSet;
}
function getServerSnapshot() {
  return onlineSet;
}

export function useOnlineUsers(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useIsOnline(userId: string | null | undefined): boolean {
  const set = useOnlineUsers();
  return !!userId && set.has(userId);
}
