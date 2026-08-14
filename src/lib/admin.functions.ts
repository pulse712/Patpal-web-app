// Admin-only server functions for user and role management.
import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import {
  assertCanAssignRole,
  assertCanDeactivateUser,
  assertCanDeleteUser,
  filterAdminUsers,
  type AppRole,
} from "@/lib/admin-utils";
import { assertAdmin } from "@/lib/admin-guard";
import { ensureTeamPalRecord } from "@/lib/team.functions";

export const listAdminUsers = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        search: z.string().max(100).optional(),
        role: z.enum(["client", "pat_pal", "admin", "super_admin", "all"]).optional(),
        pendingOnly: z.boolean().optional(),
        page: z.number().int().min(1).optional().default(1),
        perPage: z.number().int().min(1).max(100).optional().default(50),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const roleFilter = data.role ?? "all";
    const hasFilters = !!data.search?.trim() || roleFilter !== "all" || !!data.pendingOnly;
    const fetchPerPage = hasFilters ? 1000 : data.perPage;

    const { data: authList, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      page: hasFilters ? 1 : data.page,
      perPage: fetchPerPage,
    });
    if (authError) throw new Error(authError.message);

    const users = authList?.users ?? [];
    const authTotal = authList?.total ?? users.length;
    const ids = users.map((u) => u.id);

    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, is_active, approval_status, created_at")
        .in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const roleMap = new Map<string, AppRole>();
    for (const r of roles ?? []) {
      roleMap.set(r.user_id, r.role as AppRole);
    }

    const rows = users.map((u) => {
      const profile = profileMap.get(u.id);
      return {
        id: u.id,
        email: u.email ?? "",
        fullName: profile?.full_name ?? "",
        isActive: profile?.is_active ?? true,
        approvalStatus: (profile?.approval_status ?? "approved") as
          "pending" | "approved" | "rejected",
        emailConfirmed: !!u.email_confirmed_at,
        role: roleMap.get(u.id) ?? "client",
        createdAt: profile?.created_at ?? u.created_at,
      };
    });

    const filtered = filterAdminUsers(rows, data.search, roleFilter, data.pendingOnly);

    if (hasFilters) {
      const start = (data.page - 1) * data.perPage;
      const pageUsers = filtered.slice(start, start + data.perPage);
      return {
        users: pageUsers,
        total: filtered.length,
        page: data.page,
        perPage: data.perPage,
        hasMore: start + data.perPage < filtered.length,
      };
    }

    return {
      users: filtered,
      total: authTotal,
      page: data.page,
      perPage: data.perPage,
      hasMore: users.length === data.perPage && authTotal > data.page * data.perPage,
    };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z.object({ userId: z.string().uuid(), isActive: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    assertCanDeactivateUser(data.userId, context.userId, data.isActive);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: data.isActive, updated_at: new Date().toISOString() })
      .eq("id", data.userId);

    if (error) throw new Error(error.message);

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.isActive ? "none" : "876600h",
    });
    if (authError) throw new Error(authError.message);

    return { ok: true };
  });

/**
 * Permanently deletes a user's account (auth + all owned data via cascade),
 * freeing their email for a fresh signup. Irreversible.
 */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { isSuperAdmin } = await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .limit(1);
    if (roleError) throw new Error(roleError.message);
    const targetRole = (roleRows?.[0]?.role as AppRole | undefined) ?? "client";

    assertCanDeleteUser({
      targetUserId: data.userId,
      actorUserId: context.userId,
      targetRole,
      isSuperAdmin,
    });

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/** Approve or reject a pending signup — gates whether the account can sign in at all. */
export const setUserApprovalStatus = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z.object({ userId: z.string().uuid(), status: z.enum(["approved", "rejected"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ approval_status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.userId);

    if (error) throw new Error(error.message);

    if (data.status === "approved") {
      await supabaseAdmin
        .from("pat_pals")
        .update({ is_approved: true, availability: "available", updated_at: new Date().toISOString() })
        .eq("user_id", data.userId);
    }

    return { ok: true };
  });

/** Manually confirm a user's email when Supabase mail is rate-limited or undelivered. */
export const confirmUserEmail = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email_confirm: true,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/** Pending Pat Pals waiting for approval — shown to admins on login. */
export const listPendingPatPals = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: pals, error: palError } = await supabaseAdmin
      .from("pat_pals")
      .select("user_id")
      .eq("is_approved", false);
    if (palError) throw new Error(palError.message);
    const ids = (pals ?? []).map((p) => p.user_id);
    if (ids.length === 0) return { pals: [] as { userId: string; name: string }[] };

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .eq("approval_status", "pending");
    if (profileError) throw new Error(profileError.message);

    return {
      pals: (profiles ?? []).map((p) => ({
        userId: p.id,
        name: p.full_name?.trim() || "New Pat Pal",
      })),
    };
  });

export const listTrialCodes = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("trial_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { codes: data ?? [] };
  });

const TRIAL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TRIAL_CODE_LENGTH = 10;

function generateTrialCodeValue(): string {
  const bytes = randomBytes(TRIAL_CODE_LENGTH);
  return Array.from(bytes, (b) => TRIAL_CODE_CHARS[b % TRIAL_CODE_CHARS.length]).join("");
}

/** Accept ISO datetime or YYYY-MM-DD from date inputs. */
function optionalDateString(endOfDay = false) {
  return z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v == null || v === "") return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return endOfDay ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
      }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
        return z.NEVER;
      }
      return d.toISOString();
    });
}

export const createTrialCode = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        label: z.string().min(1).max(100),
        code: z
          .string()
          .min(4)
          .max(32)
          .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, numbers, _ and -")
          .optional(),
        unlimited: z.boolean().optional().default(false),
        startsAt: optionalDateString(false),
        expiresAt: optionalDateString(true),
        grantMinutes: z.number().int().min(1).max(10080).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.startsAt && data.expiresAt && new Date(data.startsAt) > new Date(data.expiresAt)) {
      throw new Error("Start date must be before end date");
    }

    const grantSeconds =
      data.unlimited || data.grantMinutes == null ? null : data.grantMinutes * 60;

    const tryInsert = async (code: string) => {
      const { error } = await supabaseAdmin.from("trial_codes").insert({
        code,
        label: data.label.trim(),
        unlimited: data.unlimited,
        is_active: true,
        starts_at: data.startsAt,
        expires_at: data.expiresAt,
        grant_seconds: grantSeconds,
      });
      return error;
    };

    if (data.code?.trim()) {
      const code = data.code.trim().toUpperCase();
      const error = await tryInsert(code);
      if (error) {
        if (error.code === "23505") throw new Error("That code already exists");
        throw new Error(error.message);
      }
      return { ok: true, code };
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateTrialCodeValue();
      const error = await tryInsert(code);
      if (!error) return { ok: true, code };
      if (error.code === "23505") continue;
      throw new Error(error.message);
    }

    throw new Error("Could not generate a unique code. Please try again.");
  });

export const setTrialCodeActive = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!data.isActive) {
      const { error: revokeError } = await supabaseAdmin.rpc("revoke_trial_code_benefits", {
        p_trial_code_id: data.id,
      });
      if (revokeError) throw new Error(revokeError.message);
    }

    const { error } = await supabaseAdmin
      .from("trial_codes")
      .update({ is_active: data.isActive })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTrialCode = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: revokeError } = await supabaseAdmin.rpc("revoke_trial_code_benefits", {
      p_trial_code_id: data.id,
    });
    if (revokeError) throw new Error(revokeError.message);

    const { error } = await supabaseAdmin.from("trial_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPromoBanners = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("promo_banners")
      .select("*")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return { banners: data ?? [] };
  });

export const createPromoBanner = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        title: z.string().min(1).max(200),
        body: z.string().max(1000).optional(),
        image_url: z.string().url().max(2000).optional(),
        sort_order: z.number().int().min(0).optional(),
        startsAt: optionalDateString(false),
        endsAt: optionalDateString(true),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.startsAt && data.endsAt && new Date(data.startsAt) > new Date(data.endsAt)) {
      throw new Error("Banner start must be before end");
    }
    const { error } = await supabaseAdmin.from("promo_banners").insert({
      title: data.title,
      body: data.body || null,
      image_url: data.image_url || null,
      is_visible: true,
      sort_order: data.sort_order ?? 0,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setPromoBannerVisible = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), isVisible: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("promo_banners")
      .update({ is_visible: data.isVisible })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePromoBanner = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("promo_banners").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setPatPalApproved = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        isApproved: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("pat_pals")
      .update({
        is_approved: data.isApproved,
        availability: data.isApproved ? "available" : "offline",
        updated_at: now,
      })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    // Listing (is_approved) used to be separate from login (approval_status),
    // so approving a Pal on the Pals tab left them locked out as "pending".
    if (data.isApproved) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({ approval_status: "approved", updated_at: now })
        .eq("id", data.userId);
      if (profileError) throw new Error(profileError.message);
    }

    return { ok: true };
  });

export const setPatPalPrice = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        priceCentsPerMinute: z.number().int().min(0).max(100000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("pat_pals")
      .update({
        price_cents_per_minute: data.priceCentsPerMinute,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAppPricingSettings = createServerFn({ method: "GET" })
  .middleware([...serverAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadCreditPackages, loadDefaultPriceCents } = await import("@/lib/app-settings");
    const [packages, defaultPriceCents] = await Promise.all([
      loadCreditPackages(supabaseAdmin),
      loadDefaultPriceCents(supabaseAdmin),
    ]);
    return { packages, defaultPriceCents };
  });

export const saveAppPricingSettings = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        defaultPriceCents: z.number().int().min(0).max(100000),
        packages: z
          .array(
            z.object({
              id: z.string().min(1).max(64),
              label: z.string().min(1).max(100),
              seconds: z
                .number()
                .int()
                .min(60)
                .max(86400 * 30),
              amount: z.number().int().min(0).max(1_000_000),
            }),
          )
          .min(1)
          .max(12),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { error: e1 } = await supabaseAdmin.from("app_settings").upsert({
      key: "default_price_cents_per_minute",
      value: data.defaultPriceCents,
      updated_at: now,
    });
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabaseAdmin.from("app_settings").upsert({
      key: "credit_packages",
      value: data.packages,
      updated_at: now,
    });
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["client", "pat_pal", "admin", "super_admin"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { isSuperAdmin } = await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: currentRows, error: currentError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .limit(1);
    if (currentError) throw new Error(currentError.message);

    const currentRole = (currentRows?.[0]?.role as AppRole | undefined) ?? "client";

    assertCanAssignRole({
      role: data.role,
      currentRole,
      targetUserId: data.userId,
      actorUserId: context.userId,
      isSuperAdmin,
    });

    if (currentRole === data.role) return { ok: true };

    const { error: deleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (deleteError) throw new Error(deleteError.message);

    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (insertError) throw new Error(insertError.message);

    if (data.role === "pat_pal") {
      // ignoreDuplicates must be false (the default) here — an admin
      // directly granting the pat_pal role is meant to approve them even if
      // they already have a pending row from self-signup. With
      // ignoreDuplicates: true this upsert was a no-op on conflict, so
      // is_approved silently stayed false despite the admin's action.
      await supabaseAdmin
        .from("pat_pals")
        .upsert(
          { user_id: data.userId, is_approved: true, availability: "available" },
          { onConflict: "user_id" },
        );
      await supabaseAdmin
        .from("profiles")
        .update({ approval_status: "approved" })
        .eq("id", data.userId);
    }

    if (data.role === "admin" || data.role === "super_admin") {
      await ensureTeamPalRecord(supabaseAdmin, data.userId);
      // Admins/super_admins must never be blocked by the signup approval
      // gate, even if they were promoted while their own signup was still
      // pending review.
      await supabaseAdmin
        .from("profiles")
        .update({ approval_status: "approved" })
        .eq("id", data.userId);
    } else if (currentRole === "admin" || currentRole === "super_admin") {
      await supabaseAdmin.from("pat_pals").update({ is_team: false }).eq("user_id", data.userId);
    }

    return { ok: true };
  });
