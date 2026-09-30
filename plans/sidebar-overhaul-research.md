# Sidebar overhaul — bird's-eye review, root-cause fix, filter panel design

Status: **DRAFT — awaiting user sign-off** (logged 2026-09-28)
Context: the 2.9 chip-row attempt was reverted verbatim (`703cc84`, `f5c44fd`). The user then
reported the status/priority revert happens **even on the reverted build** — which proved the
chips were never the cause. This doc is the design-first pass the user asked for: look at what
works, keep it, fix the actual bug, add the filter panel, and keep the bundle lean.

---

## 1. Root cause of the "revert" bug (found — it is NOT the chips)

The bug is a **stale-index write-back race** that shipped with sub-pass 2.8.D (2026-07-21) and
exists in the current baseline. It fires whenever a paper is changed programmatically after
being idle for more than ~2 seconds.

### The exact trace (all line refs at `f5c44fd`)

1. User changes a status dropdown → `ProjectsSidebarView.changeStatus`
   (`src/ui/views/projects-sidebar-view.ts:420`) → `PaperService.updateStatus`
   (`src/services/paper-service.ts:349`) → `PaperService.updatePaper`
   (`src/services/paper-service.ts:330`).
2. `updatePaper` does:
   ```ts
   await this.persistPaper(next, ...);   // ← writes to disk FIRST
   this.byId.set(next.id, next);         // in-memory index updated AFTER
   ```
3. The disk write fires Obsidian's vault `modify` event. `registerVaultSync`
   (`src/core/plugin.ts:239`) handles it with two fire-and-forget calls:
   `onPaperFileModified(file)` and `syncFromFile(file)`.
4. `onPaperFileModified` (`src/services/paper-service.ts:569`) looks the paper up **in
   `byId` — which still holds the pre-change copy**, because `updatePaper` is suspended at its
   `await`. Its 2-second loop guard (`next - paper.dateModified < 2_000`) checks the **stale
   in-memory** `dateModified`, so after ~2 s of idleness it does NOT skip.
5. It then builds `{ ...stalePaper, dateModified: now }` — **with the old status/priority** —
   sets it into `byId`, and **writes it back to disk**, clobbering the user's change.
6. That write fires a second `modify` → `syncFromFile` reads the clobbered file, sees it
   differs from the now-updated memory, emits `paperUpdated` with the **old** values → the
   sidebar re-renders showing the reverted state. The user's edit is lost on disk too.

This also explains every observed symptom:
- "it changes and then reverts right away" — step 6 lands within a frame or two.
- It appeared "after" 2.9 — 2.9's chip row subscribed to the same events and made the
  multi-render burst more visible, but the data clobber is pre-existing.
- It reproduces on the reverted build — the race is in the baseline.
- Retrying quickly (within 2 s) sometimes appears to work — the guard skips the re-stamp.

### The fix (surgical, two parts, both in `paper-service.ts`)

**Fix A — update the in-memory index before persisting.** In `updatePaper`, move
`this.byId.set(next.id, next)` **before** `await this.persistPaper(...)`. Then, when the
self-triggered `modify` event arrives:
- `onPaperFileModified`'s guard now sees the fresh `dateModified` (just set to `Date.now()`)
  and correctly skips; and
- `syncFromFile` reads the file, `papersEqual` matches, and it no-ops.

If `persistPaper` throws, roll the index entry back to `current` so memory never diverges
silently.

**Fix B — suppress self-writes explicitly.** Add a small `suppressUntil` map
(`path → timestamp`) around `persistPaper`'s `vault.modify`, checked (and cleared) in the
vault `modify` handler in `registerVaultSync`. This makes the intent explicit instead of
relying on the 2-second heuristic, and protects `addQuote` (which has the same
write→event→re-read shape but no guard at all today).

Cost estimate: ~300–500 B minified. This fix ships **first and alone** so it can be
smoke-verified in isolation before any UI work lands on top.

---

## 2. Bird's-eye review of the current sidebar — what stays

The reverted baseline is the thing the user called "a working demo." Keep, verbatim in
behavior:

- **Sticky header** — project title + switch, search box (80 ms debounce, focus survives
  re-renders), Add paper button. (`renderHeader`, `projects-sidebar-view.ts:236`)
- **Needs-action group** — the 14-day staleness derivation with reasons; user liked it.
  (`computeNeedsAction`, `sortNeedsAction`)
- **Status groups** in `STATUS_ORDER` with counts and collapsible sections.
- **3-line rows** — title + edit pencil; citekey · year (+ needs-action tag); status +
  priority selects + quote button; "Added <date>" line.
- **Search integration** — indexer-backed fuzzy search scoped to the active project.

What is *missing* / weak (the user's asks):
1. No way to hide groups — a long project list is visually noisy.
2. No "show me only what I'm reading" style filtering.
3. No sorting control (order is fixed: needs-action first, then `STATUS_ORDER`, insertion
   order within groups).
4. The revert bug (§1) makes inline edits feel broken.
5. Render storm: a single status change fires `paperUpdated` + `paperStatusChanged` + up to
   two vault-sync `paperUpdated`s — each calling `renderList()`. Not a correctness bug once
   §1 is fixed, but wasteful and can visibly flicker.

---

## 3. The filter panel design (replaces the reverted chip row)

**Shape: a collapsible panel behind a sliders icon** (Lucide `sliders-horizontal`), placed in
the header row next to the project-switch button — matching the user's "filters tab with the
sliders symbol" mental model from table UIs.

### 3.1 Panel contents (top to bottom)

1. **Status checkboxes** — one per `ReadingStatus`, each with a live count
   (`Reading (3)`). Unchecked = group hidden. All checked = default (show everything).
   A "Select none / all" pair of tiny links at the top of the block.
2. **Priority checkboxes** — `low / medium / high / critical` with counts. Same semantics.
   (This directly answers "I have things labelled critical, show me only those".)
3. **Sort dropdown** — `Recently added` (default, current behavior) / `Recently touched`
   (`dateModified`) / `Title (A–Z)` / `Year` / `Priority`. Applies within each group and to
   the needs-action/search result ordering.
4. **"Hide empty groups" toggle** — default ON (current behavior skips empty groups anyway;
   the toggle exists so the user can force-see the skeleton).
5. **Reset link** — returns everything to defaults.

Panel is open/closed via the sliders icon; the icon shows a subtle "active" tint whenever any
filter deviates from default, so a forgotten filter is discoverable.

### 3.2 Filtering semantics

- Status/priority checkboxes are **OR within a facet, AND across facets** (same model the
  reverted chips used — that logic was sound; only the persistence + render behavior wasn't).
- The **needs-action group and search results respect the panel too**: a paper hidden by the
  panel does not appear in needs-action or search hits. (The reverted version got this
  wrong-feeling by filtering only status groups.)
- No author filter in v1. The reverted author-picker modal was the heaviest, riskiest piece
  and the user never asked for it again. Deferred; the panel's layout leaves room for it.

### 3.3 State & persistence

- Filter state lives in **plugin settings** (`settings.filterPanel`), global across projects —
  simpler than the reverted per-project `Project.sidebarFilter` field, and the user's framing
  was about *visual noise*, which is a global preference.
  Shape: `{ status: ReadingStatus[] | null, priority: Priority[] | null, sort: SortMode,
  hideEmpty: boolean, open: boolean }` — `null` = "all" so the default adds zero bytes to
  `data.json` semantics.
- Persisted via the existing central `saveSettings` helper; debounced 500 ms so checkbox
  clicking doesn't hammer `saveData`.

### 3.4 Render-storm fix (cheap, ships with the panel)

- `renderList()` calls from event bursts are coalesced with a 50 ms trailing debounce
  (one field + one `setTimeout`, same pattern as the existing search debounce).
- `changeStatus`/`changePriority` no longer trigger three renders — one.

### 3.5 What we deliberately do NOT build (lessons from the reverted 2.9)

- No author typeahead modal.
- No per-project filter state.
- No chip row rendered from state (checkbox panel only).
- No new dependencies; icons come from Lucide (`sliders-horizontal`, `rotate-ccw`).

---

## 4. Bundle budget

Current: `main.js` 124,166 B. Plan:

| Piece | Budget |
|---|---|
| §1 race fix | ≤ 500 B |
| Filter panel (pure module + view wiring + CSS) | ≤ 2,500 B |
| **Net ceiling** | **≤ 127,200 B** (~2.4 % growth) |

Measured the same way as 4.1.F (`--metafile`, per-module `bytesInOutput`) before commit.

---

## 5. Proposed phase plan (only after sign-off)

- **A. Race fix alone** (`paper-service.ts` + one guard in `plugin.ts`) → build, lint, tsc,
  deploy, **user smoke: change status/priority after 30 s idle → change sticks on reload**.
  Commit separately so it's bisectable.
- **B. Filter panel** — new pure module `src/ui/views/filter-panel.ts` (state + apply +
  serialize, no DOM) + panel rendering inside `projects-sidebar-view.ts` + CSS + settings
  field. Gates: tsc / lint / build / metafile budget.
- **C. Docs** — plan.md dated entry, §14 row, README only if user-facing behavior warrants
  (no new network, so likely no privacy change).
- **D. Deploy + manual smoke checklist** (8 steps: filter by reading-only, by critical, sort
  modes, hide-empty off, panel persistence across reload, race fix regression, search +
  filter interplay, needs-action respect).

---

## 6. Open questions for the user

1. ~~Sort default~~ — user confirmed "Recently added" stays (no answer given, default kept).
2. ~~Panel persistence~~ — user confirmed persist across restarts (via A+D sign-off).
3. ~~Author filter~~ — dropped permanently (confirmed in §7 sign-off).

---

## 7. Labeling-system redesign (user-locked 2026-09-30 — supersedes parts of §3)

Session outcome: the user chose **Package A in full** ("I think option A is best for sure")
after the bird's-eye review of the two-axis model. §3's filter-panel shape is confirmed but
its vocabulary sections are superseded by the values below.

### 7.1 The two-axis model (the "why")

Status was answering two questions at once — *where is this in the pipeline?* and *is it
waiting on me?* — which is what made "Needs action" rules misbehave. The redesign splits
them cleanly:

| Axis | Question | Values | Control |
|---|---|---|---|
| Status | Where is this in my workflow? | 8 lifecycle + 1 verdict (below) | User, row dropdown |
| Priority | How urgent right now? | `low / normal / high` | User, row dropdown |
| Attention | Does it need action today? | derived on/off | Plugin, computed only |

### 7.2 New status set — 8 lifecycle + 1 verdict

`unread → skimming → reading → annotating → synthesized`, plus terminal `archived` and
verdict `excluded`.

- **`queued` CUT** — same posture as `unread` (not started); two labels for one mental state.
- **`summarized` CUT** — a checkpoint inside annotating/synthesizing, not a shelf. Anything
  "summarized" is really "annotating, synthesis pending".
- Kept: `unread`, `skimming`, `reading`, `annotating`, `synthesized`, `archived`, `excluded`.
- `excluded` stays a status (not a separate concept) — it is terminal and renders
  strikethrough/faint as today.

### 7.3 New priority set — 3 tiers

`low / normal / high`, default `normal`.

- **`critical` CUT as a tier** — "critical" read like an incident, not a reading priority,
  and it was the clause that made terminal papers nag forever. Urgency that would have been
  "critical" becomes `high` + in-flight status; urgency is time-boxed by lifecycle at the
  model level.

### 7.4 "Needs action" → "Attention" (derived, replaces D20's locked definition)

A paper is in **Attention** when:

1. status is in-flight (`skimming / reading / annotating`), **and**
2. priority is `high`, **or** the paper is stale — in-flight longer than 14 days, **now
   including `reading`** (previous rule only staleness-checked `skimming`/`annotating`), **and**
3. **never** for terminal statuses (`synthesized / archived / excluded`) regardless of
   priority.

Both original misbehaviors die: critical+archived nagging, and `reading` never going stale.
`D20` stays true (derived, never stored) — only the clause list changes. New decision row
`D31` records the rename + new rules.

### 7.5 Data migration (frontmatter, backward-compatible)

`frontmatterToPaper` (`src/services/paper-service.ts`) already coerces unknown enum values on
read. The migration maps legacy values at read time; files rewrite themselves with new values
the next time the paper is persisted through the normal write path. No bulk vault rewrite.

| Legacy value | Maps to | Rationale |
|---|---|---|
| `queued` | `unread` | Same posture (not started). |
| `summarized` | `annotating` | Synthesis still pending → genuinely in-flight; correct staleness behavior follows for free. **User-locked 2026-09-30.** |
| `critical` | `high` | Highest remaining tier. |

Types touched: `ReadingStatus`, `Priority` in `src/types/literature.ts`; the exported
`READING_STATUSES` / `PRIORITIES` const arrays that back every dropdown; `STATUS_ORDER`,
`ACTIVE_STATUSES`, `STALEABLE_STATUSES` in the sidebar view; settings-tab and modal dropdown
option lists (all read the const arrays — verify no hardcoded literals remain).

### 7.6 Filter panel — final shape (vocabulary from §7.2–7.4)

Panel behind a `sliders-horizontal` icon in the sidebar header row (next to project switch).
Icon gets an "active" tint whenever state deviates from defaults. Persisted globally in
settings (`settings.filterPanel`), debounced 500 ms save.

Contents, top to bottom:

1. **Attention toggle** — "Show attention list" (default on). When on, the Attention group
   renders above the status groups exactly as "Needs action" does today, using the §7.4 rules.
2. **Status checkboxes** — the 7 non-excluded statuses… **decision: include all 8 + excluded
   with counts** (`Reading (3)`), unchecked = hidden, all checked = default. "All / none"
   micro-links at the top of the block.
3. **Priority checkboxes** — `low / normal / high` with counts, same semantics.
4. **Sort dropdown + direction toggle** — `Recently added` (default) / `Recently touched` /
   `Title` / `Year` / `Priority`, plus a small direction flip button (newest↔oldest for the
   date modes, A→Z↔Z→A for title, high↔low for priority). Direction is remembered per
   session in the panel state. Applies within status groups and to Attention + search
   results; groups themselves stay in lifecycle order (no flat-list mode — user declined
   2026-09-30).
5. **Hide empty groups toggle** — default on.
6. **Reset link** — restores defaults.

Semantics: OR within a facet, AND across facets. Attention and search results respect the
panel (a hidden paper never appears in either). Panel state shape:
`{ attention: boolean, status: ReadingStatus[] | null, priority: Priority[] | null,
sort: SortMode, sortAsc: boolean, hideEmpty: boolean, open: boolean }` — `null` = all.

### 7.7 Implementation order (revised)

- **A. ✅ Race fix** — shipped + user-confirmed 2026-09-30 (`a6178be`).
- **B. Label migration** — types + const arrays + `frontmatterToPaper` coercion + Attention
  rules + rename. Gates: tsc/lint/build; smoke: legacy `queued`/`summarized`/`critical`
  papers in the test vault display correctly and rewrite on next persist.
- **C. Filter panel** — pure module `src/ui/views/filter-panel.ts` + view wiring + CSS +
  settings field. Budget ≤2,500 B over the post-A 124,482 B baseline.
- **D. Docs + smoke** — plan.md dated entry, `D20` note + `D31` row, 8-step checklist.
