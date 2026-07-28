// Admin-only server functions for user and role management.
import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import {
  assertCanAssignRole,
  assertCanDeactivateUser,
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
        page: z.number().int().min(1).optional().default(1),
        perPage: z.number().int().min(1).max(100).optional().default(50),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const roleFilter = data.role ?? "all";
    const hasFilters = !!data.search?.trim() || roleFilter !== "all";
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
      supabaseAdmin.from("profiles").select("id, full_name, is_active, created_at").in("id", ids),
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
        emailConfirmed: !!u.email_confirmed_at,
        role: roleMap.get(u.id) ?? "client",
        createdAt: profile?.created_at ?? u.created_at,
      };
    });

    const filtered = filterAdminUsers(rows, data.search, roleFilter);

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

export const createTrialCode = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        label: z.string().min(1).max(100),
        unlimited: z.boolean().optional().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateTrialCodeValue();
      const { error } = await supabaseAdmin.from("trial_codes").insert({
        code,
        label: data.label.trim(),
        unlimited: data.unlimited,
        is_active: true,
      });

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
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("promo_banners").insert({
      title: data.title,
      body: data.body || null,
      image_url: data.image_url || null,
      is_visible: true,
      sort_order: data.sort_order ?? 0,
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
      await supabaseAdmin
        .from("pat_pals")
        .upsert({ user_id: data.userId }, { onConflict: "user_id", ignoreDuplicates: true });
    }

    if (data.role === "admin" || data.role === "super_admin") {
      await ensureTeamPalRecord(supabaseAdmin, data.userId);
    } else if (currentRole === "admin" || currentRole === "super_admin") {
      await supabaseAdmin
        .from("pat_pals")
        .update({ is_team: false })
        .eq("user_id", data.userId);
    }

    return { ok: true };
  });
