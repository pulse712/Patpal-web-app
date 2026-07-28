import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchPublicProfile } from "@/lib/public-profiles";
import { isViewingConversation, showLocalNotification } from "@/lib/local-notifications";

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

    async function resolveSenderName(senderId: string) {
      const cached = senderNamesRef.current.get(senderId);
      if (cached) return cached;

      const profile = await fetchPublicProfile(senderId);
      const name = profile?.full_name?.trim() || "Someone";
      senderNamesRef.current.set(senderId, name);
      return name;
    }

    const channel = supabase
      .channel(`message-notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const msg = payload.new as MessageRow;
          if (msg.sender_id === userId) return;
          if (isViewingConversation(msg.conversation_id)) return;

          const senderName = await resolveSenderName(msg.sender_id);
          const preview = msg.body.length > 80 ? `${msg.body.slice(0, 80)}…` : msg.body;
          const url = `/chat/${msg.conversation_id}`;
          const title = `New message from ${senderName}`;

          if (document.hidden) {
            void showLocalNotification({
              title,
              body: preview,
              url,
              tag: `msg-${msg.conversation_id}`,
            });
            return;
          }

          toast.message(title, {
            description: preview,
            action: {
              label: "Open",
              onClick: () => {
                window.location.href = url;
              },
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
