// src/services/synthesis/synthesis-file-format.ts
//
// Stateless serialization for synthesis notes (1.1 Slice 1): the
// `SynthesisNote` ↔ frontmatter round-trip, note-body skeleton, and the
// evidence-block section under `## Evidence`. Pure functions only, no vault
// access — mirrors `paper-file-format.ts`.
//
// The note BODY is canonical (same precedent as paper quotes): each evidence
// block is rendered under `## Evidence` with an invisible `<!-- ev:<id> -->`
// anchor so `parseEvidenceBlocks` can rebuild the in-memory list on hydration
// even after the user edits quote text by hand.

import type { EvidenceBlock, SynthesisNote } from '../../types';
import { EVIDENCE_STANCES } from '../../types';
import { toLocalDateTime, fromFrontmatterDate } from '../../utils/format-date';

/** Fallback body skeleton for a fresh synthesis note. */
export const DEFAULT_SYNTHESIS_BODY = `## Thesis

## Evidence

## Open questions
`;

/** Keys we promise to round-trip via frontmatter. */
/**
 * `extends Record<string, unknown>` so the shape is directly acceptable to
 * `joinFrontmatter` (same reason `PaperFrontmatter` round-trips cleanly).
 */
export interface SynthesisFrontmatter extends Record<string, unknown> {
  /** Discriminates synthesis notes from other markdown in the vault. */
  type: 'synthesis';
  id: string;
  projectId: string;
  title: string;
  /** Distinct source citekeys, in first-appearance order. Derived on write; ignored on read. */
  sources: string[];
  /** Local-tz `YYYY-MM-DD | HH:MM` string per the 2.8.C writer. Epoch ms in memory. */
  dateAdded: string;
}

function isEvidenceStance(value: unknown): value is import('../../types').EvidenceStance {
  return EVIDENCE_STANCES.includes(value as import('../../types').EvidenceStance);
}

/** Frontmatter for a synthesis note. `dateAdded` becomes the local-tz string (2.8.C). */
export function toSynthesisFrontmatter(note: SynthesisNote): SynthesisFrontmatter {
  const sources: string[] = [];
  for (const block of note.evidence) {
    if (!sources.includes(block.citekey)) sources.push(block.citekey);
  }
  return {
    type: 'synthesis',
    id: note.id,
    projectId: note.projectId,
    title: note.title,
    sources,
    dateAdded: toLocalDateTime(note.dateAdded),
  };
}

/**
 * Rebuild a `SynthesisNote` from parsed frontmatter + body. Returns `null`
 * for files missing required fields (id / title / projectId) so a stray
 * markdown file does not poison the index — same skip-and-log contract as
 * `PaperService.readPaperFile`.
 */
export function frontmatterToSynthesis(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string,
  fallbackDate: number,
): SynthesisNote | null {
  const id = typeof frontmatter.id === 'string' ? frontmatter.id : '';
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : '';
  const projectId = typeof frontmatter.projectId === 'string' ? frontmatter.projectId : '';
  if (!id || !title || !projectId) return null;

  return {
    id,
    projectId,
    title,
    thesis: extractThesis(body) || undefined,
    evidence: parseEvidenceBlocks(body),
    openQuestions: parseOpenQuestions(body),
    path: filePath,
    dateAdded: fromFrontmatterDate(frontmatter.dateAdded, fallbackDate),
  };
}

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

/** Full body for a freshly created synthesis note. */
export function renderSynthesisBody(
  note: Pick<SynthesisNote, 'title' | 'thesis' | 'evidence' | 'openQuestions'>,
): string {
  const lines: string[] = [`# ${note.title}`, '', '## Thesis', ''];
  if (note.thesis && note.thesis.trim()) lines.push(note.thesis.trim(), '');
  lines.push('## Evidence', '');
  if (note.evidence.length > 0) {
    lines.push(note.evidence.map(renderEvidenceBlock).join('\n'), '');
  }
  lines.push('## Open questions', '');
  for (const question of note.openQuestions) {
    lines.push(`- ${question}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Render one evidence block:
 *
 * ```
 * ### [[citekey]]
 *
 * > quoted text
 * > second line
 *
 * -- source: [[citekey]] · p. 42 · supports <!-- ev:<id> -->
 * ```
 *
 * The `<!-- ev:<id> -->` anchor is invisible in reading view but makes the
 * block stable under user edits and uniquely addressable for remove/update.
 * Numeric locators get the `p. ` prefix; anything else (sections, figures)
 * is written verbatim.
 */
export function renderEvidenceBlock(block: EvidenceBlock): string {
  const quoted = block.text.replace(/\n/g, '\n> ');
  const locatorPart = block.locator && block.locator.trim()
    ? ` · ${formatLocator(block.locator.trim())}`
    : '';
  const footer = `-- source: [[${block.citekey}]]${locatorPart} · ${block.stance} <!-- ev:${block.id} -->`;
  return `### [[${block.citekey}]]\n\n> ${quoted}\n\n${footer}`;
}

/** `42` → `p. 42`; anything not starting with a digit stays verbatim. */
function formatLocator(locator: string): string {
  return /^\d/.test(locator) ? `p. ${locator}` : locator;
}

/**
 * Replace (or insert) the `## Evidence` section in `body` so it renders
 * exactly `evidence`. If the heading is missing it is appended at the end.
 * Matches the heading at line start so headings inside quotes/code are not
 * touched. The whole section is re-rendered from the passed array — the
 * service's in-memory note is the single writer, so partial edits cannot
 * drift.
 */
export function upsertEvidenceSection(body: string, evidence: EvidenceBlock[]): string {
  const content = evidence.length > 0 ? evidence.map(renderEvidenceBlock).join('\n') : '';
  return replaceSection(body, /^##\s+Evidence\s*$/i, '## Evidence', content);
}

/** Replace (or insert) the `## Open questions` section with `- ` items. */
export function upsertOpenQuestionsSection(body: string, questions: string[]): string {
  const content = questions.length > 0 ? questions.map((q) => `- ${q}`).join('\n') : '';
  return replaceSection(body, /^##\s+Open questions\s*$/i, '## Open questions', content);
}

/**
 * Replace the content between a `## <name>` heading and the next `## `
 * heading (or EOF) with `content`. Appends the section (using `headingText`)
 * at the end when the heading does not exist. Shared impl for the two
 * upserts above.
 */
function replaceSection(body: string, headingRe: RegExp, headingText: string, content: string): string {
  const lines = body.split('\n');
  const startIdx = lines.findIndex((l) => headingRe.test(l));
  if (startIdx === -1) {
    const base = body.trimEnd().length === 0 ? '' : `${body.trimEnd()}\n\n`;
    return `${base}${headingText}\n\n${content}`.trimEnd() + '\n';
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? '')) { endIdx = i; break; }
  }
  const before = lines.slice(0, startIdx).join('\n').replace(/\s+$/u, '');
  const after = lines.slice(endIdx).join('\n').replace(/^\s+/u, '');
  // The heading is always retained — an emptied section keeps its marker so
  // later upserts still have an anchor point in the document.
  const middle = content.trimEnd() ? `${headingText}\n\n${content.trimEnd()}` : headingText;
  const parts = [before, middle, after].filter((p) => p.length > 0);
  const joined = parts.length > 1 ? parts.join('\n\n') : (parts[0] ?? '');
  return `${joined}\n`;
}

// ---------------------------------------------------------------------------
// Body parsing (hydration — the body is canonical)
// ---------------------------------------------------------------------------

/** Matches an evidence footer: `-- source: [[ck]] · p. 42 · supports <!-- ev:id -->`. */
const EVIDENCE_FOOTER_RE =
  /^-- source: \[\[([^\]|]+)(?:\|[^\]]*)?\]\](?: · (.+?))? · (supports|contradicts|neutral) <!-- ev:([^ ]+) -->\s*$/;

/** Matches a block heading: `### [[citekey]]` (alias tolerated, not used by us). */
const EVIDENCE_HEADING_RE = /^###\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/;

/**
 * Parse evidence blocks back out of the body. Blocks are keyed by their
 * `<!-- ev:<id> -->` anchor; a footer without an anchor (hand-written block)
 * is skipped rather than guessed at, so hydration never fabricates ids.
 */
export function parseEvidenceBlocks(body: string): EvidenceBlock[] {
  const lines = body.split('\n');
  const blocks: EvidenceBlock[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const footerMatch = EVIDENCE_FOOTER_RE.exec(lines[i] ?? '');
    if (!footerMatch) continue;
    const [, citekey, rawLocator, stance, id] = footerMatch;
    if (!citekey || !isEvidenceStance(stance) || !id) continue;

    // Walk upward collecting the blockquote lines and (optionally) the heading.
    const quoteLines: string[] = [];
    let citekeyFromHeading: string | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      const line = lines[j] ?? '';
      if (line.startsWith('> ')) {
        quoteLines.unshift(line.slice(2));
        continue;
      }
      if (line === '>') {
        quoteLines.unshift('');
        continue;
      }
      if (line.trim() === '') continue;
      const headingMatch = EVIDENCE_HEADING_RE.exec(line);
      if (headingMatch) {
        citekeyFromHeading = headingMatch[1];
        break;
      }
      break; // Ran into non-block content — stop scanning.
    }

    blocks.push({
      id,
      citekey: citekeyFromHeading ?? citekey,
      text: quoteLines.join('\n'),
      locator: decodeLocator(rawLocator),
      stance,
      // `createdAt` is not rendered (the anchor id is the stable identity);
      // hydration stamps 0 — UI orderings use array position, never this.
      createdAt: 0,
    });
  }
  return blocks;
}

/** Inverse of `formatLocator`: `p. 42` → `42`; verbatim otherwise. */
function decodeLocator(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^p\. (.+)$/u.exec(raw);
  return (m?.[1] ?? raw).trim() || undefined;
}

/** Extract the thesis paragraph between `## Thesis` and the next `## ` heading. */
export function extractThesis(body: string): string {
  return sectionContent(body, /^##\s+Thesis\s*$/i)
    .filter((l) => l.trim() !== '')
    .join('\n')
    .trim();
}

/** Extract the `- ` items under `## Open questions`. */
export function parseOpenQuestions(body: string): string[] {
  return sectionContent(body, /^##\s+Open questions\s*$/i)
    .map((l) => {
      const m = /^-\s+(.+)$/.exec(l.trim());
      return m?.[1] ?? '';
    })
    .filter((q) => q.trim() !== '');
}

/** Lines between a `## <name>` heading and the next `## ` heading (or EOF). */
function sectionContent(body: string, headingRe: RegExp): string[] {
  const lines = body.split('\n');
  const startIdx = lines.findIndex((l) => headingRe.test(l));
  if (startIdx === -1) return [];
  const out: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^##\s+/.test(line)) break;
    out.push(line);
  }
  return out;
}



