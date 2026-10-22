// src/ui/styled-citation-renderer.ts
//
// C3 — upgrades the plain citekey links the reading-view post-processor
// emits into style-rendered citations ("(Smith, 2020)", "Smith and Jones
// (2020)", "[1]") via the bundled citeproc engine (D11: style accuracy comes
// from citeproc, never hand-rolled formatting).
//
// Flow: `citation-link-renderer` decorates synchronously (so reading NEVER
// waits on the engine and degrades to plain links on any failure), wrapping
// each citation block in a `.researchvault-cite-block` span. Those spans are
// queued here per note; a short debounce merges the per-section passes
// Obsidian fires, then one render pass processes the note's citations in
// document order (first-vs-subsequent forms + numeric ordering need it).
//
// Failure posture: any error (unresolved key, broken custom style, missing
// inflate API) leaves the existing links untouched — rendering is cosmetic
// and must never break reading. `custom` styles keep the link fallback in
// v1: the `.csl` path lives in the export modal per run, not in project
// settings, so there is nothing to read here (known gap, recorded in plan).

import { Notice, MarkdownPostProcessorContext } from 'obsidian';
import type { ResearchVaultPlugin } from '../core/plugin';
import type { Paper } from '../types';
import { CSL_BUNDLED, CSL_LOCALES } from '../services/citation/csl-bundle.generated';
import { inflateGzipBase64 } from '../services/citation/csl-inflate';
import {
  CiteprocRenderer,
  CiteprocRenderError,
  type CiteprocGroup,
} from '../services/citation/citeproc-engine';
import { paperToCslJson } from '../services/citation/paper-to-csl';
import { findProjectForPath } from '../services/citation/export-service';
import { canonicalPathOf } from '../services/papers/paper-paths';

/** Debounce window that merges the per-section post-processor passes. */
const FLUSH_DELAY_MS = 40;

interface QueuedSpan {
  span: HTMLElement;
  keys: string[];
  narrative: boolean;
}

interface PendingNote {
  spans: QueuedSpan[];
  timer: number;
}

/** One queued note render per source path. */
const pending = new Map<string, PendingNote>();

/** Queue one decorated block span for the styled upgrade. */
export function queueStyledCitationUpgrade(
  plugin: ResearchVaultPlugin,
  ctx: MarkdownPostProcessorContext,
  span: HTMLElement,
): void {
  if (!plugin.settings.citation.renderInNote) return;

  const keys: string[] = [];
  span.querySelectorAll<HTMLElement>('.researchvault-citekey-link').forEach((anchor) => {
    const key = anchor.dataset.rvKey;
    if (key) keys.push(key);
  });
  if (keys.length === 0) return;

  const sourcePath = ctx.sourcePath;
  let note = pending.get(sourcePath);
  if (!note) {
    note = { spans: [], timer: 0 };
    pending.set(sourcePath, note);
  }
  note.spans.push({ span, keys, narrative: !span.hasClass('researchvault-cite-group') });
  window.clearTimeout(note.timer);
  note.timer = window.setTimeout(() => {
    pending.delete(sourcePath);
    void flushNote(plugin, sourcePath, note.spans);
  }, FLUSH_DELAY_MS);
}

/** Render and apply every queued citation block of one note. */
async function flushNote(
  plugin: ResearchVaultPlugin,
  sourcePath: string,
  queued: QueuedSpan[],
): Promise<void> {
  try {
    // Resolution first: any group with an unknown key keeps its plain-link
    // fallback; known groups still upgrade.
    const papers = new Map<string, Paper>();
    const groups: Array<{ queued: QueuedSpan; canonicalKeys: string[]; resolved: Paper[] }> = [];
    for (const entry of queued) {
      // The element may have left the DOM while we were queued (note closed,
      // section re-rendered) — abandon it instead of writing into the void.
      if (!entry.span.isConnected) continue;
      const canonicalKeys: string[] = [];
      const resolved: Paper[] = [];
      let complete = true;
      for (const key of entry.keys) {
        const paper = resolvePaper(plugin, key);
        if (!paper) {
          complete = false;
          break;
        }
        papers.set(paper.citekey, paper);
        canonicalKeys.push(paper.citekey);
        resolved.push(paper);
      }
      if (complete) groups.push({ queued: entry, canonicalKeys, resolved });
    }
    if (groups.length === 0) return;

    const styleXml = await resolveStyleXml(plugin, sourcePath);
    if (!styleXml) return;
    const localeXml = await inflateGzipBase64(CSL_LOCALES['en-US'] ?? '');

    const items: Record<string, unknown> = {};
    for (const [citekey, paper] of papers) {
      items[citekey] = paperToCslJson(paper);
    }
    const renderer = new CiteprocRenderer(items, styleXml, localeXml);
    const citeprocGroups: CiteprocGroup[] = groups.map(({ queued: entry, canonicalKeys }) => ({
      keys: canonicalKeys,
      narrative: entry.narrative,
    }));
    const rendered = renderer.renderGroups(citeprocGroups);

    groups.forEach(({ queued: entry, resolved }, index) => {
      const text = rendered[index];
      // Re-check liveness after the awaits — the note may have closed while
      // the engine was building.
      if (!text || !entry.span.isConnected) return;
      applyRenderedCitation(plugin, entry.span, text, entry, resolved);
    });
  } catch (error) {
    if (!(error instanceof CiteprocRenderError)) {
      console.error('ResearchVault: in-note citation rendering failed.', error);
    }
    // Cosmetic failure — the plain citekey links stay as-is, no Notice spam.
  }
}


/** Swap a decorated block's plain links for the style-rendered citation. */
function applyRenderedCitation(
  plugin: ResearchVaultPlugin,
  span: HTMLElement,
  text: string,
  entry: QueuedSpan,
  resolved: Paper[],
): void {
  const anchor = activeDocument.createElement('a');
  anchor.addClass('internal-link', 'researchvault-citekey-link', 'researchvault-cite-styled');
  anchor.setText(text);
  const first = resolved[0];
  if (first) {
    const titles = resolved
      .map((paper) => `${paper.title} (${paper.year})`)
      .join(' · ');
    anchor.setAttr('title', titles);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openPaperNote(plugin, first, '');
    });
  }
  span.replaceChildren(anchor);
}

/**
 * CSL style XML for a note's project (D39: per-project at render time, same
 * resolution the export uses). `custom` returns null in v1 — the `.csl` path
 * is chosen per export run, not stored per project — so custom-style projects
 * keep the plain links until a project-level custom path lands.
 */
async function resolveStyleXml(
  plugin: ResearchVaultPlugin,
  sourcePath: string,
): Promise<string | null> {
  const project = findProjectForPath(
    plugin.projectManager.getAllProjects(),
    sourcePath,
  );
  const style = project?.settings.citationStyle ?? plugin.settings.globalCitationStyle;
  const bundled = CSL_BUNDLED[style];
  if (!bundled) return null; // 'custom' (or unknown) → link fallback
  return await inflateGzipBase64(bundled);
}

/**
 * Citekeys are only unique within a project (D24), so resolution prefers the
 * active project and falls back to the first match anywhere in the library.
 * Mirrors the plain-link renderer's resolution.
 */
function resolvePaper(plugin: ResearchVaultPlugin, key: string): Paper | null {
  const active = plugin.projectManager.getActiveProject();
  if (active) {
    const inActive = plugin.paperService.getByCitekey(key, active.id);
    if (inActive) return inActive;
  }
  return plugin.paperService.getByCitekey(key) ?? null;
}

async function openPaperNote(
  plugin: ResearchVaultPlugin,
  paper: Paper,
  sourcePath: string,
): Promise<void> {
  const path = canonicalPathOf(paper);
  if (!path || !plugin.app.vault.getAbstractFileByPath(path)) {
    new Notice(`ResearchVault: the note for @${paper.citekey} is missing on disk.`);
    return;
  }
  await plugin.app.workspace.openLinkText(path, sourcePath, false);
}
