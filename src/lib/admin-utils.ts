export type AppRole = "client" | "pat_pal" | "admin" | "super_admin";

export function assertCanDeactivateUser(
  targetUserId: string,
  actorUserId: string,
  isActive: boolean,
): void {
  if (!isActive && targetUserId === actorUserId) {
    throw new Error("You cannot deactivate your own account");
  }
}

export function assertCanManageRole(opts: {
  role: AppRole;
  action: "add" | "remove";
  targetUserId: string;
  actorUserId: string;
  isSuperAdmin: boolean;
}): void {
  if (opts.role === "super_admin" && !opts.isSuperAdmin) {
    throw new Error("Only super admins can manage the super admin role");
  }

  if (
    opts.targetUserId === opts.actorUserId &&
    opts.action === "remove" &&
    (opts.role === "admin" || opts.role === "super_admin")
  ) {
    throw new Error("You cannot remove your own admin role");
  }
}

export function filterAdminUsers<
  T extends { email: string; fullName: string; roles: AppRole[]; createdAt?: string | null },
>(users: T[], search?: string, roleFilter: AppRole | "all" = "all"): T[] {
  let rows = users;

  const q = search?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) => r.email.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q),
    );
  }

  if (roleFilter !== "all") {
    rows = rows.filter((r) => r.roles.includes(roleFilter));
  }

  return [...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
