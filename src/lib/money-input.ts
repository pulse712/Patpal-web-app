/** Parse a dollar field the user is still typing. Empty / incomplete stays as a draft. */
export function parseDollarToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "-") return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

export function centsToDollarInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
