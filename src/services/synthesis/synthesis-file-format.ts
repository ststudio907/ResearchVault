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

import type { EvidenceBlock, EvidenceStance, SynthesisNote } from '../../types';
import { EVIDENCE_STANCES } from '../../types';
import { toLocalDateTime, fromFrontmatterDate } from '../../utils/format-date';
import { formatCitationMarkup } from '../citation/citation-markup';

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
  /** Present (`true`) only on the project's hub note (1.1 Slice 2a). */
  hub?: boolean;
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
    // Omitted for ordinary notes so frontmatter stays minimal; writing
    // `hub: false` on every synthesis note would be noise.
    ...(note.hub ? { hub: true } : {}),
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
    hub: frontmatter.hub === true,
  };
}

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

/**
 * Grouped `## Evidence` content (1.1 Slice 2b format revision): stance
 * subsections at `###` (fixed order: supports → contradicts → neutral,
 * matching the sidebar hub card), each block as a `####` entry inside its
 * group. Empty stances get no header — an all-supports note shows one
 * `### Supports`, not three empty shells. With no evidence at all the
 * content is empty (bare `## Evidence` marker, as before). Blocks render
 * in array order within their group, so insertion chronology is preserved.
 */
export function renderEvidenceSectionContent(evidence: EvidenceBlock[]): string {
  const groups: Array<[EvidenceStance, string]> = [
    ['supports', 'Supports'],
    ['contradicts', 'Contradicts'],
    ['neutral', 'Neutral'],
  ];
  const parts: string[] = [];
  for (const [stance, label] of groups) {
    const inGroup = evidence.filter((b) => b.stance === stance);
    if (inGroup.length === 0) continue;
    parts.push(`### ${label}\n\n${inGroup.map(renderEvidenceBlock).join('\n\n')}`);
  }
  return parts.join('\n\n');
}

/** Full body for a freshly created synthesis note. */
export function renderSynthesisBody(
  note: Pick<SynthesisNote, 'title' | 'thesis' | 'evidence' | 'openQuestions'>,
): string {
  const lines: string[] = [`# ${note.title}`, '', '## Thesis', ''];
  if (note.thesis && note.thesis.trim()) lines.push(note.thesis.trim(), '');
  lines.push('## Evidence', '');
  const evidenceContent = renderEvidenceSectionContent(note.evidence);
  if (evidenceContent) lines.push(evidenceContent, '');
  lines.push('## Open questions', '');
  for (const question of note.openQuestions) {
    lines.push(`- ${question}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Render one evidence block (1.1 Slice 2b format revision; citation form
 * refreshed by C3.5 so the heading carries the D35 `[@citekey]` citation
 * markup instead of a raw wikilink):
 *
 * ```
 * #### [@citekey] · p. 42
 *
 * > quoted text
 * > second line
 *
 * <!-- ev:<id> -->
 * ```
 *
 * Entries are `####` so the `## Evidence` section can group them under
 * `### <Stance>` headers (see `renderEvidenceSectionContent`); the parser
 * accepts both `####` (new) and `###` (legacy pre-grouping) entry headings. The citation is
 * written via `formatCitationMarkup(key, 'parenthetical')` — the exact markup
 * the insert-citation command emits — so the reading-view styled-citation
 * renderer resolves the heading into the styled citation (e.g.
 * `(Hogdon et al., 2022)`). The locator rides the heading after the citation
 * bracket (`· p. 42`). The footer is machine-only: every human-readable field
 * moved up — citekey and locator into the heading, stance into the group
 * header — leaving just the invisible `<!-- ev:<id> -->` anchor that makes the
 * block stable under user edits and uniquely addressable for remove/update.
 * Legacy blocks with the old full footer still parse (see `EVIDENCE_FOOTER_RE`).
 * Numeric locators get the `p. ` prefix; anything else (sections, figures) is
 * written verbatim.
 */
export function renderEvidenceBlock(block: EvidenceBlock): string {
  const quoted = block.text.replace(/\n/g, '\n> ');
  const locatorPart = block.locator && block.locator.trim()
    ? ` · ${formatLocator(block.locator.trim())}`
    : '';
  const heading = `#### ${formatCitationMarkup(block.citekey, 'parenthetical')}${locatorPart}`;
  return `${heading}\n\n> ${quoted}\n\n<!-- ev:${block.id} -->`;
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
  const content = renderEvidenceSectionContent(evidence);
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

/**
 * Matches the legacy footer: `-- source: [[ck]] · p. 42 · supports <!-- ev:id -->`.
 * Pre-2b-revision blocks only — the current format carries all human-readable
 * fields in the heading/group and leaves the anchor alone on its line, but
 * legacy footers still parse so existing notes hydrate and migrate on their
 * next evidence write.
 */
const EVIDENCE_FOOTER_RE =
  /^-- source: \[\[([^\]|]+)(?:\|[^\]]*)?\]\](?: · (.+?))? · (supports|contradicts|neutral) <!-- ev:([^ ]+) -->\s*$/;

/**
 * Matches the 2b anchor-only footer. With source, locator, and stance moved
 * into the heading and group header, the only thing left on this line is the
 * invisible anchor itself.
 */
const EVIDENCE_ANCHOR_RE = /^<!-- ev:([^ ]+) -->\s*$/;

/**
 * Matches a stance group header as rendered by `renderEvidenceSectionContent`.
 * In the 2b format the header — not a footer field — is where a block's
 * stance comes from.
 */
const STANCE_GROUP_RE = /^###\s+(Supports|Contradicts|Neutral)\s*$/;

/**
 * Matches a block entry heading in the current citation form, capturing an
 * optional locator suffix: `#### [@citekey] · p. 42` (group 2) — the `[@citekey]`
 * D35 citation markup (via `formatCitationMarkup(key, 'parenthetical')`) is
 * what the reading-view styled-citation renderer resolves into the styled
 * citation; the locator rides after the citation bracket (`· p. 42`). A bare
 * `### [@citekey]` is the legacy pre-grouping heading shape, accepted here so
 * pre-revision notes hydrate unchanged; the legacy `[[citekey]]` wikilink form
 * is still handled by the legacy matcher below.
 */
const EVIDENCE_CITATION_HEADING_RE = /^#{3,4}\s+\[@([^\]|]+)\](?:\s·\s(.+?))?\s*$/;

/**
 * Matches a block entry heading, capturing an optional locator suffix:
 * `#### [[citekey]] · p. 42` (group 2). A bare `### [[citekey]]` is the
 * legacy pre-grouping heading (no locator there — legacy blocks carry the
 * locator in the footer). Alias tolerated, not used by us.
 */
const EVIDENCE_HEADING_RE = /^#{3,4}\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\](?:\s·\s(.+?))?\s*$/;

/** Result of scanning upward from a footer line for the block's visible parts. */
interface CollectedBlock {
  quoteLines: string[];
  citekeyFromHeading?: string;
  locatorFromHeading?: string;
}

/**
 * Walk upward from a footer/anchor line, collecting the blockquote lines and
 * (optionally) the `#### [[citekey]] · locator` heading above them.
 */
function collectBlockAbove(lines: string[], fromIndex: number): CollectedBlock {
  const quoteLines: string[] = [];
  let citekeyFromHeading: string | undefined;
  let locatorFromHeading: string | undefined;
  for (let j = fromIndex - 1; j >= 0; j -= 1) {
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
    const headingMatch = EVIDENCE_CITATION_HEADING_RE.exec(line) ?? EVIDENCE_HEADING_RE.exec(line);
    if (headingMatch) {
      citekeyFromHeading = headingMatch[1];
      locatorFromHeading = headingMatch[2];
      break;
    }
    break; // Ran into non-block content — stop scanning.
  }
  return { quoteLines, citekeyFromHeading, locatorFromHeading };
}

/**
 * Parse evidence blocks back out of the body. Blocks are keyed by their
 * `<!-- ev:<id> -->` anchor. Two footer shapes are accepted:
 *
 * - 2b anchor-only (`<!-- ev:<id> -->`): stance comes from the enclosing
 *   `### <Stance>` group header (tracked while scanning), citekey and
 *   locator from the heading. A block with no heading above it is skipped
 *   (the citekey is unrecoverable — hydration never fabricates ids), and a
 *   block outside any group header defaults to `neutral` so a hand-moved
 *   anchor is not silently dropped on the next re-render.
 * - Legacy full footer: all fields inline; heading values (citekey, locator)
 *   win when present, footer values fill the gaps.
 *
 * Anchor-less hand-written blocks are skipped rather than guessed at, so
 * hydration never fabricates ids.
 */
export function parseEvidenceBlocks(body: string): EvidenceBlock[] {
  const lines = body.split('\n');
  const blocks: EvidenceBlock[] = [];
  let currentStance: EvidenceStance | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    // Track the enclosing stance group as we scan (blocks always render
    // under these headers, so the header is the stance source in the 2b format).
    const groupMatch = STANCE_GROUP_RE.exec(line);
    if (groupMatch?.[1]) {
      currentStance = groupMatch[1].toLowerCase() as EvidenceStance;
      continue;
    }

    const footerMatch = EVIDENCE_FOOTER_RE.exec(line);
    if (footerMatch) {
      const [, citekey, rawLocator, stance, id] = footerMatch;
      if (!citekey || !isEvidenceStance(stance) || !id) continue;
      const { quoteLines, citekeyFromHeading, locatorFromHeading } = collectBlockAbove(lines, i);
      blocks.push({
        id,
        citekey: citekeyFromHeading ?? citekey,
        text: quoteLines.join('\n'),
        // Locator renders in the heading (2b revision); legacy blocks carry
        // it in the footer. Heading wins when both are present.
        locator: decodeLocator(locatorFromHeading ?? rawLocator),
        stance,
        // `createdAt` is not rendered (the anchor id is the stable identity);
        // hydration stamps 0 — UI orderings use array position, never this.
        createdAt: 0,
      });
      continue;
    }

    const anchorMatch = EVIDENCE_ANCHOR_RE.exec(line);
    if (!anchorMatch?.[1]) continue;
    const id = anchorMatch[1];
    const { quoteLines, citekeyFromHeading, locatorFromHeading } = collectBlockAbove(lines, i);
    if (!citekeyFromHeading) continue; // No heading → no source; skip rather than guess.
    blocks.push({
      id,
      citekey: citekeyFromHeading,
      text: quoteLines.join('\n'),
      locator: decodeLocator(locatorFromHeading),
      stance: currentStance ?? 'neutral',
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



