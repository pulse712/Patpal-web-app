import { describe, expect, it } from "vitest";
import { walletHasUnlimitedAccess } from "./billing-guard";

describe("walletHasUnlimitedAccess", () => {
  it("ignores unlimited wallet for platform staff", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(walletHasUnlimitedAccess(future, true)).toBe(false);
  });

  it("allows unlimited wallet for regular clients", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(walletHasUnlimitedAccess(future, false)).toBe(true);
  });
});
