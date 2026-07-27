export type SignupRole = "client" | "pat_pal";

/** Whitelist signup metadata to customer or Pat Pal only. */
export function parseSignupRole(value: unknown): SignupRole {
  return value === "pat_pal" ? "pat_pal" : "client";
}
