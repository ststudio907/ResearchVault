#!/usr/bin/env python3
"""
Fix the three drifts I surfaced in the 4.1.C/D audit:

  (1) inline status line in PaperImportModal — swap global Notice() calls
      inside performDoiLookup + openSearchByTitle for a modal-internal
      statusEl + setStatus() helper.

  (2) privacy-focused wording in settings-tab renderCitations() — replace
      the feature-focused description with the plan-specified privacy text.

  (3) parameterize citation-search-modal's `provider` field on each row
      against citationService.preferredProvider(); add the public getter
      on CitationService for that.

  (4) The plan also asked for an extra bullet in a "Privacy" settings
      section. There IS no such section today, so this is deferred to a
      later polish pass; logged in plan.md §13 instead.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"[FAIL] {path}: pattern not found\n--- expected ---\n{old}")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"[FAIL] {path}: expected exactly 1 occurrence, found {count}")
    path.write_text(text.replace(old, new))
    print(f"[OK]   {path}: replaced 1 occurrence")


# ---------------------------------------------------------------------------
# CitationService — add a public `preferredProvider()` getter so the modal
# search result picker can stamp the correct provider on each row.
# ---------------------------------------------------------------------------
service_path = ROOT / "src/services/citation/citation-service.ts"
service_text = service_path.read_text()
old_block = """\tclearCaches(): void {\n\t\tthis.lookupCache.clear();\n\t\tthis.titleSearchCache.clear();\n\t\tthis.querySearchCache.clear();\n\t}"""
new_block = """\tclearCaches(): void {\n\t\tthis.lookupCache.clear();\n\t\tthis.titleSearchCache.clear();\n\t\tthis.querySearchCache.clear();\n\t}\n\n\t/**\n\t * Returns the user-configured preferred provider name. Pure read of\n\t * settings — does not check the enabled flag, buckets, caches, etc.\n\t * Used by the search-result modal to stamp provenance on picked rows.\n\t */\n\tpreferredProvider(): string {\n\t\treturn this.settings.citation.preferredProvider;\n\t}"""
replace_once(service_path, old_block, new_block)


# ---------------------------------------------------------------------------
# CitationSearchModal — stamp `provider` against preferredProvider(); also
# drop the leading whitespace in the provider-field comment.
# ---------------------------------------------------------------------------
modal_path = ROOT / "src/ui/modals/citation-search-modal.ts"
replace_once(
    modal_path,
    "\t\t// Click to pick this result\n\t\trow.addEventListener('click', () => {\n\t\t\tthis.onPick({ record, provider: 'crossref' });\n\t\t\tthis.close();\n\t\t});",
    "\t\t// Click to pick this result. The provider label is the configured\n\t\t// preferred provider that searchByTitle() just routed through, so\n\t\t// every row is consistently labelled.\n\t\tconst provider = this.citationService.preferredProvider();\n\t\trow.addEventListener('click', () => {\n\t\t\tthis.onPick({ record, provider });\n\t\t\tthis.close();\n\t\t});",
)


# ---------------------------------------------------------------------------
# PaperImportModal — add internal statusEl + setStatus() helper; replace
# the four global Notice() calls inside performDoiLookup + openSearchByTitle
# with setStatus() calls. We deliberately leave submit-time notices alone —\n# those fire after the modal is closed.
# ---------------------------------------------------------------------------
pm_path = ROOT / "src/ui/modals/paper-import-modal.ts"

# Insert a new class field after doiLookupBtn.
replace_once(
    pm_path,
    "  /** Cached reference to the DOI Lookup button so we can flip its disabled state. */\n  private doiLookupBtn: HTMLButtonElement | null = null;",
    "  /** Cached reference to the DOI Lookup button so we can flip its disabled state. */\n  private doiLookupBtn: HTMLButtonElement | null = null;\n  /** Inline status line for citation-lookup results; setText() only. */\n  private statusEl: HTMLElement | null = null;",
)

# Render statusEl in onOpen, after the intro <p> and before renderProjectRow.
replace_once(
    pm_path,
    "    if (this.rv.projectManager.getAllProjects().length === 0) {\n      contentEl.createEl('p', {\n        text: 'You need at least one project before you can add a paper. Use \u201ccreate research project\u201d first.',\n        cls: 'researchvault-paper-import-empty',\n      });\n      return;\n    }\n\n    this.renderProjectRow(contentEl);",
    "    if (this.rv.projectManager.getAllProjects().length === 0) {\n      contentEl.createEl('p', {\n        text: 'You need at least one project before you can add a paper. Use \u201ccreate research project\u201d first.',\n        cls: 'researchvault-paper-import-empty',\n      });\n      return;\n    }\n\n    // Inline status line for citation-lookup results. Defaults to empty so\n    // the modal doesn't take extra space when nothing has happened yet.\n    this.statusEl = contentEl.createDiv({ cls: 'researchvault-import-status' });\n\n    this.renderProjectRow(contentEl);",
)

# Reset statusEl on close so re-opens start clean.
replace_once(
    pm_path,
    "  onClose(): void {\n    this.contentEl.empty();\n  }\n\n  // -------------------------------------------------------------------------\n  // Field renderers\n  // -------------------------------------------------------------------------",
    "  onClose(): void {\n    this.statusEl = null;\n    this.contentEl.empty();\n  }\n\n  // -------------------------------------------------------------------------\n  // Field renderers\n  // -------------------------------------------------------------------------",
)

# Insert setStatus() helper right after updateLookupButton().
# The helper preserves a `kind` ('info' or 'error') so we can apply a class\n# in styles.css later; for now we just toggle text and a generic class.
replace_once(
    pm_path,
    "  /** Update the DOI Lookup button's disabled state based on current form state. */\n  private updateLookupButton(): void {\n    if (!this.doiLookupBtn) return;\n    const enabled = this.isCitationLookupEnabled() && this.form.doi.trim().length > 0;\n    this.doiLookupBtn.disabled = !enabled;\n    this.doiLookupBtn.toggleClass('mod-disabled', !enabled);\n  }\n\n  /** Open the \"Search by title\" modal for the current Title field value. */",
    "  /** Update the DOI Lookup button's disabled state based on current form state. */\n  private updateLookupButton(): void {\n    if (!this.doiLookupBtn) return;\n    const enabled = this.isCitationLookupEnabled() && this.form.doi.trim().length > 0;\n    this.doiLookupBtn.disabled = !enabled;\n    this.doiLookupBtn.toggleClass('mod-disabled', !enabled);\n  }\n\n  /**\n   * Write a one-line status message into the modal-internal statusEl.\n   * Replaces the global Notice(...) calls for citation-lookup flows so\n   * the message stays contextual (visible while the modal is open).\n   */\n  private setStatus(message: string, kind: 'info' | 'error' = 'info'): void {\n    if (!this.statusEl) return;\n    this.statusEl.setText(message);\n    this.statusEl.removeClass('researchvault-import-status-info', 'researchvault-import-status-error');\n    this.statusEl.addClass(kind === 'error' ? 'researchvault-import-status-error' : 'researchvault-import-status-info');\n  }\n\n  /** Open the \"Search by title\" modal for the current Title field value. */",
)

# Rewrite openSearchByTitle() to use setStatus() instead of Notice().
replace_once(
    pm_path,
    "  /** Open the \"Search by title\" modal for the current Title field value. */\n  private async openSearchByTitle(): Promise<void> {\n    const query = this.form.title.trim();\n    if (!query) {\n      new Notice('Researchvault: enter a title to search.');\n      return;\n    }\n\n    const service = this.rv.ensureCitationService();\n    if (!service) {\n      new Notice('Researchvault: citation lookup is not enabled in settings.');\n      return;\n    }\n\n    const modal = new CitationSearchModal(this.app, service, query, (result) => {\n      this.applyAutofill(result.record);\n    });\n    // Seed the search query from the current Title field value.\n    modal.open();\n  }\n\n  /** Perform a DOI lookup for the current DOI field value and autofill the form. */",
    "  /** Open the \"Search by title\" modal for the current Title field value. */\n  private async openSearchByTitle(): Promise<void> {\n    const query = this.form.title.trim();\n    if (!query) {\n      this.setStatus('Enter a title to search.', 'error');\n      return;\n    }\n\n    const service = this.rv.ensureCitationService();\n    if (!service) {\n      this.setStatus('Citation lookup is not enabled in settings.', 'error');\n      return;\n    }\n\n    // Open the search modal last so any inline status above stays put.\n    const modal = new CitationSearchModal(this.app, service, query, (result) => {\n      this.applyAutofill(result.record);\n    });\n    modal.open();\n    this.setStatus(`Searching for \u201C${query}\u201D\u2026`, 'info');\n  }\n\n  /** Perform a DOI lookup for the current DOI field value and autofill the form. */",
)

# Rewrite performDoiLookup() to use setStatus().
replace_once(
    pm_path,
    "  /** Perform a DOI lookup for the current DOI field value and autofill the form. */\n  private async performDoiLookup(): Promise<void> {\n    const doi = this.form.doi.trim();\n    if (!doi) {\n      new Notice('Researchvault: enter a doi to look up.');\n      return;\n    }\n\n    if (!this.isCitationLookupEnabled()) {\n      new Notice('Researchvault: citation lookup is not enabled in settings.');\n      return;\n    }\n\n    const service = this.rv.ensureCitationService();\n    if (!service) {\n      new Notice('Researchvault: citation lookup service unavailable.');\n      return;\n    }\n\n    // Show a loading indicator.\n    const btn = this.doiLookupBtn;\n    if (btn) {\n      btn.disabled = true;\n      btn.textContent = '\u23f3';\n    }\n\n    try {\n      const record = await service.lookupByDoi(doi);\n      if (!record) {\n        new Notice('Researchvault: no record found for that doi.');\n        return;\n      }\n      this.applyAutofill(record);\n      new Notice(`ResearchVault: autofilled from DOI ${doi}.`);\n    } catch (err) {\n      const msg = err instanceof Error ? err.message : String(err);\n      new Notice(`ResearchVault: lookup failed \u2014 ${msg}`);\n    } finally {\n      if (btn) {\n        btn.textContent = '\ud83d\udd0d Lookup';\n        this.updateLookupButton();\n      }\n    }\n  }",
    "  /** Perform a DOI lookup for the current DOI field value and autofill the form. */\n  private async performDoiLookup(): Promise<void> {\n    const doi = this.form.doi.trim();\n    if (!doi) {\n      this.setStatus('Enter a doi to look up.', 'error');\n      return;\n    }\n\n    if (!this.isCitationLookupEnabled()) {\n      this.setStatus('Citation lookup is not enabled in settings.', 'error');\n      return;\n    }\n\n    const service = this.rv.ensureCitationService();\n    if (!service) {\n      this.setStatus('Citation lookup service unavailable.', 'error');\n      return;\n    }\n\n    // Show a loading indicator on the button + a transient status line.\n    const btn = this.doiLookupBtn;\n    if (btn) {\n      btn.disabled = true;\n      btn.textContent = '\u23f3';\n    }\n    this.setStatus(`Looking up doi \u201C${doi}\u2026`, 'info');\n\n    try {\n      const record = await service.lookupByDoi(doi);\n      if (!record) {\n        this.setStatus(`No record found for doi \u201C${doi}\u201D.`, 'error');\n        return;\n      }\n      this.applyAutofill(record);\n      this.setStatus(`Filled ${this.form.title ? `\u201C${this.form.title}\u201D ` : ''}from ${service.preferredProvider()}. Edit any field to override; re-run to fill what you left blank.`, 'info');\n    } catch (err) {\n      const msg = err instanceof Error ? err.message : String(err);\n      this.setStatus(`Lookup failed \u2014 ${msg}`, 'error');\n    } finally {\n      if (btn) {\n        btn.textContent = '\ud83d\udd0d Lookup';\n        this.updateLookupButton();\n      }\n    }\n  }",
)


# ---------------------------------------------------------------------------
# settings-tab.ts — swap the description text in renderCitations() for the
# plan-specified privacy wording.
# ---------------------------------------------------------------------------
st_path = ROOT / "src/ui/settings/settings-tab.ts"
replace_once(
    st_path,
    "    new Setting(root).setName(\"Citation lookup\").setHeading();\n    root.createEl('p', {\n      text:\n        'Look up papers by doi or title using crossref and openalex. Disabled by default — enable it to unlock the \ud83d\udd0d lookup button in the paper import form.',\n      cls: 'setting-item-description',\n    });",
    "    new Setting(root).setName(\"Citation lookup\").setHeading();\n    root.createEl('p', {\n      // Privacy-first disclosure per plan.md §4.1.D — the wording the research doc\n      // specifies verbatim so users can trust what the feature sends over the wire.\n      text:\n        'Lookups send only the doi or search string. We do not send your vault contents, file names, or paper notes. No analytics. Api responses are cached locally for 30 days.',\n      cls: 'setting-item-description',\n    });",
)


print("\n[DONE] All three drifts patched. Run: npm run build && npm run lint")
