// Apply the role chosen at signup (client or pat_pal). Uses service role so it
// works even if the DB trigger has not been migrated yet.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import type { SignupRole } from "@/lib/signup-role";
import { normalizeCategorySlugs, resolveValidCategorySlugs } from "@/lib/categories";
import { loadDefaultPriceCents } from "@/lib/app-settings";
import { escapeLikePattern } from "@/lib/postgrest-utils";

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

export const checkDisplayNameAvailable = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ fullName: z.string().min(1).max(120) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const name = data.fullName.trim();
    if (!name) return { available: false };

    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .ilike("full_name", escapeLikePattern(name))
      .limit(20);

    if (error) throw new Error(error.message);

    const taken = (rows ?? []).some(
      (r) => (r.full_name ?? "").trim().toLowerCase() === name.toLowerCase(),
    );
    return { available: !taken };
  });

async function notifySuperAdminsOfNewPatPal(opts: { palUserId: string; service?: string }) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPatPalPendingReviewEmail } = await import("@/lib/email.server");

    const [{ data: roleRows }, { data: profile }, { data: authUser }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "super_admin"),
      supabaseAdmin.from("profiles").select("full_name").eq("id", opts.palUserId).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(opts.palUserId),
    ]);

    const adminIds = (roleRows ?? []).map((r) => r.user_id);
    if (adminIds.length === 0) return;

    const emails: string[] = [];
    for (const id of adminIds) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      if (data.user?.email) emails.push(data.user.email);
    }

    const palName = profile?.full_name?.trim() || "New Pat Pal";
    const palEmail = authUser.user?.email ?? "unknown";

    await Promise.all(
      emails.map((to) =>
        sendPatPalPendingReviewEmail({
          to,
          palName,
          palEmail,
          service: opts.service,
        }),
      ),
    );
  } catch (err) {
    console.error("[signup] failed to notify super admins:", err);
  }
}

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

    // Enforce unique display name for Pat Pals
    if (role === "pat_pal") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      const fullName = profile?.full_name?.trim() ?? "";
      if (fullName) {
        const { data: dupes } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name")
          .neq("id", userId)
          .ilike("full_name", escapeLikePattern(fullName))
          .limit(20);
        const taken = (dupes ?? []).some(
          (r) => (r.full_name ?? "").trim().toLowerCase() === fullName.toLowerCase(),
        );
        if (taken) {
          throw new Error("That display name is already taken. Please choose another name.");
        }
      }
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
      const validSlugs = await resolveValidCategorySlugs(supabaseAdmin as never, categorySlugs);
      const defaultPrice = await loadDefaultPriceCents(supabaseAdmin as never);

      const { error: palErr } = await supabaseAdmin.from("pat_pals").upsert(
        {
          user_id: userId,
          headline: service!,
          availability: "offline",
          is_approved: false,
          price_cents_per_minute: defaultPrice,
          tier: "trusted",
          category_slugs: validSlugs,
        },
        { onConflict: "user_id" },
      );
      if (palErr) {
        if (palErr.code === "23505") {
          throw new Error("That display name is already taken. Please choose another name.");
        }
        throw new Error(palErr.message);
      }

      void notifySuperAdminsOfNewPatPal({ palUserId: userId, service });
    }

    return { ok: true, role };
  });
