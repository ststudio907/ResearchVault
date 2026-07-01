// src/utils/citekey.ts
//
// Citekey formatting and generation. The output shape is the standard
// `authorYYYYkeyword` form (with `-2 -3 …` suffix on collisions) — e.g.
// `smith2023transformer`. Used by `PaperService.createManual` so the user
// gets a preview while filling out the import modal.
//
// Kept dependency-free: diacritics collapse via Unicode NFD, non-ASCII
// non-Latin falls back to a transliteration-safe prefix. No external lib.
//

/**
 * Compose a base citekey from raw metadata. Strips non-portable characters
 * so the resulting string is always a safe filename slug.
 *
 * Rules:
 *  - Author's last name lower-cased, diacritics collapsed to base letters.
 *  - 4-digit year, `s.a.` (no year) → "nd".
 *  - First significant title word, lower-cased, diacritics collapsed.
 *
 * Example: `composeCitekey({ lastName: 'Müller', year: 2023, title: 'On Attention' })`
 * → `"muller2023attention"`.
 */
export function composeCitekey(input: {
  lastName?: string;
  year?: number;
  title?: string;
}): string {
  const author = slugify(input.lastName ?? 'anon');
  const yearSlot = Number.isFinite(input.year) ? String(input.year) : 'nd';
  const keyword = firstKeyword(input.title ?? '');
  // author + year is always required per D7; the keyword is best-effort.
  return [author, yearSlot, keyword].filter(Boolean).join('');
}

/**
 * Generate a unique citekey by appending a numeric suffix on collision.
 * Caller supplies `isTaken` so we can ask the in-memory index (no re-reads).
 */
export function generateUniqueCitekey(
  parts: { lastName?: string; year?: number; title?: string },
  isTaken: (candidate: string) => boolean,
): string {
  const base = composeCitekey(parts);
  // Worst-case we'll try a small number of suffixes; collision storms are
  // rare because the (author, year, keyword) tuple is usually unique.
  let candidate = base;
  for (let i = 2; i < 100; i += 1) {
    if (!isTaken(candidate)) return candidate;
    candidate = `${base}-${i}`;
  }
  // Last-resort: timestamp suffix. Should never be reached in practice.
  return `${base}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in',
  'into', 'of', 'on', 'or', 'over', 'the', 'to', 'with', 'within',
  'without', 'via', 'versus', 'vs',
]);

/** ASCII-slugify a token: collapse diacritics, drop non-`[a-z0-9]`. */
export function slugify(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // NFD: "é" → "e" + combining acute. Strip the combining marks.
  const ascii = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Non-Latin scripts (CJK, Cyrillic, etc.) can't letter-digit-slug without
  // a transliteration library we deliberately avoid. Keep the first 4
  // unicode letters/digits as a best-effort anchor.
  const lowered = ascii.toLowerCase();
  const pure = lowered.replace(/[^a-z0-9]+/g, '');
  if (pure) return pure;
  // Fallback: keep the first 4 word chars (any script), digits preserved.
  const anchor = trimmed.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase().slice(0, 4);
  return anchor || 'anon';
}

/** First "significant" word from a title — strips stopwords and punctuation. */
function firstKeyword(title: string): string {
  const tokens = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/g)
    .filter((t) => t && !STOPWORDS.has(t));
  return tokens[0] ?? '';
}
