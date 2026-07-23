// Server function to submit a post-session rating.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

export const submitRating = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        stars: z.number().int().min(1).max(5),
        comment: z.string().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("client_id, pal_id, status")
      .eq("id", data.sessionId)
      .single();

    if (!session || session.client_id !== userId) {
      throw new Error("Session not found or access denied.");
    }
    if (session.status !== "ended") {
      throw new Error("Session must be ended before rating.");
    }

    const { error } = await supabaseAdmin.from("ratings").upsert(
      {
        session_id: data.sessionId,
        client_id: userId,
        pal_id: session.pal_id,
        stars: data.stars,
        comment: data.comment ?? null,
      },
      { onConflict: "session_id" },
    );

    if (error) throw new Error(error.message);

    return { ok: true };
  });
