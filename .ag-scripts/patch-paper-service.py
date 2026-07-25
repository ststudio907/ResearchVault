#!/usr/bin/env python3
"""Phase A — paper-service.ts patches:
1. addQuote: default source: 'editor' on insert.
2. extractQuotesFromPdf: stamp source: 'pdf' on extracted quotes.
3. renderQuoteSection: append `-- source: <x>` footer when quote.source is set.
"""
import pathlib
import sys

p = pathlib.Path("src/services/paper-service.ts")
s = p.read_text()

edits = []

# Edit 1 — addQuote: default source when caller didn't supply one
old1 = "      createdAt: quote.createdAt ?? Date.now(),\n    };\n    paper.quotes.push(storedQuote);"
new1 = (
    "      createdAt: quote.createdAt ?? Date.now(),\n"
    "      source: quote.source ?? 'editor',\n"
    "    };\n    paper.quotes.push(storedQuote);"
)
edits.append(("addQuote default source", old1, new1))

# Edit 2 — extractQuotesFromPdf: stamp source: 'pdf' on every extracted quote
old2 = "        tags: [],\n        createdAt: Date.now(),\n      };\n      paper.quotes.push(quote);"
new2 = (
    "        tags: [],\n"
    "        createdAt: Date.now(),\n"
    "        source: 'pdf',\n"
    "      };\n"
    "      paper.quotes.push(quote);"
)
edits.append(("extractQuotesFromPdf source: 'pdf'", old2, new2))

# Edit 3 — renderQuoteSection: include `-- source: <x>` line when source is set
old3_part1 = "  const tagsLine = quote.tags.length > 0 ? `\\n#tags: ${quote.tags.join(' ')}\\n` : '\\n';\n  return `${head}${metaLine}${tagsLine}`;\n}"
new3_part1 = (
    "  const tagsLine = quote.tags.length > 0 ? `\\n#tags: ${quote.tags.join(' ')}\\n` : '\\n';\n"
    "  const sourceLine = quote.source ? `\\n-- source: ${quote.source}\\n` : '\\n';\n"
    "  return `${head}${metaLine}${tagsLine}${sourceLine}`;\n}"
)
edits.append(("renderQuoteSection source line", old3_part1, new3_part1))

for label, old, new in edits:
    count = s.count(old)
    if count != 1:
        print(f"FAIL [{label}]: expected exactly 1 match, got {count}", file=sys.stderr)
        sys.exit(1)
    s = s.replace(old, new)
    print(f"OK  [{label}]")

p.write_text(s)
print(f"Wrote {p} ({p.stat().st_size} bytes).")
