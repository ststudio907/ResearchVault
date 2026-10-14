// src/services/papers/paper-matching.ts
//
// Pure helpers for the shared-PDF-library design (D34, 2026-10 refactor —
// see `docs/REFACTOR_CONTEXT.md`). Decides whether a paper being added
// already exists in ANOTHER project, so its attached PDF in the vault-level
// library can be linked instead of copied. No Obsidian imports — unit-tested
// directly (tests/paper-matching.test.ts).

import type { Paper } from '../../types';

/**
 * Normalize a DOI for equality: lowercase and strip `doi:` / URL prefixes
 * (`https://doi.org/…`, `http://dx.doi.org/…`). Returns `undefined` for
 * empty input so callers can short-circuit on presence.
 */
export function normalizeDoi(doi: string | undefined): string | undefined {
  if (!doi) return undefined;
  const cleaned = doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
  return cleaned || undefined;
}

/** Fields of a paper being created/entered that identify "the same work". */
export interface SamePaperQuery {
  doi?: string | undefined;
  title?: string | undefined;
  /** Author last names, primary first (matches `Paper.authors`). */
  authors?: readonly string[] | undefined;
  year?: number | undefined;
}

export interface SamePaperMatch {
  paper: Paper;
  /**
   * How the match was made. `'doi'` is authoritative; `'title-author-year'`
   * is a heuristic used only when no DOI match exists. A citekey alone is
   * deliberately NEVER a match — two different papers may legally share a
   * citekey across projects (D34).
   */
  via: 'doi' | 'title-author-year';
}

/**
 * Find the same work among parsed papers, excluding any paper in
 * `excludeProjectId` (a same-project duplicate is the caller's own concern —
 * citekey resolution, not this module). DOI equality wins; otherwise the
 * title + primary-author-last-name + year triple must all match
 * case-insensitively. Returns undefined when no match or the query is
 * underspecified.
 */
export function findSamePaper(
  papers: readonly Paper[],
  query: SamePaperQuery,
  excludeProjectId?: string,
): SamePaperMatch | undefined {
  const pool = excludeProjectId
    ? papers.filter((p) => p.customFields['projectId'] !== excludeProjectId)
    : papers;

  const queryDoi = normalizeDoi(query.doi);
  if (queryDoi) {
    const hit = pool.find((p) => normalizeDoi(p.doi) === queryDoi);
    if (hit) return { paper: hit, via: 'doi' };
  }

  const queryTitle = query.title?.trim().toLowerCase();
  const queryFirstAuthor = query.authors
    ?.map((a) => a.trim().toLowerCase())
    .filter(Boolean)[0];
  const queryYear = query.year;
  if (queryTitle && queryFirstAuthor && queryYear !== undefined && Number.isFinite(queryYear)) {
    const hit = pool.find(
      (p) =>
        p.title.trim().toLowerCase() === queryTitle &&
        (p.authors[0]?.trim().toLowerCase() ?? '') === queryFirstAuthor &&
        p.year === queryYear,
    );
    if (hit) return { paper: hit, via: 'title-author-year' };
  }

  return undefined;
}

/**
 * True when `path` is the folder itself or lives inside it. Vault paths are
 * pre-normalized (forward slashes, no trailing slash), so a prefix test is
 * safe. Used to decide whether a chosen PDF already lives in the shared
 * library and must be linked rather than copied (D34).
 */
export function isInsideFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Default vault-level PDF library folder (D34). Lives here — not in
 * `settings.ts` — so the pure helpers stay importable from unit tests
 * (`settings.ts` transitively pulls in modules that import `obsidian`,
 * which vitest cannot resolve).
 */
export const DEFAULT_PDF_LIBRARY_FOLDER = 'Research Vault/pdfs';

/**
 * Normalize a user-entered library folder: trim whitespace and surrounding
 * slashes, fall back to the default when empty.
 */
export function normalizePdfLibraryFolder(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed || DEFAULT_PDF_LIBRARY_FOLDER;
}
