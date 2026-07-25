#!/usr/bin/env python3
"""2.8.E modal patch — runs alone after the indexer fix."""

path = 'src/ui/modals/paper-import-modal.ts'
with open(path) as f:
    src = f.read()

# 5a. drop Author import
old = "import type { Author, Paper, Priority, ReadingStatus } from '../../types';"
new = "import type { Paper, Priority, ReadingStatus } from '../../types';"
assert src.count(old) == 1, f"modal import anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5b. PaperImportForm
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

# 5c. Edit-mode seed
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
    "        // 2.8.E — `paper.authors` becomes the canonical last-name string[];\n"
    "        // parallel `authorFirstNames?` (optional) carries first names.\n"
    "        primaryAuthorLast: p.authors[0] ?? '',\n"
    "        additionalAuthors: p.authors.slice(1).join(', '),\n"
    "        firstNames: (p.authorFirstNames ?? []).slice(1).join(', '),\n"
    "        year: String(p.year),\n"
)
assert src.count(old) == 1, f"edit seed anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 5d. New-mode seed
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

# 5e. submit — build author rows
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

# 5f. submit updatePaper
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

# 5g. submit createManual
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

# 5h. Replace buildAuthors helper with buildAuthorRows
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
    " * 2.8.E — Convert the modal's three comma-separated name fields into\n"
    " * parallel `lastNames` + `firstNames` string arrays.\n"
    " *\n"
    " * - `primary` is the required last name of the first author.\n"
    " * - `additional` is comma-separated additional author names.\n"
    " * - `firstNamesCsv` is comma-separated first names corresponding (1-to-1)\n"
    " *   to entries in `additional`. The first entry corresponds to additional\n"
    " *   author index 0 and is paired with the modal's primary last name.\n"
    " *\n"
    " * When a parallel first name is supplied for an author, it's preferred\n"
    " * and we don't auto-split the name. When omitted and an author entry has\n"
    " * multiple space-separated tokens, the last token becomes the last name.\n"
    " */\n"
    "function buildAuthorRows(\n"
    "  primary: string,\n"
    "  additional: string,\n"
    "  firstNamesCsv: string,\n"
    "): { lastNames: string[]; firstNames: string[] } {\n"
    "  const additionalTokens = additional.split(',').map((t) => t.trim()).filter(Boolean);\n"
    "  const firstNamesRaw = firstNamesCsv.split(',').map((t) => t.trim());\n"
    "  // The primary author's first name lives in `firstNamesRaw[0]`. Additional\n"
    "  // authors consume slots from index 1 onward. Trim all entries up-front so\n"
    "  // the loop below can simply read by index.\n"
    "  const namesList = [primary, ...additionalTokens];\n"
    "  // For each entry, choose the first name:\n"
    "  //   - primary (index 0): use firstNamesRaw[0] if present, else auto-split.\n"
    "  //   - additional (index > 0): use firstNamesRaw[i] if present, else auto-split.\n"
    "  const lastNames: string[] = [];\n"
    "  const firstNames: string[] = [];\n"
    "  namesList.forEach((raw, i) => {\n"
    "    if (!raw) return;\n"
    "    const explicitFirst = i < firstNamesRaw.length ? (firstNamesRaw[i] ?? '').trim() : '';\n"
    "    const parts = raw.split(/\\s+/).filter(Boolean);\n"
    "    if (explicitFirst) {\n"
    "      lastNames.push(parts.join(' ') || raw);\n"
    "      firstNames.push(explicitFirst);\n"
    "      return;\n"
    "    }\n"
    "    if (parts.length <= 1) {\n"
    "      lastNames.push(parts[0] ?? raw);\n"
    "      firstNames.push('');\n"
    "    } else {\n"
    "      lastNames.push(parts[parts.length - 1] ?? '');\n"
    "      firstNames.push(parts.slice(0, -1).join(' '));\n"
    "    }\n"
    "  });\n"
    "  return { lastNames, firstNames };\n"
    "}\n"
)
assert src.count(old) == 1, f"buildAuthors anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

with open(path, 'w') as f:
    f.write(src)
print('paper-import-modal.ts: 2.8.E form + submit + helper applied')
