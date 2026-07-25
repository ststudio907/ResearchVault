#!/usr/bin/env python3
"""2.8.E lint fix — drop unused Author import + safe-stringify helper."""

path = 'src/services/paper-service.ts'
with open(path) as f:
    src = f.read()

# 1. Drop unused Author from the import. The Author type is still exported
#    by the literature barrel but no longer used in this file directly.
old = "import type {\n  Author,\n  Paper,\n  PaperSource,\n  Quote,\n  ReadingStatus,\n} from '../types';"
new = "import type {\n  Paper,\n  PaperSource,\n  Quote,\n  ReadingStatus,\n} from '../types';"
assert src.count(old) == 1, f"unused-import anchor not found (count={src.count(old)})"
src = src.replace(old, new, 1)

# 2. Swap the two flaky String(s ?? '') reader calls for a safe helper.
old1 = "      return (fm.authors as unknown[]).map((s) => normaliseAuthorName(String(s ?? '')));"
new1 = "      return (fm.authors as unknown[]).map((s) => normaliseAuthorName(coerceFrontmatterScalar(s)));"
assert src.count(old1) == 1, f"reader1 anchor not found (count={src.count(old1)})"
src = src.replace(old1, new1, 1)

old2 = "        const arr = (fm.authorFirstNames as unknown[]).map((s) => normaliseAuthorName(String(s ?? '')));"
new2 = "        const arr = (fm.authorFirstNames as unknown[]).map((s) => normaliseAuthorName(coerceFrontmatterScalar(s)));"
assert src.count(old2) == 1, f"reader2 anchor not found (count={src.count(old2)})"
src = src.replace(old2, new2, 1)

# 3. Add the helper. Drop it just below `coerce(input: unknown)` in
#    src/utils/format-date.ts so we don't crowd paper-service.ts. We'll inline
#    a tiny private helper here instead — the file doesn't import a stringifier.
insert_after = (
    "function authorsEqual(a: string[], b: string[]): boolean {\n"
)
helper = (
    "/**\n"
    " * 2.8.E frontmatter reader helper. YAML scalars can hand us strings,\n"
    " * numbers, booleans, or null. Anything else (rolls up as objects/arrays\n"
    " * after YAML's incomplete typing) we coerce to '' so the YAML stays\n"
    " * round-trippable without surprising object-stringification defaults.\n"
    " */\n"
    "function coerceFrontmatterScalar(value: unknown): string {\n"
    "  if (typeof value === 'string') return value;\n"
    "  if (typeof value === 'number' || typeof value === 'boolean') return String(value);\n"
    "  return '';\n"
    "}\n"
    "\n"
)
assert src.count(insert_after) == 1, f"insert anchor not found"
src = src.replace(insert_after, helper + insert_after, 1)

with open(path, 'w') as f:
    f.write(src)
print('paper-service.ts: lint-fix applied (unused Author + safe scalar coercion)')
