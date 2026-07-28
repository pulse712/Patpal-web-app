// Server function to submit a post-session rating.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

function isMissingColumnError(error: { message?: string; code?: string }, column: string) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42703" ||
    message.includes(`column "${column}"`) ||
    message.includes(`column ${column} does not exist`)
  );
}

function isLegacyRatingsSchema(error: { message?: string; code?: string }) {
  return (
    isMissingColumnError(error, "rater_id") ||
    isMissingColumnError(error, "ratee_id") ||
    (error.message?.includes("on conflict") ?? false)
  );
}

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

    if (!session) {
      throw new Error("Session not found.");
    }
    if (userId !== session.client_id && userId !== session.pal_id) {
      throw new Error("Only call participants can leave a review.");
    }

    let sessionStatus = session.status;
    if (sessionStatus !== "ended") {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const { data: refreshed } = await supabaseAdmin
          .from("sessions")
          .select("status")
          .eq("id", data.sessionId)
          .maybeSingle();
        if (refreshed?.status === "ended") {
          sessionStatus = "ended";
          break;
        }
      }
    }

    if (sessionStatus !== "ended") {
      throw new Error("Session must be ended before rating.");
    }

    const rateeId = userId === session.client_id ? session.pal_id : session.client_id;
    const payload = {
      session_id: data.sessionId,
      rater_id: userId,
      ratee_id: rateeId,
      client_id: session.client_id,
      pal_id: session.pal_id,
      stars: data.stars,
      comment: data.comment ?? null,
    };

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("ratings")
      .select("id")
      .eq("session_id", data.sessionId)
      .eq("rater_id", userId)
      .maybeSingle();

    if (lookupError) {
      if (!isLegacyRatingsSchema(lookupError)) {
        throw new Error(lookupError.message);
      }

      if (userId !== session.client_id) {
        throw new Error(
          "Pat Pal and admin reviews require the bidirectional ratings migration. Run 20260727270000_bidirectional_ratings.sql in Supabase.",
        );
      }

      const { error: legacyError } = await supabaseAdmin.from("ratings").upsert(
        {
          session_id: data.sessionId,
          client_id: userId,
          pal_id: session.pal_id,
          stars: data.stars,
          comment: data.comment ?? null,
        },
        { onConflict: "session_id" },
      );
      if (legacyError) throw new Error(legacyError.message);
      return { ok: true };
    }

    if (existing?.id) {
      const { error: updateError } = await supabaseAdmin
        .from("ratings")
        .update({
          stars: data.stars,
          comment: data.comment ?? null,
          ratee_id: rateeId,
        })
        .eq("id", existing.id);
      if (updateError) throw new Error(updateError.message);
      return { ok: true };
    }

    const { error: insertError } = await supabaseAdmin.from("ratings").insert(payload);
    if (insertError) {
      if (isLegacyRatingsSchema(insertError) && userId !== session.client_id) {
        throw new Error(
          "Pat Pal and admin reviews require the bidirectional ratings migration. Run 20260727270000_bidirectional_ratings.sql in Supabase.",
        );
      }
      throw new Error(insertError.message);
    }

    return { ok: true };
  });

export type PalReview = {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  reviewerName: string;
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

    let rows:
      | {
          id: string;
          stars: number;
          comment: string | null;
          created_at: string;
          rater_id?: string;
          client_id?: string;
        }[]
      | null = null;

    const modern = await supabaseAdmin
      .from("ratings")
      .select("id, stars, comment, created_at, rater_id")
      .eq("ratee_id", data.palId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (modern.error && isMissingColumnError(modern.error, "ratee_id")) {
      const legacy = await supabaseAdmin
        .from("ratings")
        .select("id, stars, comment, created_at, client_id")
        .eq("pal_id", data.palId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (legacy.error) throw new Error(legacy.error.message);
      rows = legacy.data ?? [];
    } else {
      if (modern.error) throw new Error(modern.error.message);
      rows = modern.data ?? [];
    }

    const reviewerIds = [
      ...new Set(
        (rows ?? []).map((row) => ("rater_id" in row && row.rater_id) || row.client_id || ""),
      ),
    ].filter(Boolean);

    let nameById = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", reviewerIds);
      nameById = new Map(
        (profiles ?? []).map((p) => [p.id, p.full_name?.trim() || "User"]),
      );
    }

    const reviews: PalReview[] = (rows ?? []).map((row) => {
      const reviewerId =
        ("rater_id" in row && row.rater_id) || row.client_id || "";
      const fullName = nameById.get(reviewerId) ?? "User";
      return {
        id: row.id,
        stars: row.stars,
        comment: row.comment,
        createdAt: row.created_at,
        reviewerName: fullName,
      };
    });

    return { reviews };
  });
