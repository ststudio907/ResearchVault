// src/services/citation/citeproc-engine.ts
//
// C3 — the bundled citeproc-js boundary. Turns resolved `Paper`s plus a CSL
// style into style-rendered in-text citation strings.
//
// Runtime contract (validated empirically in the C3 spike before shipping):
// - citeproc-js needs a `DOMParser` at module load; Obsidian's renderer (and
//   the jsdom test environment) always provides one. Node-only realms would
//   crash on import — tests use the `@vitest-environment jsdom` pragma.
// - `appendCitationCluster(citation, true)` returns `[[noteIndex, text]]`.
// - `setOutputFormat('text')` gives plain text (no HTML entities/spans).
// - A missing item makes the engine throw an internal TypeError — so every
//   key is pre-validated against the caller's item map, and unknown keys
//   never reach the engine (the renderer falls back to plain citekey links).
// - Narrative `@key` (pandoc's "Author (Year)" / numeric "[1]" form) is the
//   `author-only` cluster joined to the `suppress-author` cluster — except
//   numeric styles (IEEE) print no author-only form (`[NO_PRINTED_FORM]`),
//   and then the suppress-author tail stands alone. Matches pandoc's own
//   output for APA/Chicago/IEEE (spike-verified).
//
// One engine instance per render pass: first-vs-subsequent forms and numeric
// ordering depend on processing a note's citations in document order.

import * as citeproc from 'citeproc';
import type { CiteprocCitation, CiteprocCitationItem } from 'citeproc';

/** Locale the engine renders with. en-US is the only vendored locale (C3). */
export const CITEPROC_LOCALE = 'en-US';

/**
 * Marker citeproc-js emits for a citation part the style has no printed form
 * for (e.g. `author-only` under a numeric style). Treated as "absent".
 */
const NO_PRINTED_FORM = '[NO_PRINTED_FORM]';

/** One citation group in document order. `narrative` = bare `@key` form. */
export interface CiteprocGroup {
  keys: string[];
  narrative: boolean;
}

export class CiteprocRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CiteprocRenderError';
  }
}

export class CiteprocRenderer {
  private readonly engine: citeproc.Engine;
  private readonly items: Readonly<Record<string, unknown>>;
  private noteIndex = 0;

  /**
   * @param items citekey → CSL-JSON record. Unknown keys throw at render
   *   time (before the engine sees them — it crashes on null items).
   * @param styleXml CSL style XML (inflated bundle or a vault `.csl`).
   * @param localeXml the vendored en-US locale XML.
   */
  constructor(items: Readonly<Record<string, unknown>>, styleXml: string, localeXml: string) {
    this.items = items;
    // Only en-US is vendored; anything else falls back to it rather than
    // letting the engine error on a null locale.
    const locale = (): string | null => localeXml;
    this.engine = new citeproc.Engine(
      { retrieveLocale: locale, retrieveItem: (id) => this.items[id] ?? null },
      styleXml,
      CITEPROC_LOCALE,
    );
    this.engine.setOutputFormat('text');
  }

  /**
   * Render citation groups in document order. Throws `CiteprocRenderError`
   * with a caller-presentable message when anything is off (unknown key,
   * broken style XML); the caller falls back to plain citekey links.
   */
  renderGroups(groups: readonly CiteprocGroup[]): string[] {
    // Pre-validate before touching the engine — one unknown key anywhere
    // would otherwise abort the whole pass with citeproc's internal
    // TypeError, and a single unresolved marker must not blind a whole note.
    for (const group of groups) {
      for (const key of group.keys) {
        if (!(key in this.items)) {
          throw new CiteprocRenderError(`No CSL-JSON record for citekey "${key}".`);
        }
      }
    }
    return groups.map((group) => {
      const rendered = group.narrative ? this.renderNarrative(group.keys[0]!) : this.renderGroup(group.keys);
      if (rendered.length === 0) {
        throw new CiteprocRenderError('citeproc produced no printed form.');
      }
      return rendered;
    });
  }

  /** Parenthetical / bracketed group: one cluster over all keys. */
  private renderGroup(keys: readonly string[]): string {
    const items: CiteprocCitationItem[] = keys.map((id) => ({ id }));
    const text = this.appendCluster(items);
    // appendCitationCluster returns one tuple per item; the first entry
    // carries the fully rendered cluster (the rest repeat it per item).
    return text;
  }

  /** Bare `@key`: author names + the style's year/number tail (pandoc parity). */
  private renderNarrative(key: string): string {
    const authorPart = this.appendCluster([{ id: key, 'author-only': true }]);
    const tailPart = this.appendCluster([{ id: key, 'suppress-author': true }]);
    if (!authorPart || authorPart === NO_PRINTED_FORM) return tailPart;
    if (!tailPart) return authorPart;
    return `${authorPart} ${tailPart}`;
  }

  /** Append one cluster; returns its rendered text, empty string on none. */
  private appendCluster(items: CiteprocCitationItem[]): string {
    const citation: CiteprocCitation = {
      citationItems: items,
      properties: { noteIndex: this.noteIndex++ },
    };
    const clusters = this.engine.appendCitationCluster(citation, true);
    const first = clusters[0];
    if (!first) return '';
    return typeof first[1] === 'string' ? first[1] : '';
  }
}
