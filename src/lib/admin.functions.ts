// Admin-only server functions for user and role management.
import { createServerFn } from "@tanstack/react-start";
import { serverAuth } from "@/lib/server-auth";
import { z } from "zod";
import {
  assertCanDeactivateUser,
  assertCanManageRole,
  filterAdminUsers,
  type AppRole,
} from "@/lib/admin-utils";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isAdmin && !isSuperAdmin) throw new Error("Unauthorized");
  return { isSuperAdmin: !!isSuperAdmin };
}

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

    const { data: authList, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      page: data.page,
      perPage: data.perPage,
    });
    if (authError) throw new Error(authError.message);

    const users = authList?.users ?? [];
    const total = authList?.total ?? users.length;
    const ids = users.map((u) => u.id);

    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, is_active, created_at").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const rolesMap = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const list = rolesMap.get(r.user_id) ?? [];
      list.push(r.role as AppRole);
      rolesMap.set(r.user_id, list);
    }

    const roleFilter = data.role ?? "all";

    const rows = users.map((u) => {
      const profile = profileMap.get(u.id);
      const userRoles = rolesMap.get(u.id) ?? ["client"];
      return {
        id: u.id,
        email: u.email ?? "",
        fullName: profile?.full_name ?? "",
        isActive: profile?.is_active ?? true,
        roles: userRoles,
        createdAt: profile?.created_at ?? u.created_at,
      };
    });

    return {
      users: filterAdminUsers(rows, data.search, roleFilter),
      total,
      page: data.page,
      perPage: data.perPage,
      hasMore: users.length === data.perPage && total > data.page * data.perPage,
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

export const createTrialCode = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z
      .object({
        code: z.string().min(1).max(64),
        label: z.string().max(100).optional(),
        unlimited: z.boolean().optional().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("trial_codes").insert({
      code: data.code.trim().toUpperCase(),
      label: data.label || null,
      unlimited: data.unlimited,
      is_active: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTrialCodeActive = createServerFn({ method: "POST" })
  .middleware([...serverAuth])
  .validator((data: unknown) =>
    z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        body: z.string().max(500).optional(),
        cta_label: z.string().max(100).optional(),
        cta_href: z.string().max(500).optional(),
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
      cta_label: data.cta_label || null,
      cta_href: data.cta_href || null,
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
        action: z.enum(["add", "remove"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { isSuperAdmin } = await assertAdmin(context.userId);

    assertCanManageRole({
      role: data.role,
      action: data.action,
      targetUserId: data.userId,
      actorUserId: context.userId,
      isSuperAdmin,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.action === "add") {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);

      if (data.role === "pat_pal") {
        await supabaseAdmin
          .from("pat_pals")
          .upsert({ user_id: data.userId }, { onConflict: "user_id", ignoreDuplicates: true });
      }
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);

      // Every user should keep at least the client role
      if (data.role !== "client") {
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: data.userId, role: "client" }, { onConflict: "user_id,role" });
      }
    }

    return { ok: true };
  });
