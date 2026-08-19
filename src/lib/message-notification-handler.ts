import { toast } from "sonner";
import { fetchPublicProfile } from "@/lib/public-profiles";
import { isViewingConversation, showLocalNotification } from "@/lib/local-notifications";
import { playMessageChime } from "@/lib/message-chime";

export type IncomingMessageAlert = {
  conversation_id: string;
  sender_id: string;
  body: string;
};

/** Show sound + toast/OS notification for a message from someone else. */
export async function alertIncomingMessage(
  userId: string,
  msg: IncomingMessageAlert,
  senderNames: Map<string, string>,
): Promise<void> {
  if (!msg.sender_id || msg.sender_id === userId) return;
  if (isViewingConversation(msg.conversation_id)) return;

  playMessageChime();

  let senderName = senderNames.get(msg.sender_id);
  if (!senderName) {
    const profile = await fetchPublicProfile(msg.sender_id);
    senderName = profile?.full_name?.trim() || "Someone";
    senderNames.set(msg.sender_id, senderName);
  }

  const preview = msg.body.length > 80 ? `${msg.body.slice(0, 80)}…` : msg.body;
  const url = `/chat/${msg.conversation_id}`;
  const title = `New message from ${senderName}`;

  if (document.hidden) {
    void showLocalNotification({
      title,
      body: preview,
      url,
      tag: `msg-${msg.conversation_id}`,
      requireInteraction: true,
    });
    return;
  }

  toast.message(title, {
    id: `msg-${msg.conversation_id}`,
    description: preview,
    duration: Infinity,
    closeButton: true,
    action: {
      label: "Open",
      onClick: () => {
        window.location.href = url;
      },
    },
  });
}
