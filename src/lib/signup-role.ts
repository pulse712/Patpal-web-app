export type SignupRole = "client" | "pat_pal";

/** Whitelist signup metadata to customer or Pat Pal only. */
export function parseSignupRole(value: unknown): SignupRole {
  return value === "pat_pal" ? "pat_pal" : "client";
}

/** Category slug stored on signup metadata (Pat Pal only). */
export function parseSignupCategorySlug(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const record = metadata as Record<string, unknown>;
  const slug = record.category_slug;
  if (typeof slug === "string" && slug.trim()) return slug.trim();
  const slugs = record.category_slugs;
  if (Array.isArray(slugs) && typeof slugs[0] === "string" && slugs[0].trim()) {
    return slugs[0].trim();
  }
  return undefined;
}
