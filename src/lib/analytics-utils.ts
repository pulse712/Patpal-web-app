/** Count ended sessions per pal and return the top N by volume. */
export function topPalsBySessionCount(
  rows: { pal_id: string }[],
  limit = 5,
): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { pal_id } of rows) {
    counts.set(pal_id, (counts.get(pal_id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}
