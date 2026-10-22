// src/ui/styled-citation-editor.ts
//
// C3.2 — the same styled citations as `styled-citation-renderer.ts`, but
// inside the *editor* via CodeMirror replace decorations. This is the surface
// the user actually lives on (they are "always in editor mode" when writing).
//
// Behavior split (explicit user intent, 2026-10-22):
// - **Live preview**: `[@a; @b]` groups and bare `@key` narrative markers are
//   replaced by the style-rendered citation ("(Smith, 2020)", "[1]"), still
//   clickable to the paper note.
// - **Source mode**: no decorations at all — raw Pandoc markup, as before
//   (the `editorLivePreviewField` gate).
// - **Reading view**: handled by the post-processor path, unchanged.
//
// Failure posture mirrors the reading view: the sync pass decorates only
// blocks whose styled string is already known; anything unresolved stays raw
// markup (which IS the source-mode look, so degradation is invisible).
// The async render pass reuses the exact `citeproc-engine.ts` boundary.

import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import { editorInfoField, editorLivePreviewField, TFile } from 'obsidian';
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
import { findCitationMatches, locateKeysInBlock } from '../services/citation/citation-markup';
import { resolvePaper, openPaperNote } from './styled-citation-renderer';

/** Effect that asks every editor plugin instance to recompute decorations. */
const refreshEffect = StateEffect.define<null>();

/** Debounce for the async engine pass after a document change. */
const RENDER_DELAY_MS = 300;

/** Cached render output for one file: doc text + style → styled string per position. */
interface FileRenderState {
  doc: string;
  styleKey: string;
  /** Document offset of each citation match → its rendered text. */
  byFrom: Map<number, string>;
}

/** Per-file cache shared by every editor showing that file. */
const renderState = new Map<string, FileRenderState>();

class StyledCitationWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly keys: string[],
    readonly plugin: ResearchVaultPlugin,
  ) {
    super();
  }

  override eq(other: StyledCitationWidget): boolean {
    return other.text === this.text;
  }

  /** Clicks belong to the widget (open the paper note), not the editor. */
  override ignoreEvent(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const anchor = activeDocument.createElement('a');
    anchor.addClass('internal-link', 'researchvault-citekey-link', 'researchvault-cite-styled');
    anchor.setText(this.text);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const paper = resolvePaper(this.plugin, this.keys[0] ?? '');
      if (paper) void openPaperNote(this.plugin, paper, '');
    });
    return anchor;
  }
}

interface PlannedRange {
  from: number;
  to: number;
  keys: string[];
  styled: string | undefined;
}

/**
 * Pure planner: given the doc text and a per-position styled map, decide
 * which citation ranges get a replace decoration. Selection overlap and
 * unknown styled strings (unresolved keys / pending render) keep raw markup.
 * Exported pure so the contract is unit-testable without CodeMirror.
 */
export function planCitationDecorations(
  doc: string,
  styledByFrom: ReadonlyMap<number, string>,
  selectionFrom: number,
  selectionTo: number,
): PlannedRange[] {
  const ranges: PlannedRange[] = [];
  for (const match of findCitationMatches(doc)) {
    const keys = locateKeysInBlock(match.block).map(({ key }) => key);
    if (keys.length === 0) continue;
    // The cursor/selection inside the marker exposes the raw markup so it
    // stays editable — same interaction language as Obsidian's own links.
    if (selectionFrom <= match.end && selectionTo >= match.start) continue;
    const styled = styledByFrom.get(match.start);
    if (!styled) continue;
    ranges.push({ from: match.start, to: match.end, keys, styled });
  }
  return ranges;
}


/**
 * The per-editor CM6 plugin. Sync pass decorates from the cache only; the
 * async pass (debounced) computes missing strings with the real engine and
 * dispatches `refreshEffect` to redraw.
 */
class StyledCitationsView {
  decorations: DecorationSet = Decoration.none;
  private renderTimer = 0;

  constructor(
    private readonly view: EditorView,
    private readonly plugin: ResearchVaultPlugin,
  ) {
    this.recompute();
  }

  update(update: ViewUpdate): void {
    const refreshRequested = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(refreshEffect)),
    );
    if (update.docChanged || update.selectionSet || update.viewportChanged || refreshRequested) {
      this.recompute();
    }
  }

  private recompute(): void {
    window.clearTimeout(this.renderTimer);
    const none = Decoration.none;
    if (!this.plugin.settings.citation.renderInNote) {
      this.decorations = none;
      return;
    }
    // Source mode stays raw Pandoc markup by explicit user intent.
    if (!this.view.state.field(editorLivePreviewField, false)) {
      this.decorations = none;
      return;
    }
    const file = this.view.state.field(editorInfoField, false)?.file ?? null;
    if (!file) {
      this.decorations = none;
      return;
    }
    const doc = this.view.state.doc.toString();
    const matches = findCitationMatches(doc);
    if (matches.length === 0) {
      this.decorations = none;
      return;
    }

    const styleKey = resolveStyleKey(this.plugin, file);
    let state = renderState.get(file.path);
    if (!state || state.doc !== doc || state.styleKey !== styleKey) {
      // Cache miss (new doc / new style / first open): decorate nothing yet
      // and schedule the engine pass. `custom` styles get a stable empty
      // state so they never re-schedule (see resolveStyleKey).
      if (styleKey === 'custom') {
        renderState.set(file.path, { doc, styleKey, byFrom: new Map<number, string>() });
      } else {
        this.renderTimer = window.setTimeout(() => {
          void this.renderFileStrings(file, doc, styleKey);
        }, RENDER_DELAY_MS);
      }
      this.decorations = none;
      return;
    }

    const selection = this.view.state.selection.main;
    const builder = new RangeSetBuilder<Decoration>();
    const planned = planCitationDecorations(doc, state.byFrom, selection.from, selection.to);
    for (const range of planned) {
      builder.add(
        range.from,
        range.to,
        Decoration.replace({ widget: new StyledCitationWidget(range.styled!, range.keys, this.plugin) }),
      );
    }
    this.decorations = builder.finish();
  }

  /**
   * The async engine pass: resolve papers for every citekey in the doc,
   * build one renderer, render all groups in document order, cache per
   * position, then ask the editor to redraw. Any failure leaves the cache
   * empty — raw markup stays (never a broken editor, never a Notice).
   */
  private async renderFileStrings(file: TFile, doc: string, styleKey: string): Promise<void> {
    try {
      const matches = findCitationMatches(doc);
      if (matches.length === 0) return;
      const styleXml = await resolveStyleXmlForStyleKey(this.plugin, styleKey);
      if (!styleXml) {
        renderState.set(file.path, { doc, styleKey, byFrom: new Map<number, string>() });
        return;
      }

      // Resolve keys in document order; groups with unknown keys keep raw
      // markup (consistent with the reading view).
      const papers = new Map<string, Paper>();
      const groups: Array<{ from: number; keys: string[]; narrative: boolean }> = [];
      for (const match of matches) {
        const keys: string[] = [];
        let complete = true;
        for (const { key } of locateKeysInBlock(match.block)) {
          const paper = resolvePaper(this.plugin, key);
          if (!paper) {
            complete = false;
            break;
          }
          papers.set(paper.citekey, paper);
          keys.push(paper.citekey);
        }
        if (complete) {
          groups.push({ from: match.start, keys, narrative: !match.block.startsWith('[') });
        }
      }
      if (groups.length === 0) {
        renderState.set(file.path, { doc, styleKey, byFrom: new Map<number, string>() });
        return;
      }

      const items: Record<string, unknown> = {};
      for (const [citekey, paper] of papers) items[citekey] = paperToCslJson(paper);
      const localeXml = await inflateGzipBase64(CSL_LOCALES['en-US'] ?? '');
      const renderer = new CiteprocRenderer(items, styleXml, localeXml);
      const citeprocGroups: CiteprocGroup[] = groups.map(({ keys, narrative }) => ({
        keys,
        narrative,
      }));
      const rendered = renderer.renderGroups(citeprocGroups);

      const byFrom = new Map<number, string>();
      groups.forEach((group, index) => {
        const text = rendered[index];
        if (text) byFrom.set(group.from, text);
      });
      renderState.set(file.path, { doc, styleKey, byFrom });
      this.view.dispatch({ effects: refreshEffect.of(null) });
    } catch (error) {
      if (!(error instanceof CiteprocRenderError)) {
        console.error('ResearchVault: live-preview citation rendering failed.', error);
      }
      renderState.set(file.path, { doc, styleKey, byFrom: new Map<number, string>() });
    }
  }
}

/** Style identifier for a file's project (D39); 'custom' has no project path. */
function resolveStyleKey(plugin: ResearchVaultPlugin, file: TFile): string {
  const project = findProjectForPath(plugin.projectManager.getAllProjects(), file.path);
  return project?.settings.citationStyle ?? plugin.settings.globalCitationStyle;
}

async function resolveStyleXmlForStyleKey(
  plugin: ResearchVaultPlugin,
  styleKey: string,
): Promise<string | null> {
  const bundled = CSL_BUNDLED[styleKey];
  if (!bundled) return null; // 'custom' (or unknown) → raw markup
  return await inflateGzipBase64(bundled);
}

/** Register the CM6 extension on every markdown editor. */
export function registerStyledCitationEditor(plugin: ResearchVaultPlugin): void {
  plugin.registerEditorExtension(
    ViewPlugin.define(
      (view) => new StyledCitationsView(view, plugin),
      { decorations: (value) => value.decorations },
    ),
  );
}

