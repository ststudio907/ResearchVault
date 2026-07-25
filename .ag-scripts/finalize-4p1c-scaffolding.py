#!/usr/bin/env python3
"""
Finalize the 4.1.C scaffolding for setStatus():
  - private statusEl field (was missing after the in-memory patches didn't commit)
  - statusEl DOM in onOpen() so it has a home in the modal
  - reset statusEl on close (avoid stale reference if the modal re-opens)
  - private setStatus(message, kind) method
  - rewrite openSearchByTitle() so it stops using global Notice() and uses setStatus()
"""
from pathlib import Path

p = Path("src/ui/modals/paper-import-modal.ts")
text = p.read_text()

# --- 1) statusEl field (right after doiLookupBtn) ---------------------------------
old_a = "  /** Cached reference to the DOI Lookup button so we can flip its disabled state. */\n  private doiLookupBtn: HTMLButtonElement | null = null;"
new_a = (
    "  /** Cached reference to the DOI Lookup button so we can flip its disabled state. */\n"
    "  private doiLookupBtn: HTMLButtonElement | null = null;\n"
    "  /** Inline status line for citation-lookup results; contextual alongside the form. */\n"
    "  private statusEl: HTMLElement | null = null;"
)
assert old_a in text, "field anchor missing"
assert text.count(old_a) == 1
text = text.replace(old_a, new_a, 1)
print("[OK] 1 statusEl field")

# --- 2) statusEl DOM in onOpen() (right above renderProjectRow) -------------------
old_b = (
    "    if (this.rv.projectManager.getAllProjects().length === 0) {\n"
    "      contentEl.createEl('p', {\n"
    "        text: 'You need at least one project before you can add a paper. Use \u201ccreate research project\u201d first.',\n"
    "        cls: 'researchvault-paper-import-empty',\n"
    "      });\n"
    "      return;\n"
    "    }\n\n"
    "    this.renderProjectRow(contentEl);"
)
new_b = (
    "    if (this.rv.projectManager.getAllProjects().length === 0) {\n"
    "      contentEl.createEl('p', {\n"
    "        text: 'You need at least one project before you can add a paper. Use \u201ccreate research project\u201d first.',\n"
    "        cls: 'researchvault-paper-import-empty',\n"
    "      });\n"
    "      return;\n"
    "    }\n\n"
    "    // Inline status line for citation-lookup results. Defaults to empty so the\n"
    "    // modal doesn't take extra space when nothing has happened yet.\n"
    "    this.statusEl = contentEl.createDiv({ cls: 'researchvault-import-status' });\n\n"
    "    this.renderProjectRow(contentEl);"
)
assert old_b in text, "onOpen anchor missing"
assert text.count(old_b) == 1
text = text.replace(old_b, new_b, 1)
print("[OK] 2 statusEl DOM")

# --- 3) reset statusEl in onClose() -----------------------------------------------
old_c = (
    "  onClose(): void {\n"
    "    this.contentEl.empty();\n"
    "  }"
)
new_c = (
    "  onClose(): void {\n"
    "    this.statusEl = null;\n"
    "    this.contentEl.empty();\n"
    "  }"
)
assert old_c in text, "onClose anchor missing"
assert text.count(old_c) == 1
text = text.replace(old_c, new_c, 1)
print("[OK] 3 onClose reset")

# --- 4) setStatus method right after updateLookupButton() -------------------------
old_d = (
    "  /** Update the DOI Lookup button's disabled state based on current form state. */\n"
    "  private updateLookupButton(): void {\n"
    "    if (!this.doiLookupBtn) return;\n"
    "    const enabled = this.isCitationLookupEnabled() && this.form.doi.trim().length > 0;\n"
    "    this.doiLookupBtn.disabled = !enabled;\n"
    "    this.doiLookupBtn.toggleClass('mod-disabled', !enabled);\n"
    "  }\n\n"
    "  /** Open the \"Search by title\" modal for the current Title field value. */"
)
new_d = (
    "  /** Update the DOI Lookup button's disabled state based on current form state. */\n"
    "  private updateLookupButton(): void {\n"
    "    if (!this.doiLookupBtn) return;\n"
    "    const enabled = this.isCitationLookupEnabled() && this.form.doi.trim().length > 0;\n"
    "    this.doiLookupBtn.disabled = !enabled;\n"
    "    this.doiLookupBtn.toggleClass('mod-disabled', !enabled);\n"
    "  }\n\n"
    "  /**\n"
    "   * Write a one-line status message into the modal-internal statusEl.\n"
    "   * Replaces the global Notice(...) calls for citation-lookup flows so the\n"
    "   * message stays contextual (visible while the modal is open).\n"
    "   */\n"
    "  private setStatus(message: string, kind: 'info' | 'error' = 'info'): void {\n"
    "    if (!this.statusEl) return;\n"
    "    this.statusEl.setText(message);\n"
    "    this.statusEl.removeClass(\n"
    "      'researchvault-import-status-info',\n"
    "      'researchvault-import-status-error',\n"
    "    );\n"
    "    this.statusEl.addClass(\n"
    "      kind === 'error' ? 'researchvault-import-status-error' : 'researchvault-import-status-info',\n"
    "    );\n"
    "  }\n\n"
    "  /** Open the \"Search by title\" modal for the current Title field value. */"
)
assert old_d in text, "setStatus anchor missing"
assert text.count(old_d) == 1
text = text.replace(old_d, new_d, 1)
print("[OK] 4 setStatus method")

# --- 5) Rewrite openSearchByTitle() to use setStatus() ---------------------------
old_e = (
    "  /** Open the \"Search by title\" modal for the current Title field value. */\n"
    "  private async openSearchByTitle(): Promise<void> {\n"
    "    const query = this.form.title.trim();\n"
    "    if (!query) {\n"
    "      new Notice('Researchvault: enter a title to search.');\n"
    "      return;\n"
    "    }\n\n"
    "    const service = this.rv.ensureCitationService();\n"
    "    if (!service) {\n"
    "      new Notice('Researchvault: citation lookup is not enabled in settings.');\n"
    "      return;\n"
    "    }\n\n"
    "    const modal = new CitationSearchModal(this.app, service, query, (result) => {\n"
    "      this.applyAutofill(result.record);\n"
    "    });\n"
    "    // Seed the search query from the current Title field value.\n"
    "    modal.open();\n"
    "  }"
)
new_e = (
    "  /** Open the \"Search by title\" modal for the current Title field value. */\n"
    "  private async openSearchByTitle(): Promise<void> {\n"
    "    const query = this.form.title.trim();\n"
    "    if (!query) {\n"
    "      this.setStatus('Enter a title to search.', 'error');\n"
    "      return;\n"
    "    }\n\n"
    "    const service = this.rv.ensureCitationService();\n"
    "    if (!service) {\n"
    "      this.setStatus('Citation lookup is not enabled in settings.', 'error');\n"
    "      return;\n"
    "    }\n\n"
    "    // Open the search modal last so any inline status above stays put.\n"
    "    const modal = new CitationSearchModal(this.app, service, query, (result) => {\n"
    "      this.applyAutofill(result.record);\n"
    "    });\n"
    "    modal.open();\n"
    "    this.setStatus(`Searching for \u201C${query}\u2026`, 'info');\n"
    "  }"
)
assert old_e in text, "openSearchByTitle anchor missing"
assert text.count(old_e) == 1
text = text.replace(old_e, new_e, 1)
print("[OK] 5 openSearchByTitle rewrite")

p.write_text(text)
print("\nAll scaffolding committed.")
