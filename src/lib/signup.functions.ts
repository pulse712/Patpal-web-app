// Apply the role chosen at signup (client or pat_pal). Uses service role so it
// works even if the DB trigger has not been migrated yet.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import type { SignupRole } from "@/lib/signup-role";

const applySignupRoleSchema = z
  .object({
    role: z.enum(["client", "pat_pal"]),
    categorySlug: z.string().min(1).max(64).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "pat_pal" && !data.categorySlug?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please choose a support category.",
        path: ["categorySlug"],
      });
    }
  });

export const applySignupRole = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => applySignupRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const role: SignupRole = data.role;
    const categorySlug = data.categorySlug?.trim();

    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    if (isAdmin || isSuperAdmin) {
      return { ok: true, role };
    }

    const { error: clientErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "client" }, { onConflict: "user_id,role" });
    if (clientErr) throw new Error(clientErr.message);

    if (role === "pat_pal") {
      const { data: category, error: catErr } = await supabaseAdmin
        .from("categories")
        .select("slug")
        .eq("slug", categorySlug!)
        .maybeSingle();
      if (catErr) throw new Error(catErr.message);
      if (!category) throw new Error("Invalid support category.");

      const { error: palRoleErr } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "pat_pal" }, { onConflict: "user_id,role" });
      if (palRoleErr) throw new Error(palRoleErr.message);

      const { error: palErr } = await supabaseAdmin.from("pat_pals").upsert(
        {
          user_id: userId,
          headline: "Available for support",
          availability: "offline",
          price_cents_per_minute: 100,
          tier: "trusted",
          category_slugs: [category.slug],
        },
        { onConflict: "user_id" },
      );
      if (palErr) throw new Error(palErr.message);
    }

    return { ok: true, role };
  });
