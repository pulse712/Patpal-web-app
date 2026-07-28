export const CATEGORIES_MAX = 8;

export type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  emoji: string | null;
};

export function normalizeCategorySlugs(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= CATEGORIES_MAX) break;
  }
  return out;
}

export async function resolveValidCategorySlugs(
  supabaseAdmin: {
    from: (table: string) => {
      select: (cols: string) => {
        in: (
          col: string,
          values: string[],
        ) => Promise<{ data: { slug: string }[] | null; error: { message: string } | null }>;
      };
    };
  },
  raw: string[],
): Promise<string[]> {
  const normalized = normalizeCategorySlugs(raw);
  if (normalized.length === 0) {
    throw new Error("Choose at least one support category.");
  }

  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("slug")
    .in("slug", normalized);
  if (error) throw new Error(error.message);

  const valid = new Set((data ?? []).map((c) => c.slug));
  if (normalized.some((slug) => !valid.has(slug))) {
    throw new Error("One or more categories are invalid.");
  }

  return normalized;
}
