import { describe, expect, it } from "vitest";
import {
  computeCreditedBalance,
  computeDebitedBalance,
  computeSessionCostCents,
  computeTopUpSeconds,
} from "./billing-utils";

describe("computeSessionCostCents", () => {
  it("charges per minute at the pal rate", () => {
    expect(computeSessionCostCents(120, 200)).toBe(400);
    expect(computeSessionCostCents(90, 100)).toBe(150);
  });

  it("rounds to nearest cent", () => {
    expect(computeSessionCostCents(61, 100)).toBe(102);
  });
});

describe("computeDebitedBalance", () => {
  it("subtracts seconds for standard wallets", () => {
    expect(computeDebitedBalance(600, 120, false)).toBe(480);
  });

  it("does not go below zero", () => {
    expect(computeDebitedBalance(60, 120, false)).toBe(0);
  });

  it("leaves unlimited wallets unchanged", () => {
    expect(computeDebitedBalance(600, 120, true)).toBe(600);
  });
});

describe("computeCreditedBalance", () => {
  it("adds purchased seconds", () => {
    expect(computeCreditedBalance(900, 600)).toBe(1500);
  });
});

describe("computeTopUpSeconds", () => {
  it("uses the $10 / 15 min rate by default", () => {
    expect(computeTopUpSeconds(1000)).toBe(900);
  });
});
