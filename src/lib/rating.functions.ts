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

export type PalReview = {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  clientName: string;
};

export const listPalReviews = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z
      .object({
        palId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = data.limit ?? 20;

    const { data: rows, error } = await supabaseAdmin
      .from("ratings")
      .select("id, stars, comment, created_at, client_id")
      .eq("pal_id", data.palId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);

    const clientIds = [...new Set((rows ?? []).map((r) => r.client_id))];
    let nameById = new Map<string, string>();

    if (clientIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", clientIds);
      nameById = new Map(
        (profiles ?? []).map((p) => [p.id, p.full_name?.trim() || "Client"]),
      );
    }

    const reviews: PalReview[] = (rows ?? []).map((row) => {
      const fullName = nameById.get(row.client_id) ?? "Client";
      const firstName = fullName.split(/\s+/)[0] || "Client";
      return {
        id: row.id,
        stars: row.stars,
        comment: row.comment,
        createdAt: row.created_at,
        clientName: firstName,
      };
    });

    return { reviews };
  });
