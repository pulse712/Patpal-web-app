export const INTRODUCTION_MAX = 1000;
export const BIO_MAX = 280;
export const LANGUAGES_MIN = 1;
export const LANGUAGES_MAX = 10;
export const HEADLINE_MAX = 120;
export const SERVICE_RANGE_MAX = 120;

export const SUGGESTED_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Mandarin",
  "Cantonese",
  "Japanese",
  "Korean",
  "Arabic",
  "Hindi",
  "Tagalog",
  "Vietnamese",
  "Italian",
  "Dutch",
] as const;

export function normalizeLanguages(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= LANGUAGES_MAX) break;
  }
  return out;
}

export function validateProfileFields(opts: {
  fullName: string;
  bio: string;
  introduction: string;
  languages: string[];
  headline?: string;
  serviceRange?: string;
  pricePerMinute?: number;
  isListable: boolean;
}) {
  if (!opts.fullName.trim()) {
    throw new Error("Full name is required.");
  }
  if (opts.bio.length > BIO_MAX) {
    throw new Error(`Bio must be ${BIO_MAX} characters or less.`);
  }
  if (opts.introduction.length > INTRODUCTION_MAX) {
    throw new Error(`Introduction must be ${INTRODUCTION_MAX} characters or less.`);
  }

  const languages = normalizeLanguages(opts.languages);
  if (languages.length < LANGUAGES_MIN) {
    throw new Error(`Add at least ${LANGUAGES_MIN} language.`);
  }
  if (languages.length > LANGUAGES_MAX) {
    throw new Error(`You can add up to ${LANGUAGES_MAX} languages.`);
  }

  if (opts.isListable) {
    if (!opts.headline?.trim()) {
      throw new Error("Headline is required for your public listing.");
    }
    if ((opts.headline?.length ?? 0) > HEADLINE_MAX) {
      throw new Error(`Headline must be ${HEADLINE_MAX} characters or less.`);
    }
    if ((opts.serviceRange?.length ?? 0) > SERVICE_RANGE_MAX) {
      throw new Error(`Range must be ${SERVICE_RANGE_MAX} characters or less.`);
    }
    if (opts.pricePerMinute !== undefined && opts.pricePerMinute < 0) {
      throw new Error("Rate cannot be negative.");
    }
  }

  return { languages };
}
