import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
