import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Phone, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsOnline } from "@/lib/presence";
import { CallScreen } from "@/components/CallScreen";
import { AppShell } from "@/components/AppShell";
import { useIncomingCallContext } from "@/components/IncomingCallProvider";
import { fetchPublicProfile } from "@/lib/public-profiles";
import {
  useConversationMessages,
  loadOlderMessages,
  sendConversationMessage,
} from "@/lib/conversation-messages";
import { setViewingConversation } from "@/lib/local-notifications";

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  validateSearch: (search: Record<string, unknown>) => ({
    call:
      search.call === "audio" || search.call === "video"
        ? (search.call as "audio" | "video")
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Chat — Pat My Back" }, { name: "robots", content: "noindex" }] }),
  component: Chat,
});

type ConvoParty = { pal_id: string; client_id: string };

function Chat() {
  const { conversationId } = Route.useParams();
  const search = Route.useSearch();
  const incomingCtx = useIncomingCallContext();
  const [me, setMe] = useState<string | null>(null);
  const { messages, hasMoreOlder, loadingOlder } = useConversationMessages(conversationId);
  const [text, setText] = useState("");
  const [otherName, setOtherName] = useState("Chat");
  const [otherId, setOtherId] = useState<string | null>(null);
  const [palId, setPalId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [myName, setMyName] = useState("Someone");
  const [activeCall, setActiveCall] = useState<"audio" | "video" | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const prevLastIdRef = useRef<string | null>(null);
  const isOnline = useIsOnline(otherId);

  useEffect(() => {
    setViewingConversation(conversationId, true);
    return () => setViewingConversation(conversationId, false);
  }, [conversationId]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return;
      setMe(sess.session.user.id);

      const { data: convo } = await supabase
        .from("conversations")
        .select("client_id, pal_id")
        .eq("id", conversationId)
        .maybeSingle<ConvoParty>();
      if (convo) {
        setPalId(convo.pal_id);
        setIsClient(convo.client_id === sess.session.user.id);
        const other = convo.client_id === sess.session.user.id ? convo.pal_id : convo.client_id;
        setOtherId(other);
        const otherProf = await fetchPublicProfile(other);
        setOtherName(otherProf?.full_name ?? "Chat");
      }

      const myProf = await fetchPublicProfile(sess.session.user.id);
      setMyName(myProf?.full_name ?? "Someone");
    })();
  }, [conversationId]);

  async function handleLoadOlder() {
    const scroller = scrollerRef.current;
    const prevHeight = scroller?.scrollHeight ?? 0;
    stickToBottomRef.current = false;
    await loadOlderMessages(conversationId);
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight - prevHeight;
    });
  }

  useEffect(() => {
    if (!search.call || !me || !incomingCtx) return;
    incomingCtx.checkConversationCall(conversationId);
  }, [search.call, me, conversationId, incomingCtx]);

  // Distinguish a live message appended at the end (scroll down) from older
  // history prepended at the front via handleLoadOlder (preserve position —
  // that path already sets stickToBottomRef.current = false itself).
  useEffect(() => {
    const newLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
    if (prevLastIdRef.current !== null && newLastId !== prevLastIdRef.current) {
      stickToBottomRef.current = true;
    }
    prevLastIdRef.current = newLastId;
    if (!stickToBottomRef.current) return;
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !me) return;
    const body = text.trim();
    setText("");
    stickToBottomRef.current = true;
    const result = await sendConversationMessage(conversationId, me, body);
    if (!result.ok) setText(body);
  }

  return (
    <>
      {activeCall && palId && (
        <CallScreen
          channelName={conversationId}
          kind={activeCall}
          remoteName={otherName}
          palId={palId}
          conversationId={conversationId}
          callerName={myName}
          asCallback={!isClient}
          isPayingClient={isClient}
          onEnd={() => setActiveCall(null)}
        />
      )}

      <AppShell fullHeight>
        <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-1 flex-col bg-background md:h-[calc(100dvh-2rem)] md:rounded-2xl md:border md:border-border md:shadow-card">
          <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
            <Link
              to="/chats"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-muted"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="relative shrink-0">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
                {otherName.slice(0, 1).toUpperCase()}
              </div>
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                  isOnline ? "bg-success" : "bg-muted-foreground/50",
                )}
                aria-label={isOnline ? "Online" : "Offline"}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight">{otherName}</p>
              <p
                className={cn(
                  "text-[11px] leading-tight",
                  isOnline ? "text-success" : "text-muted-foreground",
                )}
              >
                {isOnline ? "Online" : "Offline"}
              </p>
            </div>
            <button
              onClick={() => setActiveCall("audio")}
              aria-label="Audio call"
              disabled={!palId}
              title="Audio call"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Phone className="h-5 w-5 text-primary" />
            </button>
            <button
              onClick={() => setActiveCall("video")}
              aria-label="Video call"
              disabled={!palId}
              title="Video call"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Video className="h-5 w-5 text-primary" />
            </button>
          </header>

          <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
            {hasMoreOlder && (
              <div className="flex justify-center pb-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </Button>
              </div>
            )}
            {messages.length === 0 && (
              <p className="mt-10 text-center text-sm text-muted-foreground">
                Say hi to break the ice 👋
              </p>
            )}
            {messages.map((m) => {
              const mine = m.sender_id === me;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                      mine
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm",
                    )}
                  >
                    {m.body}
                  </div>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={send}
            className="flex items-center gap-2 border-t border-border bg-background px-3 py-2"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
          >
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message…"
              className="h-11 flex-1"
            />
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full"
              disabled={!text.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </AppShell>
    </>
  );
}
