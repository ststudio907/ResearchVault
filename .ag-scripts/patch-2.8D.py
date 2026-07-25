#!/usr/bin/env python3
"""
2.8.D edits:
  1. src/services/paper-service.ts — add onPaperFileModified + findByPath helpers
     after the existing pathChanged method.
  2. src/core/plugin.ts — call onPaperFileModified inside the existing
     vault.on('modify') handler (registerVaultSync).
  3. src/ui/views/projects-sidebar-view.ts — rewire "Needs action" to use
     paper.dateAdded (creation age) instead of paper.dateModified (body-edit-
     sensitive) for the staleness proxy.
"""

import sys

# ---------------------------------------------------------------------------
# Edit 1 — paper-service.ts
# ---------------------------------------------------------------------------

path = 'src/services/paper-service.ts'
with open(path) as f:
    src = f.read()

old = """  async pathChanged(opts: { oldPath?: string; newPath?: string }): Promise<void> {
    if (opts.oldPath) {
      this.dropPaperAtPath(opts.oldPath);
    }
    if (opts.newPath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(opts.newPath);
      if (file instanceof TFile) {
        await this.syncFromFile(file);
      }
    }
  }

  /**
   * Iterate the in-memory index, drop any paper whose resolved file matches"""

new = """  async pathChanged(opts: { oldPath?: string; newPath?: string }): Promise<void> {
    if (opts.oldPath) {
      this.dropPaperAtPath(opts.oldPath);
    }
    if (opts.newPath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(opts.newPath);
      if (file instanceof TFile) {
        await this.syncFromFile(file);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2.8.D — `dateModified` re-stamp on every body edit
  // -------------------------------------------------------------------------

  /**
   * Find an in-memory paper by its on-disk file path. Linear scan, but the
   * index never holds more than a few hundred papers in a typical vault so
   * O(n) is fine and avoids needing a back-index by path. The lookup uses
   * the same canonical `<papersFolder>/<citekey>.md` shape `persistPaper`
   * writes, so the two never diverge.
   */
  private findByPath(filePath: string): Paper | undefined {
    const wanted = filePath.toLowerCase();
    for (const paper of this.byId.values()) {
      const folder = papersFolderOf(paper);
      if (!folder) continue;
      if (normalizePath(`${folder}/${paper.citekey}.md`).toLowerCase() === wanted) {
        return paper;
      }
    }
    return undefined;
  }

  /**
   * Vault `modify` handler that re-stamps `paper.dateModified` whenever a
   * paper note is edited externally. `syncFromFile` only catches frontmatter-
   * level changes; this fills the gap so body edits (footnote tweaks,
   * section rewrites, quote fixups) also surface a fresh `dateModified`.
   *
   * The 2-second loop guard suppresses the re-entrant `modify` event that
   * `persistPaper` itself triggers after we write the re-stamped value
   * back to disk — we want exactly one re-stamp per user-visible edit.
   */
  private async onPaperFileModified(file: TFile): Promise<void> {
    const paper = this.findByPath(file.path);
    if (!paper) return;
    const next = Date.now();
    if (next - paper.dateModified < 2_000) return;
    const updated: Paper = { ...paper, dateModified: next };
    this.byId.set(updated.id, updated);
    await this.persistPaper(updated);
    this.plugin.eventBus.emit('paperUpdated', updated);
  }

  /**
   * Iterate the in-memory index, drop any paper whose resolved file matches"""

assert src.count(old) == 1, f"paper-service.ts: anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('paper-service.ts: onPaperFileModified + findByPath added')

# ---------------------------------------------------------------------------
# Edit 2 — plugin.ts (registerVaultSync)
# ---------------------------------------------------------------------------

path = 'src/core/plugin.ts'
with open(path) as f:
    src = f.read()

old = """  private registerVaultSync(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          void this.paperService.syncFromFile(file);
        }
      }),
    );"""

new = """  private registerVaultSync(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          // 2.8.D — re-stamp `dateModified` on every body-or-frontmatter
          // edit. `syncFromFile` still owns frontmatter-only re-syncs; the
          // 2-second loop guard inside `onPaperFileModified` keeps the
          // re-entrant vault event from our own `persistPaper` write from
          // re-stamping a second time.
          void this.paperService.onPaperFileModified(file);
          void this.paperService.syncFromFile(file);
        }
      }),
    );"""

assert src.count(old) == 1, f"plugin.ts: anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('plugin.ts: onPaperFileModified wired into modify handler')

# ---------------------------------------------------------------------------
# Edit 3 — projects-sidebar-view.ts (computeNeedsAction rewire)
# ---------------------------------------------------------------------------

path = 'src/ui/views/projects-sidebar-view.ts'
with open(path) as f:
    src = f.read()

# 3a. JSDoc update
old_doc = """/**
 * Build the "Needs action" group:
 *   - `paper.priority === 'critical'`, OR
 *   - `paper.status in ACTIVE_STATUSES`, OR
 *   - (status in STALEABLE_STATUSES) AND `now - dateModified > STALE_AFTER_MS`.
 */
"""

new_doc = """/**
 * Build the "Needs action" group:
 *   - `paper.priority === 'critical'`, OR
 *   - `paper.status in ACTIVE_STATUSES`, OR
 *   - (status in STALEABLE_STATUSES) AND `now - dateAdded > STALE_AFTER_MS`.
 *     2.8.D: `dateModified` now re-stamps on every body edit, so the
 *     staleness proxy moved off it. `dateAdded` (creation age) is the new
 *     stable proxy: a paper added 14+ days ago that is still in 'skimming'
 *     or 'annotating' is genuinely stagnant, regardless of how recently the
 *     user typed in the note.
 */
"""

assert src.count(old_doc) == 1, f"sidebar doc: anchor not found (count={src.count(old_doc)})"
src = src.replace(old_doc, new_doc, 1)

# 3b. filter body
old_filter = """  const matched = papers.filter((p) => {
    if (p.priority === 'critical') return true;
    if (ACTIVE_STATUSES.has(p.status)) return true;
    if (STALEABLE_STATUSES.has(p.status) && now - p.dateModified > STALE_AFTER_MS) {
      return true;
    }
    return false;
  });"""

new_filter = """  const matched = papers.filter((p) => {
    if (p.priority === 'critical') return true;
    if (ACTIVE_STATUSES.has(p.status)) return true;
    if (STALEABLE_STATUSES.has(p.status) && now - p.dateAdded > STALE_AFTER_MS) {
      return true;
    }
    return false;
  });"""

assert src.count(old_filter) == 1, f"sidebar filter: anchor not found (count={src.count(old_filter)})"
src = src.replace(old_filter, new_filter, 1)

# 3c. sort tie-breaker
old_sort = """    const aStale =
      STALEABLE_STATUSES.has(a.status) && now - a.dateModified > STALE_AFTER_MS;
    const bStale =
      STALEABLE_STATUSES.has(b.status) && now - b.dateModified > STALE_AFTER_MS;"""

new_sort = """    const aStale =
      STALEABLE_STATUSES.has(a.status) && now - a.dateAdded > STALE_AFTER_MS;
    const bStale =
      STALEABLE_STATUSES.has(b.status) && now - b.dateAdded > STALE_AFTER_MS;"""

assert src.count(old_sort) == 1, f"sidebar sort: anchor not found (count={src.count(old_sort)})"
src = src.replace(old_sort, new_sort, 1)

# 3d. reason string
old_reason = """  if (STALEABLE_STATUSES.has(paper.status) && now - paper.dateModified > STALE_AFTER_MS) {
    const days = Math.floor((now - paper.dateModified) / (24 * 60 * 60 * 1000));"""

new_reason = """  if (STALEABLE_STATUSES.has(paper.status) && now - paper.dateAdded > STALE_AFTER_MS) {
    const days = Math.floor((now - paper.dateAdded) / (24 * 60 * 60 * 1000));"""

assert src.count(old_reason) == 1, f"sidebar reason: anchor not found (count={src.count(old_reason)})"
src = src.replace(old_reason, new_reason, 1)

with open(path, 'w') as f:
    f.write(src)
print('projects-sidebar-view.ts: needs-action proxy switched to dateAdded')
