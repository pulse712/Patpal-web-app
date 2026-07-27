import { describe, expect, it } from "vitest";
import { topPalsBySessionCount } from "./analytics-utils";

describe("topPalsBySessionCount", () => {
  it("returns pals sorted by session count", () => {
    const rows = [
      { pal_id: "a" },
      { pal_id: "b" },
      { pal_id: "a" },
      { pal_id: "c" },
      { pal_id: "a" },
      { pal_id: "b" },
    ];

    expect(topPalsBySessionCount(rows)).toEqual([
      { id: "a", count: 3 },
      { id: "b", count: 2 },
      { id: "c", count: 1 },
    ]);
  });

  it("respects the limit", () => {
    const rows = [{ pal_id: "a" }, { pal_id: "b" }, { pal_id: "c" }];
    expect(topPalsBySessionCount(rows, 2)).toEqual([
      { id: "a", count: 1 },
      { id: "b", count: 1 },
    ]);
  });
});
