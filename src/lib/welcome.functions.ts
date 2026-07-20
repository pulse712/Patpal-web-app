// Server function to send a welcome email after signup.
// Requires auth — email must match the signed-in user.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const sendWelcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ name: z.string(), email: z.string().email() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(context.userId);

    if (error || !authUser?.user?.email) {
      throw new Error("Unauthorized");
    }
    if (authUser.user.email.toLowerCase() !== data.email.toLowerCase()) {
      throw new Error("Email does not match authenticated user");
    }

    try {
      const { sendWelcomeEmail } = await import("@/lib/email.server");
      await sendWelcomeEmail({ to: data.email, name: data.name });
    } catch (err) {
      // Best-effort — never block signup
      console.error("[sendWelcome] Failed:", err);
    }
    return { ok: true };
  });
