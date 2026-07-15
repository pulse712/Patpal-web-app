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
        rows.map((r) => {
          const otherId = r.client_id === myId ? r.pal_id : r.client_id;
          return {
            ...r,
            otherId,
            otherName: nameMap.get(otherId) ?? "Chat",
          };
        }),
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
          convos.map((c) => <ConvoItem key={c.id} convo={c} />)
        )}
      </section>
    </AppShell>
  );
}
