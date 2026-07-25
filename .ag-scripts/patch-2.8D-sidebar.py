#!/usr/bin/env python3
"""2.8.D sidebar patch — runs alone after the paper-service + plugin edits."""

import sys

path = 'src/ui/views/projects-sidebar-view.ts'
with open(path) as f:
    src = f.read()

# 3a. JSDoc update
old_doc = (
    "/**\n"
    " * D20 \\u2014 derived view. A paper lands in \"Needs action\" when:\n"
    " *   - `paper.priority === 'critical'`, OR\n"
    " *   - `paper.status in ACTIVE_STATUSES`, OR\n"
    " *   - (status in STALEABLE_STATUSES) AND `now - dateModified > STALE_AFTER_MS`.\n"
    " */\n"
)

new_doc = (
    "/**\n"
    " * D20 \\u2014 derived view. A paper lands in \"Needs action\" when:\n"
    " *   - `paper.priority === 'critical'`, OR\n"
    " *   - `paper.status in ACTIVE_STATUSES`, OR\n"
    " *   - (status in STALEABLE_STATUSES) AND `now - dateAdded > STALE_AFTER_MS`.\n"
    " *\n"
    " * 2.8.D: `dateModified` now re-stamps on every body edit, so the\n"
    " * staleness proxy moved off it. `dateAdded` (creation age) is the new\n"
    " * stable proxy: a paper added 14+ days ago that is still in 'skimming'\n"
    " * or 'annotating' is genuinely stagnant, regardless of how recently the\n"
    " * user typed in the note.\n"
    " */\n"
)

assert src.count(old_doc) == 1, f"sidebar doc: anchor not found (count={src.count(old_doc)})"
src = src.replace(old_doc, new_doc, 1)

# 3b. filter body
old_filter = (
    "  const matched = papers.filter((p) => {\n"
    "    if (p.priority === 'critical') return true;\n"
    "    if (ACTIVE_STATUSES.has(p.status)) return true;\n"
    "    if (STALEABLE_STATUSES.has(p.status) && now - p.dateModified > STALE_AFTER_MS) {\n"
    "      return true;\n"
    "    }\n"
    "    return false;\n"
    "  });"
)

new_filter = (
    "  const matched = papers.filter((p) => {\n"
    "    if (p.priority === 'critical') return true;\n"
    "    if (ACTIVE_STATUSES.has(p.status)) return true;\n"
    "    if (STALEABLE_STATUSES.has(p.status) && now - p.dateAdded > STALE_AFTER_MS) {\n"
    "      return true;\n"
    "    }\n"
    "    return false;\n"
    "  });"
)

assert src.count(old_filter) == 1, f"sidebar filter: anchor not found (count={src.count(old_filter)})"
src = src.replace(old_filter, new_filter, 1)

# 3c. sort tie-breaker
old_sort = (
    "    const aStale =\n"
    "      STALEABLE_STATUSES.has(a.status) && now - a.dateModified > STALE_AFTER_MS;\n"
    "    const bStale =\n"
    "      STALEABLE_STATUSES.has(b.status) && now - b.dateModified > STALE_AFTER_MS;"
)

new_sort = (
    "    const aStale =\n"
    "      STALEABLE_STATUSES.has(a.status) && now - a.dateAdded > STALE_AFTER_MS;\n"
    "    const bStale =\n"
    "      STALEABLE_STATUSES.has(b.status) && now - b.dateAdded > STALE_AFTER_MS;"
)

assert src.count(old_sort) == 1, f"sidebar sort: anchor not found (count={src.count(old_sort)})"
src = src.replace(old_sort, new_sort, 1)

# 3d. reason string
old_reason = (
    "  if (STALEABLE_STATUSES.has(paper.status) && now - paper.dateModified > STALE_AFTER_MS) {\n"
    "    const days = Math.floor((now - paper.dateModified) / (24 * 60 * 60 * 1000));"
)

new_reason = (
    "  if (STALEABLE_STATUSES.has(paper.status) && now - paper.dateAdded > STALE_AFTER_MS) {\n"
    "    const days = Math.floor((now - paper.dateAdded) / (24 * 60 * 60 * 1000));"
)

assert src.count(old_reason) == 1, f"sidebar reason: anchor not found (count={src.count(old_reason)})"
src = src.replace(old_reason, new_reason, 1)

with open(path, 'w') as f:
    f.write(src)
print('projects-sidebar-view.ts: needs-action proxy switched to dateAdded')
