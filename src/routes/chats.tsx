import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/chats")({
  head: () => ({ meta: [{ title: "Chats — Pat My Back" }, { name: "robots", content: "noindex" }] }),
  component: Chats,
});

type ConvoRow = {
  id: string;
  client_id: string;
  pal_id: string;
  last_message_at: string | null;
  client: { full_name: string | null } | null;
  pal: { full_name: string | null } | null;
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
      setMe(sess.session.user.id);
      const { data } = await supabase
        .from("conversations")
        .select("id, client_id, pal_id, last_message_at, client:profiles!conversations_client_id_fkey(full_name), pal:profiles!conversations_pal_id_fkey(full_name)")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      setConvos((data ?? []) as unknown as ConvoRow[]);
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
            const otherName = (me === c.client_id ? c.pal?.full_name : c.client?.full_name) ?? "Chat";
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
