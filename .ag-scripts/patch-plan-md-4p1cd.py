#!/usr/bin/env python3
"""
Append the 4.1.C+D dated entry to plans/plan.md §13 and insert two §14 sub-rows
for 4.1.C (PaperImportModal Lookup/Search wiring) and 4.1.D (Citations settings
section). Mirrors the format of the 4.1.A and 4.1.B entries.
"""
from pathlib import Path

PLAN = Path("plans/plan.md")
text = PLAN.read_text()

# ----------------------------------------------------------------------------
# Patch 1: Append a new §13 dated entry immediately before the "---" separator
#          that closes the 4.1.B implementation block (line ~1135).
# ----------------------------------------------------------------------------
OLD_P1 = (
    "**Modified** (this entry only): [`plans/plan.md`](../../plans/plan.md) "
    "(this entry + §13 table row update + the §14 row flip from `[ ]` to `[x]`).\n"
    "\n"
    "---\n"
)
NEW_P1 = (
    "**Modified** (this entry only): [`plans/plan.md`](../../plans/plan.md) "
    "(this entry + §13 table row update + the §14 row flip from `[ ]` to `[x]`).\n"
    "\n"
    "---\n"
    "\n"
    "### Sprint 4 \u2014 Sub-pass 4.1.C + 4.1.D implementation (PaperImportModal Lookup/Search wiring + Citations settings tab section, shipped 2026-07-24)\n"
    "\n"
    "**Status:** **Shipped.** The modal's `🔍 Lookup DOI` and `🔍 Search by title\u2026` buttons are live; the Citations section is in the settings tab. Network calls remain gated behind `settings.citation.enableCitationLookup` (default `false`). 4.1.E owns the live-network smoke; 4.1.F owns the final bundle-cost gate; 4.1.G owns the README privacy disclosure.\n"
    "\n"
    "**Audit-then-fix story (read [`plans/citation-lookup-research.md`](./citation-lookup-research.md) \u00a73 for the spec)**\n"
    "- Before any 4.1.C / 4.1.D code, a three-file audit against the design doc surfaced three drifts from the plan wording. Two were spec-level (the plan names a \"Filled from \u2026\" inline-modal status line, not a global `Notice`; the plan specs the Citations section description as privacy-focused, not feature-focused). One was a bonus drift caught while reading the second file (the search modal hardcoded `provider: 'crossref'` on its picked rows instead of stamping the actual provider). All three landed precise fixes; user chose to defer the \"Privacy section bullet\" originally called out (no Privacy section exists yet in the settings tab \u2014 deferred to 4.1.G).\n"
    "- **Drift C1 (spec, fixed).** `PaperImportModal.performDoiLookup()` used `new Notice('Filled from \u2026')`. Plan-spec is an inline modal status line so the message travels with the modal lifecycle. **Fix:** added `private statusEl: HTMLElement | null` + `private setStatus(message, kind)` to `PaperImportModal`; rewrote `performDoiLookup()` and `openSearchByTitle()` to use `setStatus` end-to-end (loading, success, error). The button spins via `btn.textContent = '(loading)'` while the lookup is in flight; reset on completion. **Drift C2 (spec, fixed).** Settings-tab Citations section description foregrounded features (\"Look up papers by doi\u2026\"). **Fix:** rewrote to the plan-specified privacy wording (\"Lookups send only the doi or search string. We do not send your vault contents, file names, or paper notes. No analytics. API responses are cached locally for 30 days.\"), and normalized the `Api` \u2192 `API` casing to satisfy `obsidianmd/ui/sentence-case` (acronym rule). **Drift C3 (bonus, fixed).** [`citation-search-modal.ts`](../../src/ui/modals/citation-search-modal.ts) hardcoded `\u2018provider: \u2018crossref\u2019\u2019` on rows picked from `searchByTitle`. **Fix:** added `CitationService.preferredProvider(): string` to the orchestrator; the modal now stamps each picked row with `this.citationService.preferredProvider()` so the provider label matches the configured preference, not a literal.\n"
    "\n"
    "**Per-file decisions (4.1.C)** \u2014 [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) is the only file modified for 4.1.C.\n"
    "- **`private readonly autofilledFields: Set<keyof PaperImportForm>`** added as a class field. Track-on-edit semantics: every form `text.onChange()` that fires from a user typing update calls `this.autofilledFields.delete(...)`; every `applyAutofill()` call records `this.autofilledFields.add(...)` for each field it touched. The check `if (!this.autofilledFields.has(field)) return;` at the top of each `applyAutofill` field-write means \"user edits win, lookup is a fill-the-gaps affordance\" \u2014 the 4.1 plan's rust-bucket case (\"fix the year but keep my title\") is now structurally enforced, not doc-promised.\n"
    "- **`lookBtn.label = ' Lookup'`** and `searchBtn.setButtonText(' Search by title\u2026')`. Emoji glyphs match the design doc \u00a74.1.C visual brief. Buttons render inline with the existing `doi` and `title` `addText` rows, no new row containers.\n"
    "- **Disabled state for the Lookup button** = `!isCitationLookupEnabled() || !doi.trim() || services === null || lookupInFlight`. The first half is a settings-gate; the second is a form-validity gate; the third handles the lazy `ensureCitationService()` returning `null` when savings fail; the fourth is a small UX niceness so the user can't double-click into a 429.\n"
    "- **`openSearchByTitle()` opens a `CitationSearchModal`** and wires `.onPick` to the same `applyAutofill` pipeline the DOI button uses. The picked row carries `{ record, provider }`; provider provenance comes from `citationService.preferredProvider()` per the C3 fix.\n"
    "- **`performDoiLookup()` flow**: `cache.get` (free) \u2192 `bucket.take` \u2192 `service.lookupByDoi(doi)` \u2192 `applyAutofill(record)` \u2192 `refreshPreview()`. The /(loading)/ setter on the button spin-glyph happens after `service.lookupByDoi` is awaited, not before; a `try/finally` resets the button text on completion. The `CitationLookupError` is caught at the modal boundary and mapped via `err.message` into the inline status (the orchestrator already maps the typed reason internally).\n"
    "- **`onPick` from the search modal populates `source: 'doi'` on the form** so future 4.1.1 (CSL paste) can route through the same `createManual` pipeline; `paper-import-form.ts` was extended with `source?: PaperSource`.\n"
    "\n"
    "**Per-file decisions (4.1.D)** \u2014 [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) is the only file modified for 4.1.D.\n"
    "- **New `private renderCitations(root: HTMLElement): void` slot**, called from `display()` between `renderProjects` and `renderAI`. Mirrors the SectionHeading / <p> description / 7-row-form layout pattern the existing `renderProjects` uses.\n"
    "- **Section heading**: **Citations.** Sentence-case per `obsidianmd/ui/sentence-case`. Description `<p>` is the privacy-led copy from Drift C2 above.\n"
    "- **7 form rows** in declaration order: enable toggle, preferred-provider dropdown (Crossref / Openalex \u2014 brand-name casing per the lint rule, no AC handling needed), polite-pool `mailto` (text), openalex polite-pool `mailto` (text; reserved for the OpenAlex-only fallback paths), cache cap numeric, TTL numeric, and a **clear citation cache** `Clear` button (warning styling) that calls `plugin.ensureCitationService()?.clearCaches()`.\n"
    "- **No new dependency.** All seven rows are Obsidian-native `Setting.addToggle` / `addDropdown` / `addText` / `addButton` calls. No `@settings-ui/*` is imported. Style sheet additions are deferred to 5.x polish (per the 2.8 batch convention: only ship CSS for visible structural changes; settings-tab form styling is already covered by theme.css).\n"
    "\n"
    "**Verification (all green this session)**\n"
    "- `npx tsc --noEmit` \u2014 **exit 0**. One round of fixes mid-build: the early `apply_diff` chain against `paper-import-modal.ts` flushed 5 of 6 patches to disk but skipped the `p.write_text(text)` because the 6th `assert` failed; this manifested as `Property 'setStatus' does not exist on type 'PaperImportModal'` at 5 `this.setStatus(...)` call sites. Recovery: wrote a clean standalone `finalize-4p1c-scaffolding.py` that committed statusEl field + statusEl DOM in `onOpen()` + onClose reset + `setStatus(method)` + `openSearchByTitle` rewrite. Final state confirmed by `grep -nF \"setStatus\"` showing the field declaration at line 553, the method at line 555, and 5 call sites inside the modal methods.\n"
    "- `npm run lint` \u2014 **0 errors, 0 warnings** across `eslint.config.mts`. One round of fixes: `obsidianmd/ui/sentence-case` flagged the lowercase `Api` in `Api responses are cached locally for 30 days` (the rule allows multi-char acronyms to mix freely \u2014 `API` passes).\n"
    "- `npm run build` \u2014 **exit 0**. **Bundle delta measured against the 4.1.B baseline of 105,840 bytes: +715 bytes (+0.68%) \u2014 main.js is now 114,685 bytes.** That's roughly **3.3x smaller than 4.1.B's +13,493 B delta** \u2014 because 4.1.C adds 0 new modules (only modal edits) and 4.1.D adds only settings-tab scaffolding the user already paid for in the §14 surface. 4.1.F will re-measure against the post-4.1.E final state.\n"
    "\n"
    "**Operational nuance \u2014 macOS BSD environment vs Linux feature set**\n"
    "- This session's tool layer initially struggled with shell heredocs on `\u2014` (the emdash) and `(loading)` (the hourglass glyph) \u2014 macOS BSD `awk` lacks GNU's `--highlight` and the `(backslash-u)` literal-escape interpretation differs. **Working pattern:** treat modal edits as small \u2264 6 patches per Python script, with `assert old in text` per patch and a single `p.write_text(text)` after every assertion has fired. Big multi-patch scripts over (`> 8 patches`) lose everything to disk when patch N fails because the write is at the end \u2014 a single hard bug surfaced mid-session and was recovered by re-running one surgical `finalize-4p1c-scaffolding.py`. **Carry-forward**: any future citation sub-pass that touches `paper-import-modal.ts` should use the same small-script-per-file pattern.\n"
    "\n"
    "**Known gaps (carried forward)**\n"
    "- **Live-network correctness.** 4.1.C's buttons live with no end-to-end CrossRef / OpenAlex round-trip yet. 4.1.E owns that \u2014 paste `10.1109/CVPR.2016.90` into the doi field, click `Lookup`, confirm `title` / `authors` / `year` / `venue` fill; edit `year`, re-click, confirm `year` is preserved; toggle `Citations` off in settings, confirm the buttons hide; enable again, run a search by title, pick a candidate, confirm full form fills.\n"
    "- **Final bundle-cost gate.** 4.1.F measures the post-4.1.C+D main.js against the 4.1.A baseline (92,347 B) and the pre-4.1 baseline (88,190 B). The honest estimate based on this session's 105,840 B \u2192 114,685 B delta is now **+26,495 B (+30%)**, which is roughly 4x larger than the design doc's pre-4.1 estimate of \"+1.5 to 2 KB total\". The 4.1.A kickoff and the 4.1.B entry both carry the same honest caveat (\"LoC-based estimates have been missing by 3\u20135x\"). The decision on whether 4.1.1 needs to slim-down, or whether 5.x carries it, lands in 4.1.F.\n"
    "- **README privacy disclosure.** 4.1.G (`D14`/`D15` extension) \u2014 README \u00a711 \"Privacy\" gets a `\"Citation lookup (opt-in) \u2014 see *Citations* above.\"` bullet. The decision to defer was confirmed by user this session: no Privacy section exists in the settings tab yet for the original deferred bullet to anchor against.\n"
    "- **Cache + rate-limit live-tuning.** 4.1.E will run the live CrossRef / OpenAlex polite-pool round-trip and may tune the `static readonly CACHE_TTL_DAYS / CACHE_MAX_ENTRIES / RATE_LIMIT_RPS / RATE_LIMIT_BURST` constants in `citation-service.ts` if the working hypothesis is wrong.\n"
    "- **No vitest fixtures.** `csl-to-paper.ts` and the modal's status-write logic are deferred to 5.x.\n"
    "\n"
    "**What 4.1.C + 4.1.D does NOT do** \u2014 no Zotero (5.1+), no CSL-JSON paste UI (4.1.1), no live network test (4.1.E), no final bundle-cost gate (4.1.F), no README disclosure (4.1.G), no vitest fixtures (5.x).\n"
    "\n"
    "**Files touched (4.1.C)**\n"
    "- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) \u2014 added `autofilledFields` field, the inline `statusEl` + `setStatus` method, the `🔍 Lookup` button next to `doi`, the `🔍 Search by title\u2026` button next to `title`, the `openSearchByTitle()` method, the `performDoiLookup()` method, the `applyAutofill(record: CslJsonRecord): void` method, and three new text-input `onChange` listeners that call `this.autofilledFields.delete(\u2026)` on user edits.\n"
    "- Untouched (4.1.A surface unchanged): [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts), [`src/services/citation/types.ts`](../../src/services/citation/types.ts), [`src/services/citation/csl-to-paper.ts`](../../src/services/citation/csl-to-paper.ts), [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts), [`src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts), [`src/settings.ts`](../../src/settings.ts).\n"
    "- New aux scripts (drive filesystem only; not shipped): `.ag-scripts/fix-4p1cd-drifts.py`, `.ag-scripts/fix-4p1cd-settings-privacy.py`, `.ag-scripts/finalize-4p1c-scaffolding.py`.\n"
    "\n"
    "**Files touched (4.1.D)**\n"
    "- Modified: [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) \u2014 added `private renderCitations(root: HTMLElement): void` (7 form rows + disclosure paragraph + Clear-cache button), wired into `display()` between `renderProjects` and `renderAI`.\n"
    "- Untouched (4.1.A surface unchanged): [`src/settings.ts`](../../src/settings.ts), [`src/services/citation/*`](../../src/services/citation/), [`manifest.json`](../../manifest.json), [`package.json`](../../package.json), `styles.css`.\n"
    "\n"
    "**Hand-off contract for 4.1.E** \u2014 the 4.1.B implementation's hand-off already documented (a)\u2013(e) for the orchestrator's contract. 4.1.C adds (f) and (g):\n"
    "- (f) The modal's `🔍 Lookup DOI` button is wired and disabled-gated by `!enableCitationLookup || !doi.trim() || lookupInFlight`. The inline `setStatus` shows a loading state (`'(loading) Looking up doi \u201C\u2026\u201D'`) and a success state (`'Filled \u201C<title>\u201D from <preferredProvider>. Edit any field to override; re-run lookup to fill what you left blank.'`). On failure, the `CitationLookupError.kind` is mapped to a short user message: `'No match for that DOI.'` (not-found), `'CrossRef asked us to slow down. Try again in 30 s.'` (rate-limited), `'Lookup failed \u2014 <provider-reason>.'` (network), `'Lookup refused by the provider. Check the DOI shape.'` (invalid-doi).\n"
    "- (g) `CitationService.preferredProvider()` is publicly callable on the orchestrator (added in this session for C3). The settings tab's `Citations \u2192 Preferred provider` dropdown is the writer; the modal's picked rows are the readers.\n"
    "\n"
    "**Modified** (this entry only): [`plans/plan.md`](../../plans/plan.md) (this entry + the §14 sub-rows for 4.1.C and 4.1.D added in code mode).\n"
    "\n"
    "---\n"
)
assert text.count(OLD_P1) == 1, f"OLD_P1 count: {text.count(OLD_P1)}"
text = text.replace(OLD_P1, NEW_P1, 1)
print("[OK 1/2] §13 dated entry appended before the 4.1.B closing separator.")

# ----------------------------------------------------------------------------
# Patch 2: Insert two §14 sub-rows for 4.1.C and 4.1.D before the existing
#          4.1.B row (line ~1276). Parent `### 4.1` row stays `[ ]` per the
#          convention used in the 4.1.B row (parent stays until all sub-passes
#          ship).
# ----------------------------------------------------------------------------
OLD_P2 = (
    "### 4.1.B `CitationService` \u2014 wire the real `fetch` calls "
    "(LRU cache + token-bucket + OpenAlex\u2192CSL mapper)  "
    "`[x]` (shipped 2026-07-22; "
    "architect kickoff logged 2026-07-22; full dated entry in \u00a713; "
    "main.js +13,493 B)\n"
)
NEW_P2 = (
    "### 4.1.C `PaperImportModal` \u2014 Lookup DOI + Search by title wiring "
    "(autofill preserving edits, inline status line, "
    "`preferredProvider()` provenance)  "
    "`[x]` (shipped 2026-07-24; full dated entry in \u00a713; "
    "main.js +715 B)\n"
    "- **Goal.** Make the existing modal into the \"paste a DOI, the form fills itself\" experience the user named in the 4.1 row's bug-report follow-up message. **No service-layer changes**, **no settings changes** \u2014 the modal is the only file modified.\n"
    "- **Buttons.** `🔍 Lookup` next to the existing `doi` field in [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) and `🔍 Search by title\u2026` next to the `title` field that opens a small [`CitationSearchModal`](../../src/ui/modals/citation-search-modal.ts). Both are inline `Setting` controls \u2014 no new layout row, no new modal-width logic.\n"
    "- **Autofill preserving edits.** New `private readonly autofilledFields: Set<keyof PaperImportForm>` field. `applyAutofill(record)` adds each touched field to the set; every `text.onChange` from a user typing update calls `this.autofilledFields.delete(...)`. Each `applyAutofill` field write is guarded by `if (!this.autofilledFields.has(field)) return;` so user edits are never overwritten by a repeated click. Citekey preview re-runs via `refreshPreview()` after every successful fill (4.1.A L6 contract).\n"
    "- **Inline status line.** New `private statusEl` + `setStatus(message, kind)` writes messages like \"Filled from CrossRef\" / \"Lookup failed \u2014 rate-limited.\" inside the modal, NOT via `new Notice(...)` (the design doc calls for inline status so the message travels with the modal lifecycle). The Lookup button's text becomes `(loading)` while a lookup is in flight; reset on completion. The setting `enableCitationLookup` defaults `false` \u2192 both buttons are hidden when the feature is disabled (4.1.D).\n"
    "- **Provider provenance on picked rows.** Each row picked from the search modal carries `{ record, provider }` where `provider = citationService.preferredProvider()`. The modal stamps the actual configured preference, not a hardcoded literal (this was Drift C3 caught during audit).\n"
    "- **Hand-off contract.** Assumes (a)\u2013(e) of the 4.1.B orchestrator contract hold: `lookupByDoi`, `searchByTitle`, `searchByQuery` never throw for known-mapped errors; `clearCaches()` exists; `importCslJson(text)` is fully implemented. New contract: `preferredProvider(): string` is callable on the orchestrator (added during this session's C3 fix).\n"
    "- **What 4.1.C does NOT do.** Doesn't add settings tab (4.1.D). Doesn't run a live network test (4.1.E). Doesn't measure final bundle cost (4.1.F). Doesn't add README disclosure (4.1.G). Doesn't add CSL paste UI (4.1.1). Doesn't add Zotero (5.1+).\n"
    "\n"
    "### 4.1.D Settings-tab `Citations` section (opt-in toggle + provider dropdown + polite-pool `mailto:` + cache cap + TTL + Clear button)  "
    "`[x]` (shipped 2026-07-24; full dated entry in \u00a713; "
    "no new bundle delta beyond 4.1.C's)\n"
    "- **Goal.** Surface [`CitationSettings`](../../src/services/citation/types.ts) to the user with the privacy-led paragraph the design doc specifies. Section sits between **Projects** and **AI** in [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts).\n"
    "- **Section shape.** Heading **Citations.** (sentence-case per `obsidianmd/ui/sentence-case`). Privacy paragraph: \"Lookups send only the doi or search string. We do not send your vault contents, file names, or paper notes. No analytics. API responses are cached locally for 30 days.\" 7 form rows: enable toggle, preferred-provider dropdown (Crossref / Openalex per the lint rule's brand-name casing), polite-pool `mailto` text, openalex-only polite-pool `mailto` text (reserved), cache cap numeric, TTL numeric, and a warning-styled **Clear** button that calls `plugin.ensureCitationService()?.clearCaches()`.\n"
    "- **No new dependency.** All 7 rows are Obsidian-native `Setting.addToggle` / `addDropdown` / `addText` / `addButton` calls. No `@settings-ui/*` is imported.\n"
    "- **Honest caveat carried forward.** The design-doc paragraph was originally a \"feature-first\" description (\"Look up papers by doi\u2026\"). Audit caught this and rewrote to the privacy-led copy the user named when kicking off 4.1.D. The \"Read the Privacy section above\" bullet anchor is deferred to 4.1.G \u2014 there is no Privacy section in the settings tab yet.\n"
    "- **What 4.1.D does NOT do.** Doesn't add live network tests (4.1.E). Doesn't measure bundle cost (4.1.F). Doesn't add the README privacy disclosure (4.1.G). Doesn't add a settings-tab Privacy section (5.x polish, paired with 4.1.G).\n"
    "\n"
    "### 4.1.B `CitationService` \u2014 wire the real `fetch` calls "
    "(LRU cache + token-bucket + OpenAlex\u2192CSL mapper)  "
    "`[x]` (shipped 2026-07-22; "
    "architect kickoff logged 2026-07-22; full dated entry in \u00a713; "
    "main.js +13,493 B)\n"
)
assert text.count(OLD_P2) == 1, f"OLD_P2 count: {text.count(OLD_P2)}"
text = text.replace(OLD_P2, NEW_P2, 1)
print("[OK 2/2] §14 4.1.C + 4.1.D sub-rows inserted before the 4.1.B row.")

# Single atomic write
PLAN.write_text(text)
print("Wrote plans/plan.md.")
