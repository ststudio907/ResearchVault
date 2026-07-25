#!/usr/bin/env python3
"""
2.8.E — Authors as YAML list of plain last-name strings, with
optional parallel `authorFirstNames?` array.

Touch points (from earlier sweep):
  - src/types/literature.ts          (Paper.authors shape change)
  - src/services/paper-service.ts    (input, createManual, persistPaper readers/writers, equality)
  - src/services/vault-indexer.ts    (projectFor joins strings)
  - src/services/project-manager.ts  (default authors: [])
  - src/ui/modals/paper-import-modal.ts (form, submit, helper)
"""

import sys

# ---------------------------------------------------------------------------
# 1. src/types/literature.ts — Paper.authors is now string[]
# ---------------------------------------------------------------------------

path = 'src/types/literature.ts'
with open(path) as f:
    src = f.read()

old = "  authors: Author[];\n  year: number;\n  venue?: string;                  // Journal, conference, etc."
new = (
    "  /** Author last names, one string per author (YAML list). Empty strings are not allowed. */\n"
    "  authors: string[];\n"
    "  /**\n"
    "   * Optional parallel array of author first names, indexed in lockstep with `authors`.\n"
    "   * Absent when the user typed only last names (the common case). When present, every\n"
    "   * entry corresponds to the entry with the same index in `authors` — empty string means\n"
    "   * the author has only a last name. This is the new parallel-array shape (2.8.E), chosen\n"
    "   * so the YAML stays as a YAML list (Obsidian-tag-searchable) and so we keep `Paper.authors`\n"
    "   * a plain `string[]` (no nested objects, no per-author middle/affiliation/orcid yet).\n"
    "   */\n"
    "  authorFirstNames?: string[];\n"
    "  year: number;\n"
    "  venue?: string;                  // Journal, conference, etc."
)
assert src.count(old) == 1, f"literature.ts Paper.authors anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('literature.ts: Paper.authors -> string[], authorFirstNames added')

# ---------------------------------------------------------------------------
# 2. src/services/paper-service.ts
# ---------------------------------------------------------------------------

path = 'src/services/paper-service.ts'
with open(path) as f:
    src = f.read()

# 2a. PaperFrontmatter shape
old = "type PaperFrontmatter = {\n  id: string;\n  citekey: string;\n  title: string;\n  authors: Author[];\n  year: number;"
new = (
    "type PaperFrontmatter = {\n"
    "  id: string;\n"
    "  citekey: string;\n"
    "  title: string;\n"
    "  /** Author last names as a YAML list (2.8.E). */\n"
    "  authors: string[];\n"
    "  /** Optional parallel first names list (2.8.E). */\n"
    "  authorFirstNames?: string[];\n"
    "  year: number;"
)
assert src.count(old) == 1, f"paper-service PaperFrontmatter anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2b. PaperManualInput shape
old = "/** Input shape accepted by `PaperService.createManual`. */\nexport interface PaperManualInput {\n  title: string;\n  authors: Author[];\n  year: number;"
new = (
    "/** Input shape accepted by `PaperService.createManual`. */\n"
    "export interface PaperManualInput {\n"
    "  title: string;\n"
    "  /** Last names per author — the canonical author shape (2.8.E). */\n"
    "  authors: string[];\n"
    "  /** Optional first names, parallel to `authors`. Empty strings allowed. */\n"
    "  authorFirstNames?: string[];\n"
    "  year: number;"
)
assert src.count(old) == 1, f"paper-service PaperManualInput anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2c. createManual — assemble paper using input.authors strings
old = (
    "      authors: input.authors.map(normaliseAuthor),\n"
    "      year: input.year,"
)
new = (
    "      authors: input.authors.map(normaliseAuthorName),\n"
    "      authorFirstNames: input.authorFirstNames\n"
    "        ? input.authorFirstNames.map((n) => n.trim()).map((_n, i) => {\n"
    "            // Pad missing entries (or shorter array) with empty strings so the\n"
    "            // two arrays stay the same length in memory and on disk.\n"
    "            return (input.authorFirstNames ?? [])[i] ?? '';\n"
    "          }).slice(0, input.authors.length)\n"
    "        : undefined,\n"
    "      year: input.year,"
)
assert src.count(old) == 1, f"createManual author spread anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2d. resolveCitekey — first-last-name lattice now from plain string[0]
old = "    const lastName = input.authors[0]?.lastName ?? 'anon';"
new = "    const lastName = input.authors[0] || 'anon';"
assert src.count(old) == 1, f"resolveCitekey anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2e. normaliseAuthor -> normaliseAuthorName
old = (
    "function normaliseAuthor(a: Author): Author {\n"
    "  return {\n"
    "    firstName: a.firstName?.trim() ?? '',\n"
    "    lastName: a.lastName?.trim() ?? '',\n"
    "    middleName: trimOrUndefined(a.middleName),\n"
    "    affiliation: trimOrUndefined(a.affiliation),\n"
    "    orcid: trimOrUndefined(a.orcid),\n"
    "  };\n"
    "}"
)
new = (
    "/** Trim a single author last-name string. Empty/whitespace-only strings become ''. */\n"
    "function normaliseAuthorName(name: string): string {\n"
    "  return (name ?? '').trim();\n"
    "}\n"
    "\n"
    "/**\n"
    " * 2.8.E — Read the legacy `authors: Author[]` frontmatter shape back into\n"
    " * the new `string[]` + `authorFirstNames?` shape. Used only by\n"
    " * `frontmatterToPaper` when an existing note predates 2.8.E.\n"
    " */\n"
    "function authorsFromLegacy(rows: unknown): { lastNames: string[]; firstNames: string[] } {\n"
    "  if (!Array.isArray(rows)) return { lastNames: [], firstNames: [] };\n"
    "  const lastNames: string[] = [];\n"
    "  const firstNames: string[] = [];\n"
    "  for (const row of rows) {\n"
    "    if (row && typeof row === 'object' && 'lastName' in row) {\n"
    "      const r = row as { firstName?: string; lastName?: string };\n"
    "      lastNames.push(normaliseAuthorName(String(r.lastName ?? '')));\n"
    "      firstNames.push(normaliseAuthorName(String(r.firstName ?? '')));\n"
    "    } else if (typeof row === 'string') {\n"
    "      lastNames.push(normaliseAuthorName(row));\n"
    "      firstNames.push('');\n"
    "    }\n"
    "  }\n"
    "  return { lastNames, firstNames };\n"
    "}"
)
assert src.count(old) == 1, f"normaliseAuthor anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2f. toFrontmatter writes both arrays
old = (
    "    title: paper.title,\n"
    "    authors: paper.authors,\n"
    "    year: paper.year,\n"
    "    venue: paper.venue,"
)
new = (
    "    title: paper.title,\n"
    "    authors: paper.authors,\n"
    "    authorFirstNames: paper.authorFirstNames,\n"
    "    year: paper.year,\n"
    "    venue: paper.venue,"
)
assert src.count(old) == 1, f"toFrontmatter author anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2g. frontmatterToPaper — handle all 3 legacy shapes
old = (
    "    title: String(fm.title ?? file.basename),\n"
    "    authors: Array.isArray(fm.authors) ? (fm.authors) : [],\n"
    "    year: typeof fm.year === 'number' ? fm.year : new Date(file.stat.ctime).getFullYear(),"
)
new = (
    "    title: String(fm.title ?? file.basename),\n"
    "    authors: ((): string[] => {\n"
    "      // 2.8.E — three possible shapes on disk:\n"
    "      //   new shape: `authors: [Vaswani, Shazeer]` (string[])\n"
    "      //   new with first names: same + parallel `authorFirstNames?: [Ashish, Noam]`\n"
    "      //   legacy: `authors: [{firstName, lastName}, …]` (object[])\n"
    "      if (!Array.isArray(fm.authors)) return [];\n"
    "      const sample = fm.authors[0];\n"
    "      if (sample && typeof sample === 'object' && 'lastName' in sample) {\n"
    "        return authorsFromLegacy(fm.authors).lastNames;\n"
    "      }\n"
    "      return (fm.authors as unknown[]).map((s) => normaliseAuthorName(String(s ?? '')));\n"
    "    })(),\n"
    "    authorFirstNames: ((): string[] | undefined => {\n"
    "      // 2.8.E — only set when the parallel array actually existed on disk,\n"
    "      // or when the legacy object form had populated firstName fields.\n"
    "      if (Array.isArray(fm.authorFirstNames)) {\n"
    "        const arr = (fm.authorFirstNames as unknown[]).map((s) => normaliseAuthorName(String(s ?? '')));\n"
    "        return arr.length === 0 ? undefined : arr;\n"
    "      }\n"
    "      if (Array.isArray(fm.authors) && fm.authors[0] && typeof fm.authors[0] === 'object') {\n"
    "        const fromLegacy = authorsFromLegacy(fm.authors).firstNames;\n"
    "        return fromLegacy.some((n) => n.length > 0) ? fromLegacy : undefined;\n"
    "      }\n"
    "      return undefined;\n"
    "    })(),\n"
    "    year: typeof fm.year === 'number' ? fm.year : new Date(file.stat.ctime).getFullYear(),"
)
assert src.count(old) == 1, f"frontmatterToPaper author anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2h. templateDataFor — joins lastNames + firstNames
old = (
    "function templateDataFor(paper: Paper): TemplateData {\n"
    "  return {\n"
    "    citekey: paper.citekey,\n"
    "    title: paper.title,\n"
    "    authors: paper.authors.map((a) => a.lastName).join(', '),\n"
    "    year: paper.year,\n"
)
new = (
    "function templateDataFor(paper: Paper): TemplateData {\n"
    "  // 2.8.E — `authors` template placeholder is a comma-joined list of\n"
    "  // \"<first> <last>\" strings when first names exist, else last names only.\n"
    "  const joinedAuthors = paper.authorFirstNames\n"
    "    ? paper.authors\n"
    "        .map((last, i) => `${paper.authorFirstNames?.[i] ?? ''} ${last}`.trim())\n"
    "        .join(', ')\n"
    "    : paper.authors.join(', ');\n"
    "  return {\n"
    "    citekey: paper.citekey,\n"
    "    title: paper.title,\n"
    "    authors: joinedAuthors,\n"
    "    year: paper.year,\n"
)
assert src.count(old) == 1, f"templateDataFor anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2i. authorsEqual — compare last-name strings
old = (
    "function authorsEqual(a: Author[], b: Author[]): boolean {\n"
    "  if (a.length !== b.length) return false;\n"
    "  for (let i = 0; i < a.length; i += 1) {\n"
    "    const x = a[i]!; const y = b[i]!;\n"
    "    if (x.firstName !== y.firstName || x.lastName !== y.lastName) return false;\n"
    "  }\n"
    "  return true;\n"
    "}"
)
new = (
    "/**\n"
    " * 2.8.E — author arrays are plain last-name strings now. We compare only\n"
    " * the canonical `authors` field; `authorFirstNames` is an enriched display\n"
    " * parallel array and is intentionally not part of the equality lattice so\n"
    " * a user editing just the last-name list does not flip `papersEqual`.\n"
    " */\n"
    "function authorsEqual(a: string[], b: string[]): boolean {\n"
    "  if (a.length !== b.length) return false;\n"
    "  for (let i = 0; i < a.length; i += 1) {\n"
    "    if (a[i] !== b[i]) return false;\n"
    "  }\n"
    "  return true;\n"
    "}"
)
assert src.count(old) == 1, f"authorsEqual anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2j. Drop unused Author type import if safe. Author is still re-exported via
#     the literature barrel so we can leave the import here; it might be
#     referenced in some test or downstream caller. Keep it for now.

with open(path, 'w') as f:
    f.write(src)
print('paper-service.ts: full 2.8.E sweep applied')

# ---------------------------------------------------------------------------
# 3. src/services/vault-indexer.ts — projectFor joins plain strings
# ---------------------------------------------------------------------------

path = 'src/services/vault-indexer.ts'
with open(path) as f:
    src = f.read()

old = (
    "function projectFor(paper: Paper): IndexedPaper {\n"
    "  const authorsText = paper.authors\n"
    "    .map((a) => [a.lastName, a.firstName].filter(Boolean).join(', '))\n"
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
    "    .join('; ');"
)
assert src.count(old) == 1, f"vault-indexer projectFor anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('vault-indexer.ts: projectFor joins plain strings')

# ---------------------------------------------------------------------------
# 4. src/services/project-manager.ts — ensure default authors array is still a
#    string[]. The literal `[]` works for both; nothing to change unless
#    something else depends on it. Leaving a no-op log here.
# ---------------------------------------------------------------------------

print('project-manager.ts: no change (empty authors literal is still string[])')

# ---------------------------------------------------------------------------
# 5. src/ui/modals/paper-import-modal.ts
# ---------------------------------------------------------------------------

path = 'src/ui/modals/paper-import-modal.ts'
with open(path) as f:
    src = f.read()

src = src.replace(
    "import type { Author, Paper, Priority, ReadingStatus } from '../../types';",
    "import type { Paper, Priority, ReadingStatus } from '../../types';",
    1,
)

# 5a. PaperImportForm: add `firstNames: string` and drop the Author-shaped edit seed
old = (
    "interface PaperImportForm {\n"
    "  projectId: string;\n"
    "  title: string;\n"
    "  primaryAuthorLast: string;\n"
    "  additionalAuthors: string;\n"
    "  year: string;\n"
)
new = (
    "interface PaperImportForm {\n"
    "  projectId: string;\n"
    "  title: string;\n"
    "  primaryAuthorLast: string;\n"
    "  additionalAuthors: string;\n"
    "  /** Optional parallel first names (2.8.E). Empty string per index. */\n"
    "  firstNames: string;\n"
    "  year: string;\n"
)
assert src.count(old) == 1, f"PaperImportForm anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5b. Edit-mode seed — read from string[] + optional firstNames
old = (
    "      this.form = {\n"
    "        projectId: (p.customFields['projectId'] as string | undefined) ?? activeId,\n"
    "        title: p.title,\n"
    "        primaryAuthorLast: p.authors[0]?.lastName ?? '',\n"
    "        additionalAuthors: p.authors\n"
    "          .slice(1)\n"
    "          .map((a) => `${a.firstName ? a.firstName + ' ' : ''}${a.lastName}`.trim())\n"
    "          .filter(Boolean)\n"
    "          .join(', '),\n"
    "        year: String(p.year),\n"
)
new = (
    "      this.form = {\n"
    "        projectId: (p.customFields['projectId'] as string | undefined) ?? activeId,\n"
    "        title: p.title,\n"
    "        primaryAuthorLast: p.authors[0] ?? '',\n"
    "        additionalAuthors: p.authors.slice(1).join(', '),\n"
    "        firstNames: (p.authorFirstNames ?? []).slice(1).join(', '),\n"
    "        year: String(p.year),\n"
)
assert src.count(old) == 1, f"edit seed anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5c. New-mode seed — add firstNames: ''
old = (
    "      this.form = {\n"
    "        projectId: activeId,\n"
    "        title: '',\n"
    "        primaryAuthorLast: '',\n"
    "        additionalAuthors: '',\n"
    "        year: String(new Date().getFullYear()),\n"
)
new = (
    "      this.form = {\n"
    "        projectId: activeId,\n"
    "        title: '',\n"
    "        primaryAuthorLast: '',\n"
    "        additionalAuthors: '',\n"
    "        firstNames: '',\n"
    "        year: String(new Date().getFullYear()),\n"
)
assert src.count(old) == 1, f"new-mode seed anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5d. submit() — build both arrays via new helper
old = (
    "    const authors: Author[] = buildAuthors(this.form.primaryAuthorLast, this.form.additionalAuthors);\n"
    "    const year = Number(this.form.year);"
)
new = (
    "    const { lastNames, firstNames } = buildAuthorRows(\n"
    "      this.form.primaryAuthorLast,\n"
    "      this.form.additionalAuthors,\n"
    "      this.form.firstNames,\n"
    "    );\n"
    "    const year = Number(this.form.year);"
)
assert src.count(old) == 1, f"submit authors anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5e. submit() — pass string[] and string[] to updatePaper / createManual (twice)
old = (
    "        const updated: Paper = await this.rv.paperService.updatePaper(this.paperToEdit.id, {\n"
    "          title: this.form.title.trim(),\n"
    "          authors,\n"
    "          year,\n"
)
new = (
    "        const updated: Paper = await this.rv.paperService.updatePaper(this.paperToEdit.id, {\n"
    "          title: this.form.title.trim(),\n"
    "          authors: lastNames,\n"
    "          authorFirstNames: firstNames,\n"
    "          year,\n"
)
assert src.count(old) == 1, f"submit updatePaper anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

old = (
    "      const paper: Paper = await this.rv.paperService.createManual(\n"
    "        {\n"
    "          title: this.form.title.trim(),\n"
    "          authors,\n"
    "          year,\n"
)
new = (
    "      const paper: Paper = await this.rv.paperService.createManual(\n"
    "        {\n"
    "          title: this.form.title.trim(),\n"
    "          authors: lastNames,\n"
    "          authorFirstNames: firstNames,\n"
    "          year,\n"
)
assert src.count(old) == 1, f"submit createManual anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5f. Replace buildAuthors helper with buildAuthorRows
old = (
    "/**\n"
    " * Convert the free-form \"Author, Author, Author\" input into `Author` rows.\n"
    " * Names longer than one token are split heuristically: last token becomes\n"
    " * the `lastName`, the rest becomes `firstName`. This is intentionally\n"
    " * low-effort; users can edit the file directly if they want full fidelity.\n"
    " */\n"
    "function buildAuthors(primary: string, additional: string): Author[] {\n"
    "  const tokens = [primary, ...additional.split(',')].map((t) => t.trim()).filter(Boolean);\n"
    "  return tokens.map((raw) => {\n"
    "    const parts = raw.split(/\\s+/).filter(Boolean);\n"
    "    if (parts.length === 1) return { firstName: '', lastName: parts[0] ?? '' };\n"
    "    const last = parts[parts.length - 1] ?? '';\n"
    "    const first = parts.slice(0, -1).join(' ');\n"
    "    return { firstName: first, lastName: last };\n"
    "  });\n"
    "}\n"
)
new = (
    "/**\n"
    " * Convert the modal's three comma-separated name fields into parallel\n"
    " * `lastNames` + `firstNames` string arrays (2.8.E). When the user types\n"
    " * only a last-name field, `firstNames` is empty. When the user types\n"
    " * full names in the additional-authors field (e.g. \"Ashish Vaswani\"),\n"
    " * we heuristically split the last token off as the last name. (\n"
    " * The optional parallel `firstNames` input is treated as one first-name\n"
    " * per additional author — same length as `additionalAuthors` after\n"
    " * trimming). The primary author's first name lives in the first\n"
    " * `firstNames` entry.\n"
    " */\n"
    "function buildAuthorRows(\n"
    "  primary: string,\n"
    "  additional: string,\n"
    "  firstNamesCsv: string,\n"
    "): { lastNames: string[]; firstNames: string[] } {\n"
    "  const additionalTokens = additional.split(',').map((t) => t.trim()).filter(Boolean);\n"
    "  const extraCounts = additionalTokens.length;\n"
    "  const firstNamesRaw = firstNamesCsv.split(',').map((t) => t.trim());\n"
    "\n"
    "  const lastNames: string[] = [];\n"
    "  const firstNames: string[] = [];\n"
    "\n"
    "  // Primary author: last name is `primary`; first name comes from `firstNamesRaw[0]`.\n"
    "  const primaryLast = primary.trim();\n"
    "  if (primaryLast) {\n"
    "    // If primary contains spaces, treat the trailing word as the last name.\n"
    "    const parts = primaryLast.split(/\\s+/).filter(Boolean);\n"
    "    if (parts.length > 1) {\n"
    "      const last = parts[parts.length - 1] ?? '';\n"
    "      firstNames.push(parts.slice(0, -1).join(' '));\n"
    "      lastNames.push(last);\n"
    "    } else {\n"
    "      const fn = (firstNamesRaw[0] ?? '').trim();\n"
    "      firstNames.push(fn);\n"
    "      lastNames.push(primaryLast);\n"
    "    }\n"
    "  }\n"
    "\n"
    "  // Additional authors.\n"
    "  for (let i = 0; i < extraCounts; i += 1) {\n"
    "    const raw = additionalTokens[i] ?? '';\n"
    "    const explicitFirst = i < firstNamesRaw.length ? (firstNamesRaw[i] ?? '').trim() : '';\n"
    "    if (explicitFirst) {\n"
    "      lastNames.push(raw);\n"
    "      firstNames.push(explicitFirst);\n"
    "      continue;\n"
    "    }\n"
    "    const parts = raw.split(/\\s+/).filter(Boolean);\n"
    "    if (parts.length <= 1) {\n"
    "      lastNames.push(parts[0] ?? '');\n"
    "      firstNames.push('');\n"
    "    } else {\n"
    "      lastNames.push(parts[parts.length - 1] ?? '');\n"
    "      firstNames.push(parts.slice(0, -1).join(' '));\n"
    "    }\n"
    "  }\n"
    "\n"
    "  return { lastNames, firstNames };\n"
    "}\n"
)
assert src.count(old) == 1, f"buildAuthors anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('paper-import-modal.ts: 2.8.E form + submit + helper applied')

print('--- 2.8.E patch complete ---')
