import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const redirect = vi.fn((opts: unknown) => {
  const err = new Error("REDIRECT");
  Object.assign(err, { redirectOpts: opts });
  throw err;
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession } },
}));

vi.mock("@tanstack/react-router", () => ({ redirect }));

describe("requireAuthBeforeLoad", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { href: "http://localhost/" } });
  });

  it("returns userId when a session exists", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-123" } } },
    });

    const { requireAuthBeforeLoad } = await import("./auth-guard");
    await expect(requireAuthBeforeLoad()).resolves.toEqual({ userId: "user-123" });
  });

  it("redirects to /auth when unauthenticated", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    const { requireAuthBeforeLoad } = await import("./auth-guard");
    await expect(requireAuthBeforeLoad()).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });

  it("no-ops during SSR", async () => {
    vi.unstubAllGlobals();
    const { requireAuthBeforeLoad } = await import("./auth-guard");
    await expect(requireAuthBeforeLoad()).resolves.toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });
});
