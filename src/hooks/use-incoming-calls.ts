import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { declineIncomingCall } from "@/lib/session.functions";
import { fetchPublicProfile } from "@/lib/public-profiles";
import { showLocalNotification } from "@/lib/local-notifications";
import { preloadCallMedia } from "@/lib/agora-prewarm";

export type IncomingCall = {
  sessionId: string;
  kind: "audio" | "video";
  conversationId: string | null;
  clientId: string;
  palId: string;
  callerName: string;
  channelName: string;
};

const RING_TIMEOUT_MS = 45_000;

export function useIncomingCalls(userId: string | null) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<IncomingCall | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCallRef = useRef<IncomingCall | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  const clearRingTimer = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  const dismissIncoming = useCallback(
    (sessionId?: string) => {
      clearRingTimer();
      setIncoming((current) => {
        if (!sessionId || current?.sessionId === sessionId) return null;
        return current;
      });
    },
    [clearRingTimer],
  );

  const showIncoming = useCallback(
    async (row: {
      id: string;
      kind: string;
      conversation_id: string | null;
      client_id: string;
      pal_id: string;
      initiated_by: string;
      status: string;
    }) => {
      if (row.status !== "active") return;
      if (seenRef.current.has(row.id) || activeCallRef.current) return;
      // A session insert fires for both participants via two separate
      // Realtime filters below — only react to the one where we're actually
      // the recipient, not the party who just started the call (client
      // calling a Pat Pal, or a Pat Pal calling a client back — either side
      // can now be the initiator).
      if (row.initiated_by === userId) return;
      if (row.client_id !== userId && row.pal_id !== userId) return;

      seenRef.current.add(row.id);

      const profile = await fetchPublicProfile(row.initiated_by);

      const call: IncomingCall = {
        sessionId: row.id,
        kind: row.kind as "audio" | "video",
        conversationId: row.conversation_id,
        clientId: row.client_id,
        palId: row.pal_id,
        callerName: profile?.full_name ?? "Someone",
        channelName: row.id,
      };

      setIncoming(call);
      clearRingTimer();
      ringTimerRef.current = setTimeout(() => {
        // Nobody acted — this is a miss, not an explicit decline.
        declineIncomingCall({ data: { sessionId: row.id, reason: "no_answer" } }).catch(() => {});
        dismissIncoming(row.id);
      }, RING_TIMEOUT_MS);

      if (document.hidden) {
        const url = call.conversationId
          ? `/chat/${call.conversationId}?call=${call.kind}`
          : `/home?incomingSession=${call.sessionId}&call=${call.kind}`;

        void showLocalNotification({
          title: call.kind === "video" ? "Incoming video call" : "Incoming voice call",
          body: `${call.callerName} is calling you — tap to answer`,
          url,
          tag: `call-${call.sessionId}`,
          requireInteraction: true,
        });
      }
    },
    [clearRingTimer, dismissIncoming, userId],
  );

  const checkConversationCall = useCallback(
    async (conversationId: string) => {
      if (!userId || activeCallRef.current) return;
      const { data } = await supabase
        .from("sessions")
        .select("id, kind, conversation_id, client_id, pal_id, initiated_by, status")
        .eq("conversation_id", conversationId)
        .or(`pal_id.eq.${userId},client_id.eq.${userId}`)
        .eq("status", "active")
        .maybeSingle();
      if (data) await showIncoming(data);
    },
    [userId, showIncoming],
  );

  const checkSessionCall = useCallback(
    async (sessionId: string) => {
      if (!userId || activeCallRef.current) return;
      const { data } = await supabase
        .from("sessions")
        .select("id, kind, conversation_id, client_id, pal_id, initiated_by, status")
        .eq("id", sessionId)
        .or(`pal_id.eq.${userId},client_id.eq.${userId}`)
        .eq("status", "active")
        .maybeSingle();
      if (data) await showIncoming(data);
    },
    [userId, showIncoming],
  );

  useEffect(() => {
    if (!userId) return;

    function onSessionEnded(row: { id: string; status: string }) {
      if (row.status === "active") return;
      dismissIncoming(row.id);
      setActiveCall((current) => (current?.sessionId === row.id ? null : current));
    }

    const channel = supabase
      .channel(`incoming-calls:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `pal_id=eq.${userId}`,
        },
        (payload) => {
          showIncoming(payload.new as Parameters<typeof showIncoming>[0]);
        },
      )
      .on(
        "postgres_changes",
        {
          // A Pat Pal calling a client back creates a session where WE are
          // the client_id, not the pal_id — needs its own filter since
          // Realtime postgres_changes filters don't support OR.
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `client_id=eq.${userId}`,
        },
        (payload) => {
          showIncoming(payload.new as Parameters<typeof showIncoming>[0]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `pal_id=eq.${userId}`,
        },
        (payload) => {
          onSessionEnded(payload.new as { id: string; status: string });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `client_id=eq.${userId}`,
        },
        (payload) => {
          onSessionEnded(payload.new as { id: string; status: string });
        },
      )
      .subscribe();

    return () => {
      clearRingTimer();
      supabase.removeChannel(channel);
    };
  }, [userId, showIncoming, dismissIncoming, clearRingTimer]);

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    clearRingTimer();
    // Ask for mic/camera now that they've chosen to answer — not while the
    // call was merely ringing, which surfaced the permission dialog before
    // the user had done anything.
    void preloadCallMedia(incoming.kind);
    setActiveCall(incoming);
    setIncoming(null);
  }, [incoming, clearRingTimer]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;
    const sessionId = incoming.sessionId;
    dismissIncoming(sessionId);
    try {
      await declineIncomingCall({ data: { sessionId } });
    } catch {
      /* best-effort */
    }
  }, [incoming, dismissIncoming]);

  const endActiveCall = useCallback(() => {
    setActiveCall(null);
  }, []);

  return {
    incoming,
    activeCall,
    acceptIncoming,
    declineIncoming,
    endActiveCall,
    checkConversationCall,
    checkSessionCall,
  };
}
