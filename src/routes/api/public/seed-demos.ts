import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { runSeedDemoPatPals } from "@/lib/seed.functions";

async function assertAdminFromRequest(): Promise<Response | null> {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const token = authHeader.replace("Bearer ", "");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: data.user.id, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: data.user.id, _role: "super_admin" }),
  ]);

  if (!isAdmin && !isSuperAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  return null;
}

export const Route = createFileRoute("/api/public/seed-demos")({
  server: {
    handlers: {
      POST: async () => {
        const denied = await assertAdminFromRequest();
        if (denied) return denied;

        const result = await runSeedDemoPatPals();
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
