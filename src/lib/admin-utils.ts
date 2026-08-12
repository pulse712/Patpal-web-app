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

export function assertCanDeleteUser(opts: {
  targetUserId: string;
  actorUserId: string;
  targetRole: AppRole;
  isSuperAdmin: boolean;
}): void {
  if (opts.targetUserId === opts.actorUserId) {
    throw new Error("You cannot delete your own account here — use Profile settings instead");
  }
  if ((opts.targetRole === "admin" || opts.targetRole === "super_admin") && !opts.isSuperAdmin) {
    throw new Error("Only super admins can delete an admin account");
  }
}

export function assertCanAssignRole(opts: {
  role: AppRole;
  currentRole: AppRole;
  targetUserId: string;
  actorUserId: string;
  isSuperAdmin: boolean;
}): void {
  if (opts.role === "super_admin" && !opts.isSuperAdmin) {
    throw new Error("Only super admins can assign the super admin role");
  }

  if (
    opts.targetUserId === opts.actorUserId &&
    opts.role !== opts.currentRole &&
    (opts.currentRole === "admin" || opts.currentRole === "super_admin")
  ) {
    throw new Error("You cannot change your own admin role");
  }
}

export function filterAdminUsers<
  T extends {
    email: string;
    fullName: string;
    role: AppRole;
    createdAt?: string | null;
    approvalStatus?: "pending" | "approved" | "rejected";
  },
>(users: T[], search?: string, roleFilter: AppRole | "all" = "all", pendingOnly?: boolean): T[] {
  let rows = users;

  const q = search?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) => r.email.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q),
    );
  }

  if (roleFilter !== "all") {
    rows = rows.filter((r) => r.role === roleFilter);
  }

  if (pendingOnly) {
    rows = rows.filter((r) => r.approvalStatus === "pending");
  }

  return [...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
