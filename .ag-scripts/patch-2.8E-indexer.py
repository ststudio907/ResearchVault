#!/usr/bin/env python3
"""2.8.E vault-indexer fix — runs alone after the main 2.8E patch."""

path = 'src/services/vault-indexer.ts'
with open(path) as f:
    src = f.read()

old = (
    "function projectFor(paper: Paper): IndexedPaper {\n"
    "  const authorsText = paper.authors\n"
    "    .map((a) => [a.lastName, a.firstName].filter(Boolean).join(', '))\n"
    "    .filter(Boolean)\n"
    "    .join('; ');"
)
new = (
    "function projectFor(paper: Paper): IndexedPaper {\n"
    "  // 2.8.E — `paper.authors` is the last-name string[]; if a parallel\n"
    "  // `authorFirstNames?` array exists we prefix each entry with the\n"
    "  // corresponding first name (whitespace-trimmed, missing -> '').\n"
    "  const firsts = paper.authorFirstNames ?? [];\n"
    "  const authorsText = paper.authors\n"
    "    .map((last, i) => `${firsts[i] ?? ''} ${last}`.trim())\n"
    "    .filter(Boolean)\n"
    "    .join('; ');"
)
assert src.count(old) == 1, f"indexer anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('vault-indexer.ts: projectFor joins plain strings')
