import { describe, expect, it } from "vitest";
import {
  assertCanDeactivateUser,
  assertCanManageRole,
  filterAdminUsers,
} from "./admin-utils";

describe("assertCanDeactivateUser", () => {
  it("blocks self-deactivation", () => {
    expect(() => assertCanDeactivateUser("u1", "u1", false)).toThrow(/cannot deactivate your own/);
  });

  it("allows self-activation", () => {
    expect(() => assertCanDeactivateUser("u1", "u1", true)).not.toThrow();
  });
});

describe("assertCanManageRole", () => {
  it("requires super admin to manage super admin role", () => {
    expect(() =>
      assertCanManageRole({
        role: "super_admin",
        action: "add",
        targetUserId: "u2",
        actorUserId: "u1",
        isSuperAdmin: false,
      }),
    ).toThrow(/super admin role/);
  });

  it("blocks removing your own admin role", () => {
    expect(() =>
      assertCanManageRole({
        role: "admin",
        action: "remove",
        targetUserId: "u1",
        actorUserId: "u1",
        isSuperAdmin: true,
      }),
    ).toThrow(/remove your own admin role/);
  });
});

describe("filterAdminUsers", () => {
  const users = [
    {
      email: "alice@example.com",
      fullName: "Alice",
      roles: ["client"] as const,
      createdAt: "2024-02-01T00:00:00.000Z",
    },
    {
      email: "bob@example.com",
      fullName: "Bob Pal",
      roles: ["pat_pal"] as const,
      createdAt: "2024-03-01T00:00:00.000Z",
    },
  ];

  it("filters by search term", () => {
    const result = filterAdminUsers(users, "bob");
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe("bob@example.com");
  });

  it("filters by role", () => {
    const result = filterAdminUsers(users, undefined, "pat_pal");
    expect(result).toHaveLength(1);
    expect(result[0]?.fullName).toBe("Bob Pal");
  });

  it("sorts newest first", () => {
    const result = filterAdminUsers(users);
    expect(result[0]?.fullName).toBe("Bob Pal");
  });
});
