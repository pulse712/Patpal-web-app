/**
 * Escapes PostgREST/Postgres LIKE and ILIKE wildcard metacharacters (`%`,
 * `_`) in user-supplied input before interpolating it into a `.like()` /
 * `.ilike()` filter string. Without this, a value containing `_` (matches
 * any single character) or `%` (matches any run of characters) can collide
 * with unrelated rows — e.g. a display name "Jane_Doe" or a trial code
 * "SUMMER_25" would otherwise match "JaneXDoe" / any code sharing the same
 * prefix/suffix around that position.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, (ch) => `\\${ch}`);
}

/**
 * True only for a genuine "column does not exist" Postgres error (code
 * 42703, undefined_column) — used to detect "this migration hasn't been
 * applied to this database yet" and fall back to querying without the new
 * column. Deliberately precise rather than a loose substring match on the
 * word "column": several call sites use this check to decide whether it's
 * safe to drop a security-relevant filter (e.g. is_approved) in the
 * fallback query, and a false positive from an unrelated error would incorrectly
 * broaden what that fallback returns.
 */
export function isMissingColumnError(
  error: { code?: string; message?: string } | string | null | undefined,
): boolean {
  if (!error) return false;
  if (typeof error === "string") return /column .* does not exist/i.test(error);
  if (error.code === "42703") return true;
  return /column .* does not exist/i.test(error.message ?? "");
}
