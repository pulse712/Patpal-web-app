import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { declineIncomingCall } from "@/lib/session.functions";
import { fetchPublicProfile } from "@/lib/public-profiles";

export type IncomingCall = {
  sessionId: string;
  kind: "audio" | "video";
  conversationId: string | null;
  clientId: string;
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
      status: string;
    }) => {
      if (row.status !== "active") return;
      if (seenRef.current.has(row.id) || activeCallRef.current) return;

      seenRef.current.add(row.id);

      const profile = await fetchPublicProfile(row.client_id);

      const call: IncomingCall = {
        sessionId: row.id,
        kind: row.kind as "audio" | "video",
        conversationId: row.conversation_id,
        clientId: row.client_id,
        callerName: profile?.full_name ?? "Client",
        channelName: row.conversation_id ?? row.id,
      };

      setIncoming(call);
      clearRingTimer();
      ringTimerRef.current = setTimeout(() => {
        declineIncomingCall({ data: { sessionId: row.id } }).catch(() => {});
        dismissIncoming(row.id);
      }, RING_TIMEOUT_MS);
    },
    [clearRingTimer, dismissIncoming],
  );

  const checkConversationCall = useCallback(
    async (conversationId: string) => {
      if (!userId || activeCallRef.current) return;
      const { data } = await supabase
        .from("sessions")
        .select("id, kind, conversation_id, client_id, status")
        .eq("conversation_id", conversationId)
        .eq("pal_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (data) await showIncoming(data);
    },
    [userId, showIncoming],
  );

  useEffect(() => {
    if (!userId) return;

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
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `pal_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          if (row.status !== "active") {
            dismissIncoming(row.id);
            setActiveCall((current) => (current?.sessionId === row.id ? null : current));
          }
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
  };
}
