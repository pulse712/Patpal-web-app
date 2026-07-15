import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { MessageCircle } from "lucide-react";
import { useIsOnline } from "@/lib/presence";

export const Route = createFileRoute("/chats")({
  head: () => ({ meta: [{ title: "Chats — Pat My Back" }, { name: "robots", content: "noindex" }] }),
  component: Chats,
});

type ConvoRow = {
  id: string;
  client_id: string;
  pal_id: string;
  last_message_at: string | null;
  otherId: string;
  otherName: string;
};

function Chats() {
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [convos, setConvos] = useState<ConvoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/auth" });
        return;
      }
      const myId = sess.session.user.id;
      setMe(myId);
      const { data } = await supabase
        .from("conversations")
        .select("id, client_id, pal_id, last_message_at")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      const rows = data ?? [];
      const otherIds = Array.from(
        new Set(rows.map((r) => (r.client_id === myId ? r.pal_id : r.client_id))),
      );
      let nameMap = new Map<string, string>();
      if (otherIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", otherIds);
        nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? "Chat"]));
      }
      setConvos(
        rows.map((r) => ({
          ...r,
          otherName: nameMap.get(r.client_id === myId ? r.pal_id : r.client_id) ?? "Chat",
        })),
      );
      setLoading(false);
    })();
  }, [navigate]);


  return (
    <AppShell>
      <header className="px-5 pt-10 pb-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Chats</h1>
      </header>
      <section className="space-y-2 px-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : convos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <MessageCircle className="mx-auto mb-2 h-6 w-6 opacity-60" />
            No conversations yet.
            <div className="mt-3">
              <Link to="/browse" className="text-primary font-medium">Find a Pal</Link>
            </div>
          </div>
        ) : (
          convos.map((c) => {
            const otherName = c.otherName;
            return (

              <Link
                key={c.id}
                to="/chat/$conversationId"
                params={{ conversationId: c.id }}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card hover:border-primary/30"
              >
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
                  {otherName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{otherName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : "No messages yet"}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </section>
    </AppShell>
  );
}
