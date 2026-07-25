#!/usr/bin/env python3
"""Phase A — plans/plan.md patches:
1. Mark 2.4 [x] (line 474).
2. Insert dated §13 entry for sub-pass 2.4 + 2.recon (2026-07-10).
"""
import pathlib
import sys

p = pathlib.Path("plans/plan.md")
s = p.read_text()

edits = []

# Edit 1 — mark 2.4 shipped in §14
old1 = "### 2.4 `QuoteCaptureModal` — selection → quote  `[ ]`"
new1 = "### 2.4 `QuoteCaptureModal` — selection → quote  `[x]` (shipped in sub-pass 2.4+2.recon)"
edits.append(("mark 2.4 shipped", old1, new1))

# Edit 2 — insert dated §13 living-log entry after the sub-pass 2.2+2.5 block
# Anchored on the last "Looking ahead" line of that block, followed by the
# "---" that separates it from §15 (which currently appears before §14 in
# the on-disk file — a pre-existing quirk we do not touch).
old2 = (
    "- Sub-pass 2.4 (`QuoteCaptureModal`) is the obvious next chunk — it makes "
    "`PaperService.addQuote` reachable and completes the manual paper workflow "
    "(import → read → quote). Detailed phase plans live in §14.\n"
)
new2 = (
    "- Sub-pass 2.4 (`QuoteCaptureModal`) is the obvious next chunk — it makes "
    "`PaperService.addQuote` reachable and completes the manual paper workflow "
    "(import → read → quote). Detailed phase plans live in §14.\n"
    "\n"
    "---\n"
    "\n"
    "### Sprint 2 — Sub-pass 2.4 + 2.recon (ended 2026-07-10)\n"
    "\n"
    "**What shipped**\n"
    "- [`src/ui/modals/quote-capture-modal.ts`](../../src/ui/modals/quote-capture-modal.ts) — "
    "selection → quote modal wired through `editorCallback`. Form fields: paper picker "
    "(default = most-recent import in active project), page number, section, tags, plus a "
    "new free-form `note` field for long-form commentary. Submit calls `paperService.addQuote` "
    "with `source: 'editor'` and emits `quoteAdded`. Outside editor + active selection + active "
    "project, the command no-ops with a `Notice` listing the missing precondition.\n"
    "- [`src/types/literature.ts`](../../src/types/literature.ts) — added `QuoteSource = 'editor' | 'pdf' | 'manual'`, "
    "optional `source` and `locator` fields on `Quote`, and a `QuoteInput` write-side alias.\n"
    "- [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — `addQuote` "
    "default-fills `source: 'editor'` for legacy callers; `extractQuotesFromPdf` stamps "
    "`source: 'pdf'` on every emitted quote; `renderQuoteSection` appends a `-- source: …` "
    "footer line when `quote.source` is set.\n"
    "- [`src/core/plugin.ts`](../../src/core/plugin.ts) — `openQuoteCaptureModal` accepts an "
    "optional `source?: QuoteSource`, and the `capture-quote` command passes `{ selectedText, source: 'editor' }`.\n"
    "- [`src/types/index.ts`](../../src/types/index.ts) — re-exports `QuoteSource`, `QuoteInput`, "
    "and a new `QUOTE_SOURCES` tuple for guarded dropdowns.\n"
    "\n"
    "**Verification**\n"
    "- `npm run build` — exit 0; `main.js` regenerated, no size regression from 2.2+2.5.\n"
    "- `npm run lint` — exit 0; zero errors / zero warnings.\n"
    "- `npx tsc --noEmit` — exit 0.\n"
    "\n"
    "**Drift from §14 (deliberate)**\n"
    "- §14 originally specified a `commentary` textarea on the modal and a `source` field "
    "on `Quote`. Recon pass kept `tags` for discoverability (works with property-based "
    "Dataview today) and renamed the high-volume prose field to `note`; the `source`-as-"
    "editor-stamp wiring still threads through as designed.\n"
    "\n"
    "**Looking ahead**\n"
    "- Tier 2 next: `VaultIndexer` (3.1 — fuse.js index over titles + frontmatter), then "
    "`CitationManager` (3.2 — editorCallback + per-project `.bib` export), then literature-"
    "graph edges (3.3).\n"
)
edits.append(("insert §13 dated sub-pass entry", old2, new2))

for label, old, new in edits:
    count = s.count(old)
    if count != 1:
        print(f"FAIL [{label}]: expected exactly 1 match, got {count}", file=sys.stderr)
        sys.exit(1)
    s = s.replace(old, new)
    print(f"OK  [{label}]")

p.write_text(s)
print(f"Wrote {p} ({p.stat().st_size} bytes).")
