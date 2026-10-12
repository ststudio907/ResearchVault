// src/services/papers/paper-file-format.ts
//
// Stateless serialization helpers for paper notes: the `Paper` ↔ frontmatter
// round-trip, template data, and note-body section rendering (`## Attached
// PDF`, quotes). Extracted from `paper-service.ts` in the 2026-10 cleanup —
// pure functions only, no vault access (see `docs/REFACTOR_CONTEXT.md`).

import type { TFile } from 'obsidian';
import type { Paper, PaperSource, Quote, ReadingStatus } from '../../types';
import { READING_STATUSES } from '../../types';
import { fromFrontmatterDate, toLocalDateTime } from '../../utils/format-date';
import type { TemplateData } from '../../utils/template';

/** Fallback template if both settings.templates.paper and project settings are empty. */
export const DEFAULT_PAPER_TEMPLATE = `# {{title}}

> Authors: {{authors}} ({{year}}). {{venue}}.

## Summary

## Key points

## Quotes

## Notes
`;

/** Keys we promise to round-trip via frontmatter. */
export type PaperFrontmatter = {
  id: string;
  citekey: string;
  title: string;
  /** Author last names as a YAML list (2.8.E). */
  authors: string[];
  /** Optional parallel first names list (2.8.E). */
  authorFirstNames?: string[];
  year: number;
  venue?: string;
  doi?: string;
  url?: string;
  /** Open-access PDF URL (4.1.A) — only set by 4.1.B's provider responses. */
  oaUrl?: string;
  pdfPath?: string;
  abstract?: string;
  keywords: string[];
  status: ReadingStatus;
  priority: Paper['priority'];
  rating?: number;
  /** ISO date+time string per `D24`. In-memory `Paper.dateAdded` stays as epoch ms. */
  dateAdded: string;
  /**
   * D24 amended (2026-10): no longer written. `Paper.dateModified` is derived from
   * `file.stat.mtime`. Older notes may still carry this key; it is ignored
   * on read and dropped on the next persist.
   */
  dateModified?: string;
  dateRead?: string;
  source: PaperSource;
  importedFrom?: string;
  customFields: Record<string, unknown>;
};

/** Trim a single author last-name string. Empty/whitespace-only strings become ''. */
export function normaliseAuthorName(name: string): string {
  return (name ?? '').trim();
}

/**
 * 2.8.E — Read the legacy `authors: Author[]` frontmatter shape back into
 * the new `string[]` + `authorFirstNames?` shape. Used only by
 * `frontmatterToPaper` when an existing note predates 2.8.E.
 */
function authorsFromLegacy(rows: unknown): { lastNames: string[]; firstNames: string[] } {
  if (!Array.isArray(rows)) return { lastNames: [], firstNames: [] };
  const lastNames: string[] = [];
  const firstNames: string[] = [];
  for (const row of rows) {
    if (row && typeof row === 'object' && 'lastName' in row) {
      const r = row as { firstName?: string; lastName?: string };
      lastNames.push(normaliseAuthorName(String(r.lastName ?? '')));
      firstNames.push(normaliseAuthorName(String(r.firstName ?? '')));
    } else if (typeof row === 'string') {
      lastNames.push(normaliseAuthorName(row));
      firstNames.push('');
    }
  }
  return { lastNames, firstNames };
}

export function trimOrUndefined(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export function toFrontmatter(paper: Paper): PaperFrontmatter {
  // Dates: epoch ms on the in-memory `Paper`, ISO date+time string on disk (D24).
  return {
    id: paper.id,
    citekey: paper.citekey,
    title: paper.title,
    authors: paper.authors,
    authorFirstNames: paper.authorFirstNames,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    url: paper.url,
    oaUrl: paper.oaUrl,
    pdfPath: paper.pdfPath,
    abstract: paper.abstract,
    keywords: paper.keywords,
    status: paper.status,
    priority: paper.priority,
    rating: paper.rating,
    dateAdded: toLocalDateTime(paper.dateAdded),
    // D24 amended: dateModified is derived from file.stat.mtime — never written back.
    dateModified: undefined,
    dateRead: paper.dateRead ? toLocalDateTime(paper.dateRead) : undefined,
    source: paper.source,
    importedFrom: paper.importedFrom,
    customFields: paper.customFields,
  };
}

export function frontmatterToPaper(
  fm: Partial<PaperFrontmatter>,
  projectId: string,
  file: TFile,
): Paper {
  const citekey = String(fm.citekey ?? file.basename);
  const id = String(fm.id ?? citekey);
  const papersFolder = file.parent?.path ?? '';
  // Parse an optional ISO/epoch date. Returns `undefined` when the source is null/empty/unparseable,
  // never pinning `dateRead` to a 1970 fallback that the sidebar would render as a real timestamp.
  const parseOptionalDate = (raw: unknown): number | undefined => {
    if (raw == null) return undefined;
    const parsed = fromFrontmatterDate(raw, Number.NaN);
    return Number.isNaN(parsed) ? undefined : parsed;
  };
  // Dates: accept either new ISO string OR legacy epoch ms already on disk (D24).
  return {
    id,
    citekey,
    title: String(fm.title ?? file.basename),
    authors: ((): string[] => {
      // 2.8.E — three possible shapes on disk:
      //   new shape: `authors: [Vaswani, Shazeer]` (string[])
      //   new with first names: same + parallel `authorFirstNames?: [Ashish, Noam]`
      //   legacy: `authors: [{firstName, lastName}, …]` (object[])
      if (!Array.isArray(fm.authors)) return [];
      const sample = fm.authors[0];
      if (sample && typeof sample === 'object' && 'lastName' in sample) {
        return authorsFromLegacy(fm.authors).lastNames;
      }
      return (fm.authors as unknown[]).map((s) => normaliseAuthorName(coerceFrontmatterScalar(s)));
    })(),
    authorFirstNames: ((): string[] | undefined => {
      // 2.8.E — only set when the parallel array actually existed on disk,
      // or when the legacy object form had populated firstName fields.
      if (Array.isArray(fm.authorFirstNames)) {
        const arr = (fm.authorFirstNames as unknown[]).map((s) => normaliseAuthorName(coerceFrontmatterScalar(s)));
        return arr.length === 0 ? undefined : arr;
      }
      if (Array.isArray(fm.authors) && fm.authors[0] && typeof fm.authors[0] === 'object') {
        const fromLegacy = authorsFromLegacy(fm.authors).firstNames;
        return fromLegacy.some((n) => n.length > 0) ? fromLegacy : undefined;
      }
      return undefined;
    })(),
    year: typeof fm.year === 'number' ? fm.year : new Date(file.stat.ctime).getFullYear(),
    venue: fm.venue,
    doi: fm.doi,
    url: fm.url,
    // 4.1.A: round-trip oaUrl if it was ever stamped; absent otherwise.
    oaUrl: fm.oaUrl,
    pdfPath: fm.pdfPath,
    abstract: fm.abstract,
    keywords: Array.isArray(fm.keywords) ? (fm.keywords) : [],
    status: ((): ReadingStatus => {
      // Read the raw value unwidened: `fm.status` is typed as the NEW union,
      // but files written before the 2026-09-30 label redesign may still
      // carry legacy `queued` / `summarized` on disk.
      const candidate = fm.status as unknown as string | undefined;
      if (candidate && READING_STATUSES.includes(candidate as ReadingStatus)) {
        return candidate as ReadingStatus;
      }
      // 2026-09-30 label redesign (§7.5 of plans/sidebar-overhaul-research.md):
      // legacy values coerce at read time; the file rewrites itself with the
      // new value on the next persist. `queued` → `unread` (same posture),
      // `summarized` → `annotating` (synthesis still pending → stays
      // in-flight so staleness behaves correctly).
      if (candidate === 'queued') return 'unread';
      if (candidate === 'summarized') return 'annotating';
      return 'unread';
    })(),
    priority: ((): Paper['priority'] => {
      const p = fm.priority as unknown as string | undefined;
      if (p === 'low' || p === 'normal' || p === 'high') return p;
      // Legacy `medium` maps to the new default tier; legacy `critical`
      // collapses into `high` (urgency is now time-boxed by lifecycle).
      return 'normal';
    })(),
    rating: typeof fm.rating === 'number' ? fm.rating : undefined,
    dateAdded: fromFrontmatterDate(fm.dateAdded, file.stat.ctime),
    // D24 amended: always the file's own mtime; any legacy `dateModified` key on
    // disk is ignored (and removed on the next persist).
    dateModified: file.stat.mtime,
    // Only stamp dateRead when the frontmatter actually had a parseable value; an unparseable Read date
    // stays absent (interpreted as "not yet read") rather than pinning to a 1970 .
    dateRead: parseOptionalDate(fm.dateRead),
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: {
      ...(fm.customFields ?? {}),
      projectId,
      papersFolder,
    },
    source: fm.source ?? 'manual',
    importedFrom: fm.importedFrom,
  };
}

export function templateDataFor(paper: Paper): TemplateData {
  // 2.8.E — `authors` template placeholder is a comma-joined list of
  // "<first> <last>" strings when first names exist, else last names only.
  const joinedAuthors = paper.authorFirstNames
    ? paper.authors
        .map((last, i) => `${paper.authorFirstNames?.[i] ?? ''} ${last}`.trim())
        .join(', ')
    : paper.authors.join(', ');
  return {
    citekey: paper.citekey,
    title: paper.title,
    authors: joinedAuthors,
    year: paper.year,
    venue: paper.venue ?? '',
    doi: paper.doi ?? '',
    abstract: paper.abstract ?? '',
    keywords: paper.keywords.join(', '),
    status: paper.status,
    priority: paper.priority,
    dateAdded: isoDate(paper.dateAdded),
  };
}

function isoDate(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString();
}

/**
 * 2.8.E frontmatter reader helper. YAML scalars can hand us strings,
 * numbers, booleans, or null. Anything else (rolls up as objects/arrays
 * after YAML's incomplete typing) we coerce to '' so the YAML stays
 * round-trippable without surprising object-stringification defaults.
 */
function coerceFrontmatterScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Replace (or insert) the `## Attached PDF` section in `body` so it links to
 * `pdfPath`. If `pdfPath` is `undefined`, the section is removed (preserving
 * any content that followed it). Matches the heading at the start of a line
 * so headings in quotes/code blocks are not accidentally rewritten.
 */
export function upsertAttachedPdfSection(body: string, pdfPath: string | undefined): string {
  const lines = body.split('\n');
  // Locate the existing `## Attached PDF` heading (case-insensitive, must be at line start).
  const headingRe = /^##\s+Attached PDF\s*$/i;
  const startIdx = lines.findIndex((l) => headingRe.test(l));
  if (startIdx === -1) {
    if (!pdfPath) return body; // Nothing to insert, nothing to remove.
    const link = `[[${pdfPath}|View PDF]]`;
    const append = `## Attached PDF\n\n${link}`;
    return body.trimEnd().length === 0 ? `${append}\n` : `${body.trimEnd()}\n\n${append}\n`;
  }
  if (!pdfPath) {
    // Remove the heading + its content up to the next `##` heading or end of body.
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i] ?? '')) { endIdx = i; break; }
    }
    const before = lines.slice(0, startIdx).join('\n').replace(/\s+$/u, '');
    const after = lines.slice(endIdx).join('\n').replace(/^\s+/u, '');
    return before.length === 0 && after.length === 0 ? '' : `${before}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
  }
  // Replace the section content with a single wikilink line.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? '')) { endIdx = i; break; }
  }
  const before = lines.slice(0, startIdx).join('\n').replace(/\s+$/u, '');
  const after = lines.slice(endIdx).join('\n').replace(/^\s+/u, '');
  const link = `[[${pdfPath}|View PDF]]`;
  const middle = `## Attached PDF\n\n${link}`;
  const parts = [before, middle, after].filter((p) => p.length > 0);
  return `${parts.join('\n\n')}\n`.replace(/\n{3,}/g, '\n\n');
}

export function renderQuoteSection(quote: Quote): string {
  const head = `> ${quote.text.replace(/\n/g, '\n> ')}`;
  const meta: string[] = [];
  if (quote.page) meta.push(`p. ${quote.page}`);
  if (quote.section) meta.push(quote.section);
  const metaLine = meta.length > 0 ? `\n-- ${meta.join(' \u00B7 ')}` : '';
  const tagsLine = quote.tags.length > 0 ? `\n#tags: ${quote.tags.join(' ')}\n` : '\n';
  const sourceLine = quote.source ? `\n-- source: ${quote.source}\n` : '\n';
  return `${head}${metaLine}${tagsLine}${sourceLine}`;
}

