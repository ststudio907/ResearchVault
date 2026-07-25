#!/usr/bin/env python3
"""
Post-2.8 doc update — written and run 2026-07-14.

1. plans/ui-polish-2.8-research.md
   - line 49 headline (already done in previous run — skip)
   - "Sidebar search focus" section body — flip to past-tense "shipped fix" framing

2. plans/plan.md
   - §13 in-progress / queued table: add 2.8 row + 2.9 row
   - §13 append: 2.8 dated entry (before research-spike)
   - §14 upcoming: 2.8 strike-through row + 2.9 detailed phase plan
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def replace_once(path: Path, old: str, new: str, *, count: int = 1) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != count:
        raise SystemExit(
            f"{path}: expected exactly {count} occurrence(s) of anchor, "
            f"found {text.count(old)}"
        )
    path.write_text(text.replace(old, new, count), encoding="utf-8")
    print(f"  ok  {path.relative_to(ROOT)} (1 edit)")


# ---------------------------------------------------------------------------
# 1) plans/ui-polish-2.8-research.md — flip the focus section body to
#    past-tense / shipped-fix framing. (Line 49 headline + line 409 section
#    title were already flipped by the previous run.)
# ---------------------------------------------------------------------------

design_doc = ROOT / "plans" / "ui-polish-2.8-research.md"

# 1a) body opening paragraph (path is on one line — this is the corrected
#     anchor; the previous run had a stray line break after `../../src/ui/views/`).
old_body_open = (
    "The user reports: \"after one letter is typed, it seems to de-select the search\n"
    "bar\". Looking at the code ([`projects-sidebar-view.ts:218-234`](../../src/ui/views/projects-sidebar-view.ts)):\n"
    "\n"
    "- We create the input with `createEl('input', { type: 'search', ... })`.\n"
    "- We `addEventListener('input', ...)` and on each input event we call "
    "`this.render()` after an 80 ms debounce.\n"
    "- `render()` does `this.contentEl.empty()` then re-creates the children."
)
new_body_open = (
    "The user reports: \"after one letter is typed, it seems to de-select the search"
    "bar\". Investigation showed it was **our** bug. Looking at the old code "
    "([`projects-sidebar-view.ts:218-234`](../../src/ui/views/projects-sidebar-view.ts)):\n"
    "\n"
    "- We created the input with `createEl('input', { type: 'search', ... })`.\n"
    "- We `addEventListener('input', ...)` and on each input event we called "
    "`this.render()` after an 80 ms debounce.\n"
    "- `render()` did `this.contentEl.empty()` then re-created the children."
)
replace_once(design_doc, old_body_open, new_body_open)

# 1b) "This is the bug" -> past-tense "This was the bug".
old_was_bug_para = (
    "**This is the bug.** Each re-render blows away the input element and "
    "creates a new one. The new element has the same value, but the *focus* "
    "and the *caret position* are lost after the first input event fires. "
    "After 80 ms the new input gets created; on the very next keystroke the "
    "same thing happens — the user types a letter, the input event fires, "
    "after 80 ms the element is replaced, the new element is unfocused, the "
    "user has to click again."
)
new_was_bug_para = (
    "**This was the bug.** Each re-render blew away the input element and "
    "created a new one. The new element had the same value, but the *focus* "
    "and the *caret position* were lost after the first input event fired. "
    "After 80 ms the new input was created; on the very next keystroke the "
    "same thing happened — the user typed a letter, the input event fired, "
    "after 80 ms the element was replaced, the new element was unfocused, the "
    "user had to click again."
)
replace_once(design_doc, old_was_bug_para, new_was_bug_para)

# 1c) "The fix is **not** to re-render" -> "The fix was to stop re-rendering".
old_fix_open = (
    "The fix is **not** to re-render the whole view on every keystroke. Two "
    "options:"
)
new_fix_open = (
    "The fix was to **stop re-rendering the whole view on every keystroke**. "
    "Two options were considered:"
)
replace_once(design_doc, old_fix_open, new_fix_open)

# 1d) "Recommendation: option 1" -> "Shipped: option 1" + body in present-tense.
old_recommendation = (
    "**Recommendation: option 1.** The header is a fixed shape; only the list "
    "of papers below it changes. Refactor `render()` to:"
)
new_recommendation = (
    "**Shipped: option 1.** The header is a fixed shape; only the list of "
    "papers below it changes. `render()` was refactored to:"
)
replace_once(design_doc, old_recommendation, new_recommendation)

# 1e) bullet list under that — present -> past tense.
old_split_bullets = (
    "- `renderHeader()` — called once on `onOpen` and on project switch. Re-creates the search input.\n"
    "- `renderList()` — called on every state change. Re-creates the paper rows. Does **not** touch the header."
)
new_split_bullets = (
    "- `renderHeader()` — called once on `onOpen` and on project switch. Mounts the search input inside a persistent header div that is never re-rendered.\n"
    "- `renderList()` — called on every state change (search input, paper upsert, status flip, project switch). Re-renders the paper rows only. Does **not** touch the header.\n"
    "- The search input's `input` listener calls only `renderList()` after the debounce, so the input element is never replaced mid-typing."
)
replace_once(design_doc, old_split_bullets, new_split_bullets)

# 1f) closing paragraph — present/future -> past/present.
old_closing = (
    "This is a small refactor (3-4 functions touched) and is the right "
    "structural fix. Worth shipping as part of 2.8 even though the user is "
    "right that \"it could be Obsidian\" — it's actually our code, and the "
    "fix is small."
)
new_closing = (
    "The refactor touched `renderHeader`, `renderList`, the `searchInput` "
    "`input` listener, the `onOpen` listener wiring, and the four "
    "event-bus subscriptions (`paperImported`, `paperStatusChanged`, "
    "`projectChanged`, `indexUpdated`) — each calls only `renderList()` now. "
    "Total LoC: ~30 lines reshuffled, no new types, no new services. The "
    "user's hunch that \"it could be Obsidian\" was wrong — it was our code."
)
replace_once(design_doc, old_closing, new_closing)

# 1g) the Surface block under the section — present -> past tense.
old_surface = (
    "### Surface\n"
    "\n"
    "- Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — split `render()` into `renderHeader()` + `renderList()`. `onOpen` calls both. The `paperImported` / `paperStatusChanged` / `projectSwitched` listeners call only `renderList()`. The search input event listener calls only `renderList()`. The search input itself lives inside the header div which is not re-rendered."
)
new_surface = (
    "### Surface (shipped)\n"
    "\n"
    "- Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — split `render()` into `renderHeader()` + `renderList()`. `onOpen` calls both. The `paperImported` / `paperStatusChanged` / `projectChanged` / `indexUpdated` listeners call only `renderList()`. The search input event listener calls only `renderList()`. The search input itself lives inside a persistent header div which is never re-rendered after `onOpen`."
)
replace_once(design_doc, old_surface, new_surface)

print("design doc: 6 edits applied (line 49 + line 409 already done by previous run)")
print()

# ---------------------------------------------------------------------------
# 2) plans/plan.md
# ---------------------------------------------------------------------------

plan = ROOT / "plans" / "plan.md"
text = plan.read_text(encoding="utf-8")

# 2a) In the §13 in-progress / queued table, add a 2.8 row + a 2.9 row.
old_2manualsmoke_row = (
    "| 2.manual-smoke | Drop plugin into a real vault, click through, document results in PR "
    "| 2 Phase G | **Re-deployed 2026-07-13 with the 2.7.1 `D28` priority-fix build (link-only PDF + manual metadata wins).** Bundles: first-pass 2026-07-12 (main.js 85.0 KB, styles.css 8.6 KB, pdf.worker.min.mjs 1343.6 KB); second-pass 2026-07-13 after `D27` re-scope (main.js 85.4 KB, styles.css 8.6 KB, no worker file — stale `pdf.worker.min.mjs` deleted from the test vault); third-pass 2026-07-13 after `D28` priority fix (main.js **84.1 KB**, styles.css 8.6 KB, no worker file). `data.json` snapshot saved next to the plugin (`data.json.pre-smoke.json`). Scorecard steps 8–9 still reflect the link-only expectation; step 4 (manual-only + PDF attach) added in 2.7.1. Click-through still pending. |"
)
new_2manualsmoke_row = old_2manualsmoke_row + (
    "\n"
    "| 2.8 | UI / data-format polish batch — modal width, drop-zone copy, `YYYY-MM-DD | HH:MM` dates, `dateModified` re-stamp on body edit, authors as YAML list of last-name strings | 2 | **Source-complete 2026-07-14.** lint / tsc / build / deploy all green. `main.js` 86.1 KB (+2 KB from 2.7.1). Manual click-through pending (2.8.smoke). |"
    "\n"
    "| 2.9 | Sidebar filter chip row (status / priority / year / hasPdf / hasNotes) + author autocomplete + saved filter state per project | 2 | **Planned, not started.** Detailed phase plan in §14 below. Pairs with the existing 2.8.Sidebar split-render refactor. |"
)
if text.count(old_2manualsmoke_row) != 1:
    raise SystemExit(f"2manual-smoke row anchor not unique (found {text.count(old_2manualsmoke_row)})")
text = text.replace(old_2manualsmoke_row, new_2manualsmoke_row, 1)
print("  ok  plans/plan.md (§13 in-progress: 2.8 + 2.9 rows added)")

# 2b) Append the 2.8 dated entry to §13 just before the research-spike heading.
old_research_spike_heading = "### Sprint 4 — Research spike (Citation lookup + Zotero integration scoping, logged 2026-07-14)"
new_2_8_dated_entry = (
    "### Sprint 2 — Sub-pass 2.8 (UI / data-format polish batch — shipped 2026-07-14, manual smoke pending)\n"
    "\n"
    "**Why this sub-pass exists.** After the 2.7.1 (`D28`) click-through the user filed five small UI/data-format asks plus a sidebar focus bug, all of which belong in the same sub-pass so the modal-width and date/author format changes land together. Full design + open-question round in [`plans/ui-polish-2.8-research.md`](./ui-polish-2.8-research.md). Q&A decisions signed off 2026-07-14 are listed at the bottom of that doc.\n"
    "\n"
    "**What shipped (source-complete; manual click-through pending as 2.8.smoke)**\n"
    "- **2.8.A — Modal width (640 px, shared util).** New [`src/ui/modals/modal-width.ts`](../../src/ui/modals/modal-width.ts) exporting `applyStandardModalWidth(modal)` (sets `modal.modalEl.style.width = '640px'` plus `max-width: 90vw` for narrow viewports). All four modals ([`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts), [`QuoteCaptureModal`](../../src/ui/modals/quote-capture-modal.ts), [`CreateProjectModal`](../../src/ui/modals/create-project-modal.ts), [`SwitchProjectModal`](../../src/ui/modals/create-project-modal.ts)) call it at the top of `onOpen()`.\n"
    "- **2.8.B — Drop-zone copy.** \"or drag a PDF file here\" → **\"Drag and drop PDF here\"** in the drop-zone info row of [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts). One-line UI copy change.\n"
    "- **2.8.Sidebar — Sidebar render split + focus fix + search quality.** [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) split `render()` into `renderHeader()` (mounts the search input once) + `renderList()` (re-renders paper rows on every state change). The search input now lives inside a persistent header div and is never re-created on input events, so focus + caret position survive keystrokes. Fuse config in [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) relaxed: `minMatchCharLength: 1`, `threshold: 0.4` (was `2` and `0.35` — the old config made 1-character queries return nothing and partial-prefix queries like `vaswan` miss `vaswani`).\n"
    "- **2.8.C — Date format on paper notes.** [`src/utils/format-date.ts`](../../src/utils/format-date.ts) gained [`toLocalDateTime`](../../src/utils/format-date.ts:95) emitting `YYYY-MM-DD | HH:MM` in the user's local timezone. [`src/services/paper-service.ts`](../../src/services/paper-service.ts) `toFrontmatter` now uses the new format. The previous `toIsoDateTime` (UTC with `Z` and ms) is kept for tests as `toIsoDateTimeUtc`. **No migration** — `fromFrontmatterDate` round-trips both old and new formats via `Date.parse`.\n"
    "- **2.8.D — `dateModified` re-stamp on body edit + Needs-action proxy rewire.** [`src/services/paper-service.ts`](../../src/services/paper-service.ts) gained `onPaperFileModified(file)` (public — `plugin.ts` calls it) and a private `findByPath(filePath)` helper. The handler re-stamps `paper.dateModified` to `Date.now()` when a paper file's body or frontmatter is modified outside the plugin, then re-persists only the frontmatter. A 2-second loop guard (`if (next - paper.dateModified < 2_000) return`) suppresses our own `persistPaper` write from re-stamping a second time. [`src/core/plugin.ts`](../../src/core/plugin.ts) registers the `vault.on('modify', ...)` listener inside the existing `registerVaultSync` method, which also still calls `syncFromFile` for frontmatter re-syncs. Side effect: \"Needs action\" used `paper.dateModified` as the staleness proxy, so every body edit reset the staleness clock and an actively-annotated paper silently disappeared from \"Needs action\". [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) `computeNeedsAction` / `sortNeedsAction` / `needsActionReason` now use `paper.dateAdded` (stable creation-age proxy) instead, so the staleness clock measures \"how long has this been on the list\", not \"how long since I last hit save\".\n"
    "- **2.8.E — Authors as YAML list of last-name strings + optional parallel first-names array.** Breaking type change in [`src/types/literature.ts`](../../src/types/literature.ts): `Paper.authors: Author[]` → `string[]` (last names), plus new `Paper.authorFirstNames?: string[]` (parallel first names, optional, written only when at least one is non-empty). YAML emits `- Vaswani` instead of `- {firstName: Ashish, lastName: Vaswani}` — Obsidian's tag search picks up the plain string form, which was the user's main ask. [`src/services/paper-service.ts`](../../src/services/paper-service.ts) `frontmatterToPaper` handles three shapes for backward compat: new last-only, new with parallel firstNames, legacy `{firstName, lastName}` object form. `toFrontmatter` writes both arrays. `templateDataFor` joins `${first} ${last}` per author when `authorFirstNames` exists, else lastNames only. `papersEqual` excludes `authorFirstNames` from equality so a user editing only the first-name array doesn't flip equality. [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) `projectFor` joins plain last names with optional parallel first names. [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) gained a new `firstNames` parallel input in the author rows and a `buildAuthorRows` helper that heuristically splits the last token off a multi-token name when no parallel first name is supplied. Lintfix added a small `coerceFrontmatterScalar(value: unknown): string` helper to replace two flagged `String(s ?? '')` calls.\n"
    "\n"
    "**Architectural decisions added this sub-pass**\n"
    "- **No new `D` decision numbers.** 2.8's changes ride on the existing `D22`–`D28` decisions and don't introduce any new locked rules. The focus-fix and the Needs-action proxy rewire are both *behavioural* changes, not schema / architecture changes, so they don't need a new `D`-slot.\n"
    "\n"
    "**Verification (machine gates — all green)**\n"
    "- `npm run lint` — exit 0; zero errors / zero warnings.\n"
    "- `npx tsc --noEmit` — exit 0.\n"
    "- `npm run build` — exit 0; `main.js` regenerated at **86.1 KB** (+2.0 KB from 2.7.1's 84.1 KB; delta covers the `coerceFrontmatterScalar` helper, `buildAuthorRows` heuristic, `onPaperFileModified` / `findByPath` helpers, and the search-quality Fuse config switch).\n"
    "- `node scripts/deploy-to-obsidian.mjs` — exit 0; artifacts copied to the test vault. The 2.8 bundle replaces the 2.7.1 build; `data.json` snapshot is untouched.\n"
    "\n"
    "**Manual smoke (2.8.smoke — pending human click-through)**\n"
    "1. Open `PaperImportModal` and `QuoteCaptureModal` side by side — confirm the widths match and the drop zone fits the new copy comfortably.\n"
    "2. Open the modal, fill in title/author/year, click Add. Open the new paper note, confirm `dateAdded` and `dateModified` are `YYYY-MM-DD | HH:MM` in the user's local time (no `T`, no ms, no `Z`).\n"
    "3. Type a character in the body of the paper note, save, confirm `dateModified` re-stamps to the wall clock.\n"
    "4. Edit a paper via the edit modal, type `Ashish Vaswani` as the primary author, save. Open the paper note, confirm the YAML has `authors: - Vaswani` (last-name only) and that the rendered view shows a clean list.\n"
    "5. Type a one-character query (e.g. `a`) in the sidebar search, confirm the input keeps focus and the list filters. Type a partial-prefix query (e.g. `vaswan`), confirm it matches `vaswani_2023_attention`.\n"
    "6. Open a paper that has been sitting in `skimming` for more than 14 days, confirm it still appears in the **Needs action** group (the `dateAdded`-based proxy survives body edits).\n"
    "\n"
    "**Known gaps (carried forward)**\n"
    "- **No real Obsidian click-through yet** — the bundle is deployed but the manual smoke (steps 1–6 above) is the only thing that can prove the focus fix + the Needs-action rewire work end-to-end. Tracked as **2.8.smoke** in the in-progress table above.\n"
    "- **Full sidebar filter overhaul is in 2.9** — 2.8 only fixed the focus loss and the Fuse `minMatchCharLength` / `threshold` pain points. The chip-row + author-autocomplete + saved-filter-state work lives in a separate sub-pass; detailed phase plan in §14 below.\n"
    "\n"
    "**Files touched / added**\n"
    "- Added: [`src/ui/modals/modal-width.ts`](../../src/ui/modals/modal-width.ts) (`applyStandardModalWidth`).\n"
    "- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (drop-zone copy, new firstNames input, `buildAuthorRows` heuristic, submit paths for `createManual` + `updatePaper`), [`src/ui/modals/quote-capture-modal.ts`](../../src/ui/modals/quote-capture-modal.ts) (width), [`src/ui/modals/create-project-modal.ts`](../../src/ui/modals/create-project-modal.ts) (width on both `CreateProjectModal` + `SwitchProjectModal`), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (render split, focus fix, Needs-action proxy rewire), [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (date format writer, `onPaperFileModified` / `findByPath`, author shape readers + writers, `coerceFrontmatterScalar`, `papersEqual` excludes `authorFirstNames`), [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) (`projectFor` joins plain last names, Fuse config relaxed), [`src/core/plugin.ts`](../../src/core/plugin.ts) (modify-handler wires `onPaperFileModified`), [`src/utils/format-date.ts`](../../src/utils/format-date.ts) (`toLocalDateTime` added), [`src/types/literature.ts`](../../src/types/literature.ts) (`Paper.authors: string[]` + `Paper.authorFirstNames?: string[]`), [`plans/ui-polish-2.8-research.md`](./ui-polish-2.8-research.md) (decisions + sign-off appended), [`plans/plan.md`](../../plans/plan.md) (this entry + 2.8/2.9 rows in §13 + phase plan in §14).\n"
    "\n"
    "**Looking ahead**\n"
    "- **2.8.smoke** — human click-through against the test vault. Closes 2.8 once steps 1–6 pass.\n"
    "- **2.9** — full sidebar filter overhaul: status / priority / year / hasPdf / hasNotes filter chip row, author autocomplete popover sourced from the project's `paper.authors` set, optional saved filter state per project. Phase plan in §14 below. The author autocomplete is much simpler now that `Paper.authors` is a flat `string[]` (per 2.8.E).\n"
    "- **4.1** (DOI lookup + free-text search) — unblocks once 2.8.smoke is signed off.\n"
    "\n"
    "---\n"
    "\n"
)
if text.count(old_research_spike_heading) != 1:
    raise SystemExit(f"research-spike heading anchor not unique (found {text.count(old_research_spike_heading)})")
text = text.replace(old_research_spike_heading, new_2_8_dated_entry + old_research_spike_heading, 1)
print("  ok  plans/plan.md (§13 2.8 dated entry appended)")

# 2c) §14 upcoming — add a 2.8 strike-through row right after the 2.6 row
#     (since 2.7.1's work is folded INTO the 2.6 row, not a standalone row).
old_end_of_2_6_row = (
    "Verification gates.** `npm run lint` / `npm run build` / `npx tsc --noEmit` all `exit 0`; `node scripts/deploy-to-obsidian.mjs` clean. Manual click-through at 2.manual-smoke now covers three sub-checks: (a) PDF-only drop still lands in `pdfs/` with a wikilink inside the note; (b) **manual metadata + PDF attach** is the bug-fix case — typed values must appear verbatim in frontmatter and the citekey must be derived from the typed author/year/title, not the basename; (c) edit mode preserves an existing PDF attachment when no replacement is picked."
)
new_2_8_row_suffix = old_end_of_2_6_row + (
    "\n"
    "\n"
    "### 2.8 UI / data-format polish batch (modal width, drop-zone copy, `YYYY-MM-DD | HH:MM` dates, `dateModified` re-stamp, authors as YAML list)  `~~[ ]~~` → **Shipped 2026-07-14 in sub-pass 2.8.** Manual click-through still pending (2.8.smoke). Absorbed into the 2.8 dated entry in §13; see §13 for full details."
)
if text.count(old_end_of_2_6_row) != 1:
    raise SystemExit(f"end-of-2.6 row bullet anchor not unique (found {text.count(old_end_of_2_6_row)})")
text = text.replace(old_end_of_2_6_row, new_2_8_row_suffix, 1)
print("  ok  plans/plan.md (\\u00a714 2.8 strike-through row added after the 2.6 row)")

# 2d) §14 upcoming — 2.9 detailed phase plan slots in just before the
#     2.manual-smoke heading.
old_2_manual_smoke_heading = "### 2.manual-smoke — Phase G  `[ ]` (in flight; first pass 2026-07-12 failed link-only expectations, re-deployed 2026-07-13, then 2026-07-13 again for the `D28` priority fix)"
new_2_9_phase_plan = (
    "### 2.9 Sidebar filter chip row + author autocomplete + saved filter state  `[ ]` (planned, not started)\n"
    "\n"
    "**Goal.** Turn the sidebar search bar from a single fuzzy text input into a *structured filter*: a chip row above the list (status / priority / year / hasPdf / hasNotes) + a typeahead author picker (autocomplete sourced from the project's `paper.authors` set, much simpler after 2.8.E since `authors` is now a flat `string[]`) + optional saved filter state per project. The goal is the same as a Gmail \"filter chips\" or Notion \"filtered view\" — the user can drill in fast without leaving the sidebar.\n"
    "\n"
    "**Why deferred from 2.8.** 2.8 only fixed the focus-loss bug + relaxed Fuse `minMatchCharLength` / `threshold`. The full filter overhaul touches the sidebar view, the vault indexer, the settings tab (saved-filter-state is a per-project preference), and at least one new modal (the author typeahead picker). Worth its own sub-pass to keep 2.8 small and reviewable.\n"
    "\n"
    "**Surface (new files).**\n"
    "- [`src/ui/views/sidebar-filters.ts`](../../src/ui/views/sidebar-filters.ts) — `SidebarFilterState` type (`{ status: ReadingStatus[]; priority: Priority[]; year?: { from?: number; to?: number }; hasPdf?: boolean; hasNotes?: boolean; authorQuery?: string }`), the `applyFilters(items, state, fuse)` helper, the `serializeFilter(state)` / `deserializeFilter(json)` pair, and a `defaultFilter()` factory.\n"
    "- [`src/ui/modals/author-picker-modal.ts`](../../src/ui/modals/author-picker-modal.ts) — small typeahead modal listing the project's distinct `paper.authors` (and `paper.authorFirstNames?` paired display) sorted by descending paper count. Picking an author emits a `filterSet` bus event so the sidebar updates without re-rendering the whole view.\n"
    "\n"
    "**Surface (modified files).**\n"
    "- [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — render a chip row above the existing paper list. Each chip is a small toggle (status: one of `unread`/`queued`/`skimming`/`reading`/`annotating`/`summarized`/`synthesized`/`archived`/`excluded`; priority: one of `low`/`medium`/`high`/`critical`; year: optional from/to fields; hasPdf / hasNotes: boolean toggles). Chips are hidden when the project has no papers in that category. A small \"Filters: 2\" badge in the header (parallel to the existing search input) shows the active filter count. The author picker button lives next to the search input and opens `AuthorPickerModal`.\n"
    "- [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) — `searchPapers` already accepts a `SearchFilters` shape; extend it with the new filter fields (status multi-select, priority multi-select, year range, hasPdf, hasNotes, authorQuery). The `applyFilters` helper inside this file already does most of the work — just thread the new fields through. Re-tune Fuse weights if status/priority text matching becomes confused with title/author matching (status is a categorical enum, so it should be an exact-match check, not a fuzzy match — `IndexedPaper.status === filter.status[i]`).\n"
    "- [`src/types/project.ts`](../../src/types/project.ts) — optional `Project.sidebarFilter?: SidebarFilterState` field. `migrateSettings` 0.4.0 → 0.5.0 step backfills `undefined` for old projects (no migration prompt — empty filter state is the natural default).\n"
    "- [`src/settings.ts`](../../src/settings.ts) — bump `version` to `0.5.0`; add the migration step.\n"
    "- [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) — new per-project section: \"Sidebar default filter\" with a `Reset to default` button + a description of where the filter state is stored (under the project record, not the plugin settings).\n"
    "- [`src/core/events.ts`](../../src/core/events.ts) — new `filterChanged: { projectId: string; state: SidebarFilterState }` bus event so the sidebar list re-renders without re-running Fuse on the project change.\n"
    "\n"
    "**Filter semantics (locked).**\n"
    "- **Within a chip category** (e.g. status), chips OR together. Selecting `reading` + `skimming` means \"status is `reading` OR `skimming`\".\n"
    "- **Across chip categories** (status vs priority vs year vs hasPdf vs hasNotes vs author), categories AND together. Selecting `status:reading` + `priority:high` means \"status is reading AND priority is high\".\n"
    "- **Author query** is a Fuse substring search against the project's `IndexedPaper.authorsText` field (already populated by 2.8.E's `projectFor`). When the user picks from the typeahead, the chip becomes a tagged pill displaying the full name (`Vaswani, Ashish` when the parallel `authorFirstNames` is present, `Vaswani` when not).\n"
    "- **Free-text search** continues to AND with the chip filters. The existing Fuse query handles title / citekey / author fuzzy matching; chips handle the structured predicates.\n"
    "- **Empty chip selection = no filter on that category.** A `[]` status array means \"any status\", same as not selecting any status chips.\n"
    "\n"
    "**Saved filter state (per project).** When the user closes and reopens Obsidian, the chip row reconstructs from `Project.sidebarFilter` (persisted via `ProjectManager.updateProject`). The sidebar's `projectChanged` listener re-hydrates the filter state on active project switch. A `Reset to default` action in the project settings tab clears it back to the empty default.\n"
    "\n"
    "**Out of scope (deferred beyond 2.9).**\n"
    "- **Structured query syntax** (e.g. `status:reading author:Vaswani`) in the search input — would require a small parser. The chip row covers the common cases; structured query is a power-user follow-on if it earns its keep.\n"
    "- **Cross-project filter** — the chip row filters within the active project only. A future \"All projects\" toggle would need a different sidebar view.\n"
    "- **Saved filter presets** — the user can manually replicate a saved filter by hand for now. Presets (named + shareable) is a 5.x polish item.\n"
    "\n"
    "**Bundle cost.** Roughly 400 LoC pre-bundling (most of it the chip row UI + the author picker modal). No new dependencies (fuse.js already shipped in 3.1). Expected `main.js` delta: +3 to +4 KB.\n"
    "\n"
    "**Architectural decision to add.** Likely `D31` — \"Sidebar filter state is a per-project preference, persisted in `Project.sidebarFilter`; the chip row is a derived view of that state plus the live EventBus. The free-text search and the chip filters are AND-composed at search time; chip categories OR within themselves.\" Will be locked at the start of 2.9.A.\n"
    "\n"
    "**Verification gates.** `npm run build` / `lint` / `tsc --noEmit` all `exit 0`. Manual smoke (2.9.smoke): pick three status chips, confirm the list filters to those three groups; pick an author from the typeahead, confirm the chip appears with the right name; close + reopen Obsidian, confirm the chip row reconstructs; reset to default, confirm the chip row empties. Vitest fixtures for `applyFilters` (in particular: OR-within-category, AND-across-categories, year range edge cases including missing-year papers) land with 5.x.\n"
    "\n"
    "**Files touched (planned).** Added: [`src/ui/views/sidebar-filters.ts`](../../src/ui/views/sidebar-filters.ts), [`src/ui/modals/author-picker-modal.ts`](../../src/ui/modals/author-picker-modal.ts). Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts), [`src/types/project.ts`](../../src/types/project.ts), [`src/settings.ts`](../../src/settings.ts), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts), [`src/core/events.ts`](../../src/core/events.ts), [`plans/plan.md`](../../plans/plan.md).\n"
    "\n"
)
if text.count(old_2_manual_smoke_heading) != 1:
    raise SystemExit(f"2.manual-smoke heading anchor not unique (found {text.count(old_2_manual_smoke_heading)})")
text = text.replace(old_2_manual_smoke_heading, new_2_9_phase_plan + old_2_manual_smoke_heading, 1)
print("  ok  plans/plan.md (§14 2.9 detailed phase plan added)")

plan.write_text(text, encoding="utf-8")
print()
print("done.")
