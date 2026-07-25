#!/usr/bin/env python3
"""One-shot: replace the renderCitations description in settings-tab.ts."""
from pathlib import Path

p = Path("src/ui/settings/settings-tab.ts")
text = p.read_text()

# Match the exact literal opening of the description string (deterministic).
needle_start = "'Look up papers by doi or title using crossref and openalex."
needle_end = "import form.',"
i = text.find(needle_start)
j = text.find(needle_end, i)
assert i > -1 and j > -1, f"needle_start found={i} needle_end found={j}"
# The string spans [i .. j+len(needle_end)]; back up one to include the trailing comma.
end_inclusive = j + len(needle_end)
# Plus everything between should evaluate to a single TypeScript string-literal.
old = text[i:end_inclusive]
print(f"[INFO] old line: {old[:60]}...{old[-20:]}")

# New privacy-first copy (plan §4.1.D verbatim).
new = "'Lookups send only the doi or search string. We do not send your vault contents, file names, or paper notes. No analytics. Api responses are cached locally for 30 days.',"

assert text.count(old) == 1
text = text[:i] + new + text[end_inclusive:]

p.write_text(text)
print("[OK] settings-tab.ts description replaced")
