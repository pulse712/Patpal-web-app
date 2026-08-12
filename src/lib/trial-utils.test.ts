import { describe, expect, it } from "vitest";
import {
  assertTrialCodeRedeemable,
  buildTrialNote,
  computeTrialBalance,
  normalizeTrialCode,
  resolveTrialGrantSeconds,
  TRIAL_GRANT_SECONDS,
} from "./trial-utils";

const validCode = {
  code: "WELCOME",
  label: "Launch promo",
  is_active: true,
  expires_at: null,
  starts_at: null,
  grant_seconds: null,
  unlimited: false,
};

describe("normalizeTrialCode", () => {
  it("trims and uppercases input", () => {
    expect(normalizeTrialCode("  welcome  ")).toBe("WELCOME");
  });
});

describe("assertTrialCodeRedeemable", () => {
  it("accepts a valid active code", () => {
    expect(() => assertTrialCodeRedeemable(validCode, false)).not.toThrow();
  });

  it("rejects missing or inactive codes", () => {
    expect(() => assertTrialCodeRedeemable(null, false)).toThrow(/Invalid or inactive/);
    expect(() => assertTrialCodeRedeemable({ ...validCode, is_active: false }, false)).toThrow(
      /Invalid or inactive/,
    );
  });

  it("rejects not-yet-started codes", () => {
    expect(() =>
      assertTrialCodeRedeemable(
        { ...validCode, starts_at: "2030-01-01T00:00:00.000Z" },
        false,
        new Date("2024-01-01T00:00:00.000Z"),
      ),
    ).toThrow(/not active yet/);
  });

  it("rejects expired codes", () => {
    expect(() =>
      assertTrialCodeRedeemable(
        { ...validCode, expires_at: "2020-01-01T00:00:00.000Z" },
        false,
        new Date("2024-01-01T00:00:00.000Z"),
      ),
    ).toThrow(/expired/);
  });

  it("rejects duplicate redemptions", () => {
    expect(() => assertTrialCodeRedeemable(validCode, true)).toThrow(/already redeemed/);
  });
});

describe("resolveTrialGrantSeconds", () => {
  it("uses grant_seconds when set", () => {
    expect(resolveTrialGrantSeconds({ ...validCode, grant_seconds: 120 })).toBe(120);
  });

  it("falls back to default hour", () => {
    expect(resolveTrialGrantSeconds(validCode)).toBe(TRIAL_GRANT_SECONDS);
  });
});

describe("buildTrialNote", () => {
  it("uses the label when provided", () => {
    expect(buildTrialNote("VIP", "Friends", false)).toBe("Trial code VIP: Friends");
  });

  it("falls back for unlimited codes", () => {
    expect(buildTrialNote("VIP", null, true)).toBe("Trial code VIP: unlimited");
  });
});

describe("computeTrialBalance", () => {
  it("grants configured seconds", () => {
    expect(computeTrialBalance(300, 120)).toBe(420);
  });

  it("defaults to TRIAL_GRANT_SECONDS when called with a single argument", () => {
    expect(computeTrialBalance(300)).toBe(300 + TRIAL_GRANT_SECONDS);
  });
});
