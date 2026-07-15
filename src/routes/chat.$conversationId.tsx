import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Phone, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/chat/$conversationId")({
  head: () => ({ meta: [{ title: "Chat — Pat My Back" }, { name: "robots", content: "noindex" }] }),
  component: Chat,
});

type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
type ConvoParty = { pal_id: string; client_id: string };

function Chat() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [otherName, setOtherName] = useState("Chat");
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/auth" });
        return;
      }
      setMe(sess.session.user.id);

      const { data: convo } = await supabase
        .from("conversations")
        .select("client_id, pal_id")
        .eq("id", conversationId)
        .maybeSingle<ConvoParty>();
      if (convo) {
        const other = convo.client_id === sess.session.user.id ? convo.pal_id : convo.client_id;
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", other).maybeSingle();
        setOtherName(prof?.full_name ?? "Chat");
      }

      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);
      setMessages((msgs ?? []) as Message[]);
    })();
  }, [conversationId, navigate]);

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !me) return;
    const body = text.trim();
    setText("");
    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: me, body });
    if (error) setText(body);
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Link to="/chats" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
          {otherName.slice(0, 1).toUpperCase()}
        </div>
        <p className="min-w-0 flex-1 truncate font-semibold">{otherName}</p>
        <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"><Phone className="h-5 w-5 text-primary" /></button>
        <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"><Video className="h-5 w-5 text-primary" /></button>
      </header>

      <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">Say hi to break the ice 👋</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === me;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                  mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm",
                )}
              >
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-border bg-background px-3 py-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" className="h-11 flex-1" />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={!text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
