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

function emit() {
  // Freeze a new reference so useSyncExternalStore detects the change.
  onlineSet = new Set(onlineSet);
  for (const l of listeners) l();
}

function resyncFromChannel() {
  if (!channel) return;
  const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>;
  const next = new Set<string>();
  for (const key of Object.keys(state)) {
    // key is the presence key (we set it to user_id). Also read from payload.
    if (key) next.add(key);
    const arr = state[key];
    for (const p of arr) if (p?.user_id) next.add(p.user_id);
  }
  onlineSet = next;
  emit();
}

export function setPresenceUser(userId: string | null) {
  if (userId === currentUserId) return;
  currentUserId = userId;

  if (channel) {
    supabase.removeChannel(channel);
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
