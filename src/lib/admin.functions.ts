// Admin-only server functions for user and role management.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        search: z.string().max(100).optional(),
        role: z.enum(["client", "pat_pal", "admin", "super_admin", "all"]).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authList, error: authError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (authError) throw new Error(authError.message);

    const users = authList?.users ?? [];
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
    };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
        await supabaseAdmin.from("pat_pals").upsert(
          { user_id: data.userId },
          { onConflict: "user_id", ignoreDuplicates: true },
        );
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
