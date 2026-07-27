import { describe, expect, it } from "vitest";
import {
  filterBrowsePals,
  parseMaxPriceParam,
  parseTierParam,
  paramToMaxPrice,
} from "./browse-utils";

const pals = [
  {
    user_id: "1",
    headline: "Career coach",
    service_range: "Career transitions",
    price_cents_per_minute: 0,
    tier: "trusted",
    category_slugs: ["career-advice"],
    profiles: {
      full_name: "Alice",
      avatar_url: null,
      bio: null,
      introduction: null,
      languages: ["English"],
    },
  },
  {
    user_id: "2",
    headline: "Business mentor",
    service_range: null,
    price_cents_per_minute: 250,
    tier: "expert",
    category_slugs: ["business-coaching"],
    profiles: {
      full_name: "Bob",
      avatar_url: null,
      bio: null,
      introduction: null,
      languages: ["English"],
    },
  },
  {
    user_id: "3",
    headline: "Motivation buddy",
    service_range: null,
    price_cents_per_minute: 150,
    tier: "premium",
    category_slugs: ["motivation", "career-advice"],
    profiles: {
      full_name: "Cara",
      avatar_url: null,
      bio: null,
      introduction: null,
      languages: ["English", "Spanish"],
    },
  },
];

describe("filterBrowsePals", () => {
  it("filters by category slug", () => {
    const result = filterBrowsePals(pals, { category: "career-advice" });
    expect(result.map((p) => p.user_id)).toEqual(["1", "3"]);
  });

  it("filters by tier", () => {
    const result = filterBrowsePals(pals, { tier: "expert" });
    expect(result).toHaveLength(1);
    expect(result[0]?.profiles?.full_name).toBe("Bob");
  });

  it("filters free pals only", () => {
    const result = filterBrowsePals(pals, { maxPriceCents: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]?.user_id).toBe("1");
  });

  it("filters by max price", () => {
    const result = filterBrowsePals(pals, { maxPriceCents: 200 });
    expect(result.map((p) => p.user_id)).toEqual(["1", "3"]);
  });

  it("filters by search query", () => {
    const result = filterBrowsePals(pals, { query: "business" });
    expect(result).toHaveLength(1);
    expect(result[0]?.user_id).toBe("2");
  });

  it("includes offline pals", () => {
    const result = filterBrowsePals(
      [{ ...pals[0]!, availability: "offline" }],
      {},
    );
    expect(result).toHaveLength(1);
  });
});

describe("search param helpers", () => {
  it("parses tier values", () => {
    expect(parseTierParam("premium")).toBe("premium");
    expect(parseTierParam("invalid")).toBeUndefined();
  });

  it("parses max price values", () => {
    expect(parseMaxPriceParam("free")).toBe(0);
    expect(parseMaxPriceParam("200")).toBe(200);
    expect(paramToMaxPrice("free")).toBe(0);
    expect(paramToMaxPrice("all")).toBeUndefined();
  });
});
