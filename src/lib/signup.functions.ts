// Apply the role chosen at signup (client or pat_pal). Uses service role so it
// works even if the DB trigger has not been migrated yet.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import type { SignupRole } from "@/lib/signup-role";
import { normalizeCategorySlugs, resolveValidCategorySlugs } from "@/lib/categories";

const applySignupRoleSchema = z
  .object({
    role: z.enum(["client", "pat_pal"]),
    categorySlug: z.string().min(1).max(64).optional(),
    categorySlugs: z.array(z.string().min(1).max(64)).optional(),
    service: z.string().min(3).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "pat_pal") {
      const slugs = normalizeCategorySlugs(
        data.categorySlugs?.length
          ? data.categorySlugs
          : data.categorySlug?.trim()
            ? [data.categorySlug.trim()]
            : [],
      );
      if (slugs.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please choose at least one support category.",
          path: ["categorySlugs"],
        });
      }
      if (!data.service?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please describe the service you offer.",
          path: ["service"],
        });
      }
    }
  });

export const applySignupRole = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => applySignupRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const role: SignupRole = data.role;
    const service = data.service?.trim();
    const categorySlugs = normalizeCategorySlugs(
      data.categorySlugs?.length
        ? data.categorySlugs
        : data.categorySlug?.trim()
          ? [data.categorySlug.trim()]
          : [],
    );

    const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    if (isAdmin || isSuperAdmin) {
      return { ok: true, role };
    }

    const targetRole = role;
    const { error: deleteErr } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (deleteErr) throw new Error(deleteErr.message);

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: targetRole });
    if (roleErr) throw new Error(roleErr.message);

    if (role === "pat_pal") {
      const validSlugs = await resolveValidCategorySlugs(supabaseAdmin, categorySlugs);

      const { error: palErr } = await supabaseAdmin.from("pat_pals").upsert(
        {
          user_id: userId,
          headline: service!,
          availability: "available",
          price_cents_per_minute: 100,
          tier: "trusted",
          category_slugs: validSlugs,
        },
        { onConflict: "user_id" },
      );
      if (palErr) throw new Error(palErr.message);
    }

    return { ok: true, role };
  });
