// Server function to send a welcome email after signup.
// Called from the client immediately after supabase.auth.signUp succeeds.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const sendWelcome = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ name: z.string(), email: z.string().email() }).parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const { sendWelcomeEmail } = await import("@/lib/email.server");
      await sendWelcomeEmail({ to: data.email, name: data.name });
    } catch (err) {
      // Best-effort — never block signup
      console.error("[sendWelcome] Failed:", err);
    }
    return { ok: true };
  });
