import { useCallback, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyNewMessage } from "@/lib/notify.functions";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Shared, ref-counted message store for a conversation, keyed by
// conversation id. Multiple consumers (the full chat screen, the in-call
// chat panel) can be mounted for the same conversation at once — e.g. a call
// started from inside /chat/$conversationId overlays CallScreen on top of
// the still-mounted Chat component. Without this, each consumer would run
// its own fetch + realtime subscription for identical data. This mirrors the
// singleton pattern in `presence.ts`.

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type Snapshot = {
  messages: ConversationMessage[];
  loaded: boolean;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
};

type Entry = {
  messages: ConversationMessage[];
  loaded: boolean;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
  snapshot: Snapshot;
  listeners: Set<() => void>;
  channel: RealtimeChannel | null;
  refCount: number;
};

const PAGE_SIZE = 50;
const store = new Map<string, Entry>();
const EMPTY_SNAPSHOT: Snapshot = {
  messages: [],
  loaded: false,
  hasMoreOlder: false,
  loadingOlder: false,
};

function getEntry(conversationId: string): Entry {
  let entry = store.get(conversationId);
  if (!entry) {
    entry = {
      messages: [],
      loaded: false,
      hasMoreOlder: false,
      loadingOlder: false,
      snapshot: EMPTY_SNAPSHOT,
      listeners: new Set(),
      channel: null,
      refCount: 0,
    };
    store.set(conversationId, entry);
  }
  return entry;
}

function emit(entry: Entry) {
  // New object reference so useSyncExternalStore detects the change.
  entry.snapshot = {
    messages: entry.messages,
    loaded: entry.loaded,
    hasMoreOlder: entry.hasMoreOlder,
    loadingOlder: entry.loadingOlder,
  };
  for (const l of entry.listeners) l();
}

function upsertMessages(entry: Entry, incoming: ConversationMessage[]) {
  if (incoming.length === 0) return;
  const byId = new Map(entry.messages.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  entry.messages = Array.from(byId.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

async function loadInitial(conversationId: string) {
  const entry = getEntry(conversationId);
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  // Conversation may have been released (all consumers unmounted, possibly
  // re-acquired as a fresh entry) while the fetch was in flight.
  if (store.get(conversationId) !== entry) return;
  upsertMessages(entry, ((data ?? []) as ConversationMessage[]).slice().reverse());
  entry.loaded = true;
  entry.hasMoreOlder = (data ?? []).length === PAGE_SIZE;
  emit(entry);
}

function subscribeRealtime(conversationId: string) {
  const entry = getEntry(conversationId);
  if (entry.channel) return;
  entry.channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        upsertMessages(entry, [payload.new as ConversationMessage]);
        emit(entry);
      },
    )
    .subscribe();
}

/** Fetches the next page of older history and prepends it into the shared list. */
export async function loadOlderMessages(conversationId: string): Promise<void> {
  const entry = store.get(conversationId);
  if (!entry || entry.loadingOlder || !entry.hasMoreOlder || entry.messages.length === 0) return;
  entry.loadingOlder = true;
  emit(entry);

  const oldestCreatedAt = entry.messages[0].created_at;
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .lt("created_at", oldestCreatedAt)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (store.get(conversationId) !== entry) return;
  const older = (data ?? []) as ConversationMessage[];
  upsertMessages(entry, older.slice().reverse());
  entry.hasMoreOlder = older.length === PAGE_SIZE;
  entry.loadingOlder = false;
  emit(entry);
}

/**
 * Inserts a message and fires the best-effort push notification. Shared by
 * the full chat screen and the in-call chat panel so the insert shape,
 * preview truncation, and notify payload can't silently drift between them.
 * The realtime INSERT echoes back through the subscription above — no local
 * append needed here.
 */
export async function sendConversationMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, body });
  if (error) return { ok: false, error: error.message };

  notifyNewMessage({
    data: { conversationId, preview: body.length > 80 ? body.slice(0, 80) + "…" : body },
  }).catch(() => {
    /* best-effort */
  });
  return { ok: true };
}

function acquire(conversationId: string): () => void {
  const entry = getEntry(conversationId);
  entry.refCount++;
  if (entry.refCount === 1) {
    void loadInitial(conversationId);
    subscribeRealtime(conversationId);
  }
  return () => {
    entry.refCount--;
    if (entry.refCount <= 0) {
      if (entry.channel) void supabase.removeChannel(entry.channel);
      store.delete(conversationId);
    }
  };
}

/** Live-syncs the recent message history for a conversation, shared across every mounted consumer. */
export function useConversationMessages(conversationId: string | null | undefined): Snapshot {
  // subscribe/getSnapshot must stay reference-stable across re-renders — an
  // inline closure recreated on every render makes useSyncExternalStore tear
  // down and resubscribe every render (it re-runs `subscribe` whenever its
  // identity changes), which here would mean re-fetching + resubscribing on
  // every tick of anything that re-renders a consumer (e.g. CallScreen's
  // once-a-second elapsed-time timer).
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!conversationId) return () => {};
      const entry = getEntry(conversationId);
      entry.listeners.add(onChange);
      const release = acquire(conversationId);
      return () => {
        entry.listeners.delete(onChange);
        release();
      };
    },
    [conversationId],
  );
  const getSnapshot = useCallback(
    () => (conversationId ? getEntry(conversationId).snapshot : EMPTY_SNAPSHOT),
    [conversationId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
