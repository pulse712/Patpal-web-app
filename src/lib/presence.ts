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

// How often we refresh our own presence timestamp while the tab is active.
const HEARTBEAT_MS = 25_000;

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
  const present = new Set<string>();
  for (const key of Object.keys(state)) {
    for (const p of state[key]) {
      const id = p?.user_id ?? key;
      if (id) present.add(id);
    }
  }
  // Anyone still in the Realtime snapshot is online. Do not prune on a
  // frozen heartbeat — that is what happens when a Pal switches to WhatsApp.
  onlineSet = present;
  emit();
}

async function refreshMyPresence() {
  if (!channel || !currentUserId) return;
  await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() });
  resyncFromChannel();
}

// Do not untrack on pagehide — mobile browsers fire that when switching apps.
// beforeunload covers an actual desktop tab close.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (channel) void channel.untrack();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshMyPresence();
  });
  window.addEventListener("pageshow", () => {
    void refreshMyPresence();
  });
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
          resyncFromChannel();
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
