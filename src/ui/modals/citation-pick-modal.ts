// src/ui/modals/citation-pick-modal.ts
//
// One-command motion for citing from the editor (3.2 Citation excellence C2 /
// D35): a fuzzy picker over the active project's papers. The caller owns the
// "then what" via the callback — the plugin's `insert-citation` command
// inserts `[@citekey]` at the cursor, but the same modal shape will back any
// future "copy citation" flows without modification.

import { FuzzySuggestModal, App } from 'obsidian';
import type { FuzzyMatch } from 'obsidian';
import type { Paper } from '../../types';
import type { CitationInsertForm } from '../../services/citation/citation-markup';

export type CitationPickCallback = (paper: Paper, form: CitationInsertForm) => void;

export class CitationPickModal extends FuzzySuggestModal<Paper> {
  constructor(
    app: App,
    private readonly papers: Paper[],
    private readonly onPick: CitationPickCallback,
  ) {
    super(app);
    this.setPlaceholder('Pick a paper to cite (enter adds [@key], shift+enter adds @key)…');
    this.setInstructions([
      { command: 'Enter', purpose: 'Insert parenthetical [@citekey]' },
      { command: 'Shift+Enter', purpose: 'Insert inline @citekey' },
    ]);
  }

  /**
   * SuggestModal has no built-in modifier-accept keymap, so plain Shift+Enter
   * would land as a newline in the filter input instead of choosing a paper.
   * Scope-register it and dispatch through the highlighted suggestion so it
   * flows into the modifier-aware `selectSuggestion` below.
   */
  override onOpen(): void {
    void super.onOpen();
    this.scope.register(['Shift'], 'Enter', (evt) => {
      // Runtime-only SuggestModal surface (absent from the public typings but
      // stable across versions; the app's own quick switchers use it the same
      // way). Guarded: worst case Shift+Enter degenerates to a plain newline
      // in the filter box, not a crash.
      const chooser = (this as unknown as { chooser?: { useSelectedItem(e: KeyboardEvent): boolean } })
        .chooser;
      chooser?.useSelectedItem(evt);
    });
  }

  getItems(): Paper[] {
    return this.papers;
  }

  /** What fuzzy matching sees: citekey first so `@vaswani`-style recall works. */
  getItemText(paper: Paper): string {
    return `${paper.citekey}  ${paper.title} (${paper.year})`;
  }

  /**
   * Override the suggestion-accept path so modifiers carry the insert form
   * (D35 amended): plain accept = `[@key]`, Shift = inline `@key`. Covers
   * both keyboard and shift-click without a second modal.
   */
  selectSuggestion(value: FuzzyMatch<Paper>, evt: MouseEvent | KeyboardEvent): void {
    const form: CitationInsertForm = evt.shiftKey ? 'inline' : 'parenthetical';
    this.onPick(value.item, form);
    this.close();
  }

  /** FuzzySuggestModal contract — parenthetical is the default form. */
  onChooseItem(paper: Paper): void {
    this.onPick(paper, 'parenthetical');
  }
}
