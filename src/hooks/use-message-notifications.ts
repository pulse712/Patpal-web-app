import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { alertIncomingMessage } from "@/lib/message-notification-handler";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
};

/** Alert the user for new chat messages outside the open conversation. */
export function useMessageNotifications(userId: string | null) {
  const senderNamesRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!userId) return;
    const uid = userId; // narrowed, stable reference for the closures below

    const myConversations = new Set<string>();

    async function loadMyConversations() {
      const { data } = await supabase
        .from("conversations")
        .select("id")
        .or(`client_id.eq.${uid},pal_id.eq.${uid}`);
      myConversations.clear();
      for (const row of data ?? []) myConversations.add(row.id);
    }

    void loadMyConversations();

    function onMessage(msg: MessageRow) {
      if (!myConversations.has(msg.conversation_id)) {
        void loadMyConversations().then(() => {
          if (!myConversations.has(msg.conversation_id)) return;
          void alertIncomingMessage(uid, msg, senderNamesRef.current);
        });
        return;
      }
      void alertIncomingMessage(uid, msg, senderNamesRef.current);
    }

    const channel = supabase
      .channel(`message-notifications:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          onMessage(payload.new as MessageRow);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const convo = payload.new as { id?: string; client_id?: string; pal_id?: string };
          if (!convo.id) return;
          if (convo.client_id === userId || convo.pal_id === userId) {
            myConversations.add(convo.id);
          }
        },
      )
      .subscribe();

    // Backup when Web Push is suppressed because a visible tab is open.
    function onServiceWorkerMessage(event: MessageEvent) {
      const data = event.data as
        | {
            type?: string;
            conversationId?: string;
            senderId?: string;
            preview?: string;
          }
        | undefined;
      if (data?.type !== "message-push") return;
      if (!data.conversationId || !data.senderId || !data.preview) return;
      onMessage({
        id: `push-${Date.now()}`,
        conversation_id: data.conversationId,
        sender_id: data.senderId,
        body: data.preview,
      });
    }

    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
