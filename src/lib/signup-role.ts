export type SignupRole = "client" | "pat_pal";

/** Whitelist signup metadata to customer or Pat Pal only. */
export function parseSignupRole(value: unknown): SignupRole {
  return value === "pat_pal" ? "pat_pal" : "client";
}

/** Category slug stored on signup metadata (Pat Pal only). */
export function parseSignupCategorySlug(metadata: unknown): string | undefined {
  const slugs = parseSignupCategorySlugs(metadata);
  return slugs[0];
}

/** All category slugs stored on signup metadata (Pat Pal only). */
export function parseSignupCategorySlugs(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const record = metadata as Record<string, unknown>;

  const rawSlugs = record.category_slugs;
  if (Array.isArray(rawSlugs)) {
    return rawSlugs
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().toLowerCase());
  }
  if (typeof rawSlugs === "string" && rawSlugs.trim()) {
    return rawSlugs
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  const slug = record.category_slug;
  if (typeof slug === "string" && slug.trim()) return [slug.trim().toLowerCase()];
  return [];
}

/** Service description / headline (Pat Pal only). */
export function parseSignupService(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const record = metadata as Record<string, unknown>;
  for (const key of ["service", "headline"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
