import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";

export const TIP_PRESETS = [
  { label: "$3", cents: 300 },
  { label: "$5", cents: 500 },
  { label: "$10", cents: 1000 },
] as const;

export const createTipIntent = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        cents: z.number().int().min(100).max(20000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { stripe } = await import("@/lib/stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = context;

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, client_id, pal_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (!session || session.client_id !== userId) {
      throw new Error("Only the client can leave a tip for this session.");
    }
    if (session.status !== "ended") {
      throw new Error("Tips are available after the call ends.");
    }

    const { data: existing } = await supabaseAdmin
      .from("session_tips")
      .select("id")
      .eq("session_id", data.sessionId)
      .eq("client_id", userId)
      .maybeSingle();
    if (existing?.id) {
      throw new Error("A tip was already sent for this session.");
    }

    const intent = await (stripe as import("stripe").default).paymentIntents.create({
      amount: data.cents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        user_id: userId,
        pal_id: session.pal_id,
        session_id: session.id,
        amount_cents: String(data.cents),
        source: "session_tip",
      },
    });

    return {
      clientSecret: intent.client_secret!,
      amountCents: data.cents,
    };
  });

export type PalTipRow = {
  id: string;
  amountCents: number;
  createdAt: string;
  clientName: string;
};

export const listPalTips = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }): Promise<{ tips: PalTipRow[]; totalCents: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("session_tips")
      .select("id, amount_cents, created_at, client_id")
      .eq("pal_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      if (error.code === "42P01" || /session_tips/i.test(error.message)) {
        return { tips: [], totalCents: 0 };
      }
      throw new Error(error.message);
    }

    const clientIds = [...new Set((rows ?? []).map((r) => r.client_id))];
    const nameById = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", clientIds);
      for (const p of profiles ?? []) {
        const name = p.full_name?.trim();
        if (name) nameById.set(p.id, name);
      }
    }

    const tips: PalTipRow[] = (rows ?? []).map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      createdAt: row.created_at,
      clientName: nameById.get(row.client_id) || "Client",
    }));

    return {
      tips,
      totalCents: tips.reduce((sum, t) => sum + t.amountCents, 0),
    };
  });
