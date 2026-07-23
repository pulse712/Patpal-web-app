/**
 * PatPal client Supabase project — browser-safe credentials.
 * The publishable key is meant to be public; RLS protects your data.
 * Override via VITE_SUPABASE_* or SUPABASE_* in .env when needed.
 */
export const SUPABASE_PROJECT = {
  projectId: "xhgybcyvpasmtlpscdly",
  url: "https://xhgybcyvpasmtlpscdly.supabase.co",
  publishableKey: "sb_publishable__ekddQNGwlLnHioOl2ChBA_FQ7ERc_z",
} as const;

/** @deprecated Use SUPABASE_PROJECT */
export const SUPABASE_PUBLIC = SUPABASE_PROJECT;
