#!/usr/bin/env python3
"""
One-shot patcher for plans/plan.md.

Sub-pass 3.1a (sidebar polish) entry insertion:
  1. Update the "Looking ahead" tail of the Sprint 3 / 3.1 entry.
  2. Insert the new "Sprint 3 -- Sub-pass 3.1a" dated entry directly after
     the Sprint 3 / 3.1 entry and before the "## 15." heading.
  3. Add new upcoming-passes rows (3.1a, 3.1b, 3.1c) to the end of the
     "### 3.x Tier 2 remainder" block.

Idempotent: checks for the new headings first.
"""

from __future__ import annotations

import sys
from pathlib import Path

PLAN = Path("plans/plan.md")

MARKER_3_1A_DATE_ENTRY = "Sprint 3 \u2014 Sub-pass 3.1a (Sidebar polish"
MARKER_3_1A_PASSES_ROW = "### 3.1a Sidebar polish"

OLD_TAIL = (
    "**Looking ahead**\n"
    "- Sub-pass 3.2: `CitationManager` \u2014 `insertCitation` `editorCallback` + "
    "per-project `.bib` export. Decision: hand-rolled BibTeX serializer (no new dep).\n"
    "- Sub-pass 3.3: literature-graph edges \u2014 per-project JSON file in "
    "`<project>/literature/`.\n"
)

NEW_TAIL = (
    "**Looking ahead**\n"
    "- Sub-pass 3.1a (sidebar polish): reorder the search input to the top of the "
    "sidebar header, add a color/typography hierarchy to status groups, surface a red "
    "\"Needs action\" group at the top of the list. See \u00a714 (3.1a).\n"
    "- Sub-pass 3.2: `CitationManager` \u2014 `insertCitation` `editorCallback` + "
    "per-project `.bib` export. Decision: hand-rolled BibTeX serializer (no new dep).\n"
    "- Sub-pass 3.3: literature-graph edges \u2014 per-project JSON file in "
    "`<project>/literature/`.\n"
)

NEW_DATE_ENTRY = """
### Sprint 3 \u2014 Sub-pass 3.1a (Sidebar polish \u2014 search reorder + color hierarchy + Needs-action group, planned 2026-07-11)

**Goal**
Make the existing sidebar scannable at a glance by giving the search input a stable top position, giving the per-status groups real visual hierarchy, and surfacing the papers that actually need the user's attention in a single red group at the top.

**Scope (in)**
- Reorder `renderHeader()` in [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) so the layout reads top-to-bottom: project name + switch button \u2192 full-width search input (sticky) \u2192 full-width "Add paper" button. No new types, no new services, no new settings.
- Add a status color palette + typography scale in [`styles.css`](../../styles.css) under a new sidebar block. Tokens lean on Obsidian's own variables so dark / light / custom themes keep working. Palette (one swatch per status, used as left-border + small dot next to heading text):
  - `unread` \u2192 `var(--text-muted)`
  - `queued` \u2192 `var(--interactive-accent)`
  - `skimming` \u2192 `#d4a017`
  - `reading` \u2192 `#e07b39`
  - `annotating` \u2192 `#9b6dd7`
  - `summarized` \u2192 `#3fa672`
  - `synthesized` \u2192 `#2a8a8a`
  - `archived` \u2192 `var(--text-faint)` (also reduced opacity)
  - `excluded` \u2192 `var(--text-faint)` + strikethrough
- Render a virtual "Needs action" group **before** the per-status groups, using a red accent (`#d23f3f`). The group is a *derived* view, not a stored field, and is empty (collapsed) when no papers match.
- Typography: project name `1.1em / 600`, group headings `0.95em / 600` with 3 px left border in the status color, paper-row titles `0.85em`. Search input matches the height of the Add Paper button.
- Empty-state copy: groups with zero papers render no header; the existing "No papers in this project" / "No papers match \u2026" messages are kept verbatim.

**'Needs action' definition (locked)**
A paper lands in the "Needs action" group when any of:
- `paper.priority === 'critical'`, OR
- `paper.status in {'reading', 'skimming', 'annotating'}`, OR
- (`paper.status in {'skimming', 'annotating'}`) AND the paper has been sitting in that status for more than **14 days** (staleness rule).

The 14-day threshold is a `const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000` near the top of the sidebar view. Staleness is measured against `paper.dateModified` (proxy for "last time the user touched this paper"). Promoted to a setting only if/when it earns its keep.

**Sort order inside the group**
1. Priority weight: `critical` (3) > `high` (2) > `medium` (1) > `low` (0).
2. Within a priority bucket: stale (\u2265 14 days in `skimming` / `annotating`) first, then most-recently updated.
3. Ties broken by title (`localeCompare`).

**Out of scope (deferred)**
- Quick-action "\u2192 next" / "skip" buttons per row (deferred to sub-pass 3.1b once we've reacted to the polish).
- "Was this relevant?" prompt after marking a paper read (sub-pass 3.1b).
- Research stages (intake / synthesis) \u2014 derived project stage + optional `Project.stage` override (sub-pass 3.1c).
- Per-project homepage note (deferred to 4.x or 5.x).

**Architectural decisions added this sub-pass**
- `D20` \u2014 "Needs action" is a derived group, not a stored field. Derivation lives in the sidebar view; no new column on `Paper` and no new event on the bus.
- `D21` \u2014 Status color palette lives in `styles.css`, not inline, so users can theme them in one place later.

**Verification gates**
- `npm run build` \u2014 `exit 0`; `main.js` size delta under +2 KB (pure CSS + small render helper).
- `npm run lint` \u2014 `exit 0`.
- `npx tsc --noEmit` \u2014 `exit 0`.
- `npm run deploy:build` \u2014 succeeds; manual smoke in the test vault confirms: search input is at the top, status headings are larger and bordered, "Needs action" group renders red at the top with at least one paper from a populated project, and is hidden when empty.

**Files touched**
- Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (reorder `renderHeader`, new `computeNeedsAction` + `sortNeedsAction` helpers, sorted "Needs action" group rendered ahead of `STATUS_ORDER`), [`styles.css`](../../styles.css) (new sidebar block), [`plans/plan.md`](../../plans/plan.md) (this entry).

"""

NEW_3_1A_ROW = """### 3.1a Sidebar polish (search reorder + color hierarchy + Needs-action group)  `[ ]` (planned; see \u00a713 dated entry)
- **Goal.** Make the existing sidebar scannable at a glance: search input at the top, status groups with real visual hierarchy, a red "Needs action" group at the top of the list.
- **Surface.** Only `projects-sidebar-view.ts` + `styles.css`. No new types, no new services, no new settings.
- **'Needs action' definition.** `priority === 'critical'`, OR `status in {reading, skimming, annotating}`, OR (`status in {skimming, annotating}` AND staleness > 14 days). Derived in the view; not a stored field (see `D20`).
- **Deferred to follow-ups.** Per-row action buttons (3.1b), research stages (3.1c), project homepage note (4.x or 5.x).
- **Verification gates.** `npm run build` / `lint` / `tsc --noEmit` clean; manual smoke in the test vault confirms reorder, color hierarchy, and red "Needs action" group behaviour.
- **Files.** Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`styles.css`](../../styles.css), [`plans/plan.md`](../../plans/plan.md).

"""

NEW_3_1B_ROW = """### 3.1b Workflow shortcuts (next / skip / post-read relevance)  `[ ]` (planned; not yet started)
- **Goal.** Per-row action buttons plus an inline "was this relevant?" confirm, so the sidebar becomes a workflow tool rather than a paper list.
- **Out of scope here** (3.1a ships first; 3.1b is described so the upcoming-passes list is honest).
- **Files (proposed).** [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`src/ui/modals/relevance-confirm-modal.ts`](../../src/ui/modals/relevance-confirm-modal.ts) (new), `plans/plan.md`.
- **Verification gates.** Same as 3.1a, plus smoke: advance / skip / confirm transitions update `paper.status` and emit `paperStatusChanged`.

"""

NEW_3_1C_ROW = """### 3.1c Research stages (intake / synthesis)  `[ ]` (planned; not yet started)
- **Goal.** A derived "project stage" (intake vs synthesis) plus an optional `Project.stage` override; stage-aware default sort in the sidebar.
- **Files (proposed).** [`src/types/project.ts`](../../src/types/project.ts) (optional `stage` field + `migrateSettings` bump), [`src/services/project-manager.ts`](../../src/services/project-manager.ts) (derivation helper), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (stage-aware sort), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) (stage override dropdown), `plans/plan.md`.
- **Verification gates.** Same as 3.1a, plus smoke: switching project stage changes the group ordering.
- **Architectural decision.** Default to *derived* stage; explicit override is opt-in.

"""


def main() -> int:
    if not PLAN.exists():
        print(f"FAIL: {PLAN} not found", file=sys.stderr)
        return 1
    text = PLAN.read_text(encoding="utf-8")
    changes = 0

    # --- 1. Update 3.1 "Looking ahead" tail --------------------------------
    if OLD_TAIL in text:
        text = text.replace(OLD_TAIL, NEW_TAIL, 1)
        changes += 1
        print("OK: updated 3.1 'Looking ahead' tail")
    else:
        print("WARN: 3.1 'Looking ahead' tail not found verbatim; skipping")

    # --- 2. Insert new 3.1a dated entry before "## 15." -------------------
    if MARKER_3_1A_DATE_ENTRY not in text:
        anchor = "## 15. README Source \u2014 GitHub README Prose Draft"
        if anchor not in text:
            print("FAIL: README section anchor not found", file=sys.stderr)
            return 1
        text = text.replace(anchor, NEW_DATE_ENTRY + anchor, 1)
        changes += 1
        print("OK: inserted 3.1a dated entry")
    else:
        print("OK: 3.1a dated entry already present")

    # --- 3. Add new upcoming-passes rows inside 3.x Tier 2 remainder -------
    if MARKER_3_1A_PASSES_ROW not in text:
        anchor_3x_end = (
            "- **`citeproc-js`** \u2014 explicitly deferred to a Sprint 3 follow-up "
            "per the `D11` rationale.\n"
        )
        if anchor_3x_end not in text:
            print("FAIL: 3.x Tier 2 anchor not found", file=sys.stderr)
            return 1
        block = NEW_3_1A_ROW + NEW_3_1B_ROW + NEW_3_1C_ROW
        text = text.replace(anchor_3x_end, anchor_3x_end + "\n" + block, 1)
        changes += 1
        print("OK: inserted 3.1a / 3.1b / 3.1c upcoming-passes rows")
    else:
        print("OK: upcoming-passes 3.1a row already present")

    if changes == 0:
        print("INFO: no changes made (already up to date)")
        return 0

    PLAN.write_text(text, encoding="utf-8")
    print(f"DONE: {changes} change(s) written to {PLAN}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
