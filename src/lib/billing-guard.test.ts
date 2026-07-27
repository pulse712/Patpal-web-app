import { describe, expect, it } from "vitest";
import { walletHasUnlimitedAccess } from "./billing-guard";

describe("walletHasUnlimitedAccess", () => {
  it("grants unlimited calls for platform staff", () => {
    expect(walletHasUnlimitedAccess(null, true)).toBe(true);
  });

  it("allows unlimited wallet for regular clients", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(walletHasUnlimitedAccess(future, false)).toBe(true);
  });
});
