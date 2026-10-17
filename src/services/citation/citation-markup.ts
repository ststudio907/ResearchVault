// src/services/citation/citation-markup.ts
//
// Pure parsing helpers for D35's `[@citekey]` markup (3.2 C2 follow-up).
// The markup is intentionally inert text — it resolves at Pandoc export —
// but inside the vault we need to FIND it so the reading-view renderer
// (`ui/citation-link-renderer.ts`) can decorate matches as clickable links
// to paper notes.
//
// This module has NO Obsidian imports on purpose: vitest exercises it
// directly and Node cannot resolve the `obsidian` runtime module.

/**
 * A citation key previously composed by `utils/citekey.ts` is `[a-zA-Z0-9-]`,
 * first char alphanumeric. We accept exactly that charset — being stricter
 * than Pandoc's key grammar here is safe (we only ever need to recognize
 * keys we may have generated or read back) and avoids false positives on
 * ordinary square-bracket prose.
 */
export const CITATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const CITATION_BLOCK_RE =
  /\[@([A-Za-z0-9][A-Za-z0-9-]*)(?:\s*;\s*@[A-Za-z0-9][A-Za-z0-9-]*)*\]/g;

const KEY_IN_BLOCK_RE = /@([A-Za-z0-9][A-Za-z0-9-]*)/g;

/**
 * Bare inline narrative form `@key` ("As @vaswani2017attention show, …") —
 * the form `formatCitationMarkup(key, 'inline')` emits. The lookbehind
 * refuses matches immediately after `[` (the head of a bracketed block —
 * matching there would double-decorate), after an alphanum (`user@gmail.com`),
 * after `@` (chained handles), and after `/` (URL user paths). Keys inside
 * multi-key blocks (preceded by `; `) pass the lookbehind but are dropped by
 * the block-overlap filter in `findCitationMatches`.
 *
 * Accepted tradeoff, mirroring Pandoc itself: prose like "ping @someone"
 * matches and renders as an unresolved (muted) key rather than being
 * silently skipped during scanning.
 */
const INLINE_KEY_RE = /(?<![[A-Za-z0-9/@])@([A-Za-z0-9][A-Za-z0-9-]*)/g;

/** One `[@key]` / `[@a; @b]` group or bare `@key` found in a text run. */
export interface CitationMatch {
  /** Character offset where the block starts. */
  start: number;
  /** Character offset one past the block end. */
  end: number;
  /** The full matched span: `[@a2019; @b202p]` for a group, `@a2019` inline. */
  block: string;
}

export interface KeyInBlock {
  key: string;
  /** Offsets of the `@key` span relative to the block start. */
  start: number;
  end: number;
}

/**
 * Every citation block in `text`, source order, non-overlapping — bracketed
 * `[@key]` / `[@a; @b]` groups plus bare inline `@key` narrative forms.
 * Inline hits inside a bracketed block are dropped (the block already
 * owns those spans).
 */
export function findCitationMatches(text: string): CitationMatch[] {
  const out: CitationMatch[] = [];
  CITATION_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_BLOCK_RE.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, block: m[0] });
  }
  INLINE_KEY_RE.lastIndex = 0;
  while ((m = INLINE_KEY_RE.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (out.some((b) => start >= b.start && start < b.end)) continue;
    out.push({ start, end, block: m[0] });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Positions of each `@key` inside a matched block (bracket/separator spans stay prose). */
export function locateKeysInBlock(block: string): KeyInBlock[] {
  const out: KeyInBlock[] = [];
  KEY_IN_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEY_IN_BLOCK_RE.exec(block)) !== null) {
    const key = m[1];
    if (key !== undefined) out.push({ key, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** How a picked citation lands in the note (D35, amended 2026-10-16). */
export type CitationInsertForm = 'parenthetical' | 'inline';

/**
 * The exact markup `insert-citation` writes for a picked citekey.
 * - 'parenthetical' → `[@key]` — Pandoc compiles to "(Author, 2024)".
 * - 'inline'        → `@key`   — Pandoc compiles to "Author (2024)" for
 *   narrative sentences ("As @vaswani2017attention show, …").
 *
 * Locator support (`[@key, p. 45]`) stays locked out of 1.0 scope
 * (§14 3.2 out-of-scope list) — this helper deliberately doesn't know about it.
 */
export function formatCitationMarkup(key: string, form: CitationInsertForm): string {
  return form === 'inline' ? `@${key}` : `[@${key}]`;
}
