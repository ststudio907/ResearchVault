#!/usr/bin/env python3
"""2.9.B — label redesign edits for projects-sidebar-view.ts (D31).

Deterministic idempotent patcher: applies exact string replacements and
verifies them on disk in the same run. Idempotent: each replacement is
skipped if its "new" text is already present.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "src" / "ui" / "views" / "projects-sidebar-view.ts"

OLD_CONSTS = """/** Status display order in the sidebar (priority then lifecycle). */
const STATUS_ORDER: readonly ReadingStatus[] = [
  'reading',
  'skimming',
  'annotating',
  'queued',
  'unread',
  'summarized',
  'synthesized',
  'archived',
  'excluded',
];

/**
 * Staleness window for the "Needs action" group. A paper that has been in
 * `skimming` or `annotating` for longer than this is treated as stagnant.
 * D20 — derived only; not a stored field.
 */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Statuses considered "actively being worked on" by default. */
const ACTIVE_STATUSES: ReadonlySet<ReadingStatus> = new Set<ReadingStatus>([
  'reading',
  'skimming',
  'annotating',
]);

/** Statuses that can become stale (>14 days in the same state). */
const STALEABLE_STATUSES: ReadonlySet<ReadingStatus> = new Set<ReadingStatus>([
  'skimming',
  'annotating',
]);

/** Priority weight for the Needs-action sort. Higher = earlier. */
function priorityWeight(p: Paper['priority']): number {
  switch (p) {
    case 'critical':
      return 3;
    case 'high':
      return 2;
    case 'medium':
      return 1;
    case 'low':
      return 0;
    default:
      return 0;
  }
}"""

NEW_CONSTS = """/** Status display order in the sidebar (priority then lifecycle). 2026-09-30
 *  label redesign (D31): `queued` merged into `unread`, `summarized` into
 *  `annotating`. */
const STATUS_ORDER: readonly ReadingStatus[] = [
  'reading',
  'skimming',
  'annotating',
  'unread',
  'synthesized',
  'archived',
  'excluded',
];

/**
 * Staleness window for the "Attention" group (D31 rename of "Needs action").
 * A paper that has been in-flight for longer than this is treated as
 * stagnant. D20 — derived only; not a stored field.
 */
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Statuses considered "in-flight" (Attention candidates). 2026-09-30 label
 * redesign: this set is also the stale set — `reading` now goes stale too
 * (previously only `skimming`/`annotating` did).
 */
const ACTIVE_STATUSES: ReadonlySet<ReadingStatus> = new Set<ReadingStatus>([
  'reading',
  'skimming',
  'annotating',
]);

const STALEABLE_STATUSES: ReadonlySet<ReadingStatus> = ACTIVE_STATUSES;

/** Priority weight for the Attention sort. Higher = earlier. */
function priorityWeight(p: Paper['priority']): number {
  switch (p) {
    case 'high':
      return 2;
    case 'normal':
      return 1;
    default:
      return 0;
  }
}"""

OLD_RENDER = """    // Derived "Needs action" group. Computed every render (cheap; it's just
    // a filter + sort over the in-memory list). Empty -> nothing rendered.
    const needsAction = computeNeedsAction(papers);
    if (needsAction.length > 0) {
      this.renderGroup(listEl, 'needs-action', needsAction);
    }"""

NEW_RENDER = """    // Derived "Attention" group (D31 rename of "Needs action"). Computed every
    // render (cheap; it's just a filter + sort over the in-memory list).
    // Empty -> nothing rendered.
    const attention = computeAttention(papers);
    if (attention.length > 0) {
      this.renderGroup(listEl, 'attention', attention);
    }"""

OLD_GROUP_SIG = """    root: HTMLElement,
    status: ReadingStatus | 'results' | 'needs-action',
    papers: Paper[],
  ): void {
    const isVirtual = status === 'results' || status === 'needs-action';"""

NEW_GROUP_SIG = """    root: HTMLElement,
    status: ReadingStatus | 'results' | 'attention',
    papers: Paper[],
  ): void {
    const isVirtual = status === 'results' || status === 'attention';"""

OLD_HEADING = """    const headingText =
      status === 'results'
        ? 'Results'
        : status === 'needs-action'
          ? 'Needs action'
          : titleCase(status);"""

NEW_HEADING = """    const headingText =
      status === 'results'
        ? 'Results'
        : status === 'attention'
          ? 'Attention'
          : titleCase(status);"""

OLD_TAG = """      // ---- Line 2: citekey / year / (needs-action tag) --------------------
      const line2 = content.createDiv({ cls: 'researchvault-sidebar-row-line researchvault-sidebar-row-line--meta' });
      line2.createEl('span', { text: paper.citekey, cls: 'researchvault-sidebar-row-citekey' });
      line2.createEl('span', { text: ' \\u00b7 ', cls: 'researchvault-sidebar-row-meta-sep' });
      line2.createEl('span', { text: String(paper.year), cls: 'researchvault-sidebar-row-year' });
      if (status === 'needs-action') {
        const reason = needsActionReason(paper);
        if (reason) {
          const tag = line2.createEl('span', { text: reason, cls: 'researchvault-sidebar-row-tag' });
          tag.setAttribute('aria-label', `Needs action: ${reason}`);
          tag.setAttribute('title', `Needs action: ${reason}`);
        }
      }"""

NEW_TAG = """      // ---- Line 2: citekey / year / (attention tag) ------------------------
      const line2 = content.createDiv({ cls: 'researchvault-sidebar-row-line researchvault-sidebar-row-line--meta' });
      line2.createEl('span', { text: paper.citekey, cls: 'researchvault-sidebar-row-citekey' });
      line2.createEl('span', { text: ' \\u00b7 ', cls: 'researchvault-sidebar-row-meta-sep' });
      line2.createEl('span', { text: String(paper.year), cls: 'researchvault-sidebar-row-year' });
      if (status === 'attention') {
        const reason = attentionReason(paper);
        if (reason) {
          const tag = line2.createEl('span', { text: reason, cls: 'researchvault-sidebar-row-tag' });
          tag.setAttribute('aria-label', `Attention: ${reason}`);
          tag.setAttribute('title', `Attention: ${reason}`);
        }
      }"""

OLD_HELPERS = """/**
 * D20 \\u2014 derived view. A paper lands in "Needs action" when:
 *   - `paper.priority === 'critical'`, OR
 *   - `paper.status in ACTIVE_STATUSES`, OR
 *   - (status in STALEABLE_STATUSES) AND `now - dateAdded > STALE_AFTER_MS`.
 *
 * 2.8.D: `dateModified` now re-stamps on every body edit, so the
 * staleness proxy moved off it. `dateAdded` (creation age) is the new
 * stable proxy: a paper added 14+ days ago that is still in 'skimming'
 * or 'annotating' is genuinely stagnant, regardless of how recently the
 * user typed in the note.
 */
function computeNeedsAction(papers: Paper[]): Paper[] {
  const now = Date.now();
  const matched = papers.filter((p) => {
    if (p.priority === 'critical') return true;
    if (ACTIVE_STATUSES.has(p.status)) return true;
    if (STALEABLE_STATUSES.has(p.status) && now - p.dateAdded > STALE_AFTER_MS) {
      return true;
    }
    return false;
  });
  return sortNeedsAction(matched, now);
}

/**
 * Sort: priority weight desc, then stale-first, then most-recently modified,
 * then title.
 */
function sortNeedsAction(papers: Paper[], now: number): Paper[] {
  return papers.slice().sort((a, b) => {
    const pa = priorityWeight(a.priority);
    const pb = priorityWeight(b.priority);
    if (pa !== pb) return pb - pa;
    const aStale =
      STALEABLE_STATUSES.has(a.status) && now - a.dateAdded > STALE_AFTER_MS;
    const bStale =
      STALEABLE_STATUSES.has(b.status) && now - b.dateAdded > STALE_AFTER_MS;
    if (aStale !== bStale) return aStale ? -1 : 1;
    if (a.dateModified !== b.dateModified) return b.dateModified - a.dateModified;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Human-readable reason a paper surfaced in "Needs action". Used as the
 * small tag rendered next to the title. Falls back to the paper's priority
 * or active status.
 */
function needsActionReason(paper: Paper): string {
  const now = Date.now();
  if (STALEABLE_STATUSES.has(paper.status) && now - paper.dateAdded > STALE_AFTER_MS) {
    const days = Math.floor((now - paper.dateAdded) / (24 * 60 * 60 * 1000));
    return `Stale ${days}d \\u00b7 ${titleCase(paper.status)}`;
  }
  if (paper.priority === 'critical') {
    return `Critical \\u00b7 ${titleCase(paper.status)}`;
  }
  return titleCase(paper.status);
}"""

NEW_HELPERS = """/**
 * D20/D31 — derived view. A paper lands in "Attention" when ALL of:
 *   - status is in-flight (`status in ACTIVE_STATUSES`), AND
 *   - `priority === 'high'` OR stale (`now - dateAdded > STALE_AFTER_MS`).
 *
 * 2026-09-30 label redesign (D31): the old OR-based "Needs action" rule
 * surfaced critical-priority papers regardless of status (archived papers
 * nagged forever) and never staleness-checked `reading`. The new rules are
 * AND-ed, so urgency is time-boxed by lifecycle, and `reading` goes stale.
 * Terminal statuses (`synthesized` / `archived` / `excluded`) are excluded
 * by the ACTIVE_STATUSES gate alone — they are never in it.
 *
 * 2.8.D: `dateModified` re-stamps on every body edit, so the staleness
 * proxy is `dateAdded` (creation age): a paper added 14+ days ago that is
 * still in-flight is genuinely stagnant, regardless of recent edits.
 */
function computeAttention(papers: Paper[]): Paper[] {
  const now = Date.now();
  const matched = papers.filter((p) => {
    if (!ACTIVE_STATUSES.has(p.status)) return false;
    if (p.priority === 'high') return true;
    return now - p.dateAdded > STALE_AFTER_MS;
  });
  return sortAttention(matched, now);
}

/**
 * Sort: priority weight desc, then stale-first, then most-recently modified,
 * then title.
 */
function sortAttention(papers: Paper[], now: number): Paper[] {
  return papers.slice().sort((a, b) => {
    const pa = priorityWeight(a.priority);
    const pb = priorityWeight(b.priority);
    if (pa !== pb) return pb - pa;
    const aStale =
      ACTIVE_STATUSES.has(a.status) && now - a.dateAdded > STALE_AFTER_MS;
    const bStale =
      ACTIVE_STATUSES.has(b.status) && now - b.dateAdded > STALE_AFTER_MS;
    if (aStale !== bStale) return aStale ? -1 : 1;
    if (a.dateModified !== b.dateModified) return b.dateModified - a.dateModified;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Human-readable reason a paper surfaced in "Attention". Used as the
 * small tag rendered next to the title. Falls back to the paper's priority
 * or in-flight status.
 */
function attentionReason(paper: Paper): string {
  const now = Date.now();
  if (now - paper.dateAdded > STALE_AFTER_MS) {
    const days = Math.floor((now - paper.dateAdded) / (24 * 60 * 60 * 1000));
    return `Stale ${days}d \\u00b7 ${titleCase(paper.status)}`;
  }
  if (paper.priority === 'high') {
    return `High priority \\u00b7 ${titleCase(paper.status)}`;
  }
  return titleCase(paper.status);
}"""

# NOTE: the on-disk file contains the literal unicode escape sequences as
# written by the original author ("\\u2014" inside the doc comments is an
# em-dash CHARACTER, and the meta-sep line contains a literal '·' char).
# The OLD_* strings above model the file using the actual characters where
# they are characters. Verify before replacing.

REPLACEMENTS = [
    ("consts", OLD_CONSTS, NEW_CONSTS),
    ("render-call", OLD_RENDER, NEW_RENDER),
    ("group-sig", OLD_GROUP_SIG, NEW_GROUP_SIG),
    ("group-heading", OLD_HEADING, NEW_HEADING),
    ("row-tag", OLD_TAG, NEW_TAG),
    ("helpers", OLD_HELPERS, NEW_HELPERS),
]


def main() -> None:
    text = TARGET.read_text(encoding="utf-8")
    changed = 0
    for name, old, new in REPLACEMENTS:
        if new in text:
            print(f"  = {name}: already applied")
            continue
        count = text.count(old)
        if count != 1:
            raise SystemExit(
                f"FAIL {name}: expected exactly 1 occurrence of old text, found {count}"
            )
        text = text.replace(old, new, 1)
        if new not in text or old in text:
            raise SystemExit(f"FAIL {name}: replacement did not take")
        print(f"  + {name}: replaced")
        changed += 1
    TARGET.write_text(text, encoding="utf-8")
    # On-disk verification
    check = TARGET.read_text(encoding="utf-8")
    for needle in (
        "computeAttention",
        "attentionReason",
        "sortAttention",
        "'attention'",
    ):
        assert needle in check, f"verify failed: {needle} missing"
    for bad in (
        "computeNeedsAction",
        "needsActionReason",
        "'queued'",
        "'summarized'",
        "'critical'",
        "'medium'",
    ):
        assert bad not in check, f"verify failed: {bad} still present"
    print(f"OK: {changed} replacement(s) applied and verified on disk.")


if __name__ == "__main__":
    main()
