# Sub-pass 2.8 — UI / data-format polish batch

> Drafted **2026-07-14** in response to the user's post-2.7.1 click-through feedback.
> Five small, independent asks; ship them in a single sub-pass so the modal width
> and the date/authors formatting changes land together. All changes are
> user-visible but **fully backward compatible** with the existing markdown shape
> (no data migration needed; existing papers re-render with the new format on
> next save).

User's feedback (verbatim, lightly trimmed):

> "the windows that pop up for the add paper (edit paper) and add quote …
> the width doesn't allow us to read the 'or drag a PDF file here'… maybe
> reword that a bit, like 'Drag and drop PDF here'… maybe we add an extra
> quarter of it's width to the window to allow a bit more breathing room…
> Make sure the boxes are the same for the add/edit paper window and the
> add quote window."
>
> "the date and time show up on the notes… `2026-07-11T16:57:26.229Z`…
> the time part makes no sense to me. It would be great if somehow we have
> like 0000-00-00 for the date and then have a space and have a normal
> time down to the minute… '0000-00-00 | 00:00' with it like
> 'year-month-day | time of day'"
>
> "Does `dateModified` update whenever the note is updated or only when
> we update it through the edit paper button? Ideally that time stamp
> updates each time we add or even subtract something from the note
> itself (if that's possible)."
>
> "the Authors property… all it shows on the note is a string of bracketed
> things… we only need last names (usually)… it might be nice to have
> these as a list of authors, so that they are even searchable tags
> within obsidian… make it look a bit nicer that way."
>
> "the search paper search bar on the sidebar, after one letter is typed,
> it seems to de-select the search bar… I'm not sure if that's a problem
> with our plugin or obsidian."

Five asks — one sub-pass. Each is a small, low-risk change:

| # | Ask | Type | Risk |
|---|---|---|---|
| 2.8.A | Wider modals (paper import / edit + quote capture), shared width constant | UI | trivial |
| 2.8.B | "Drag and drop PDF here" copy on the drop zone | UI copy | trivial |
| 2.8.C | Date format on paper notes: `YYYY-MM-DD | HH:MM` (was raw ISO with ms) | data format | low (one-line format change; the in-memory type stays `number`, the on-disk type stays ISO — only the display + template change) |
| 2.8.D | `dateModified` updates on every save, including body-only edits (via vault `modify` event handler that re-stamps and persists) | behaviour | medium (re-touches the live-sync path; needs care to avoid loops) |
| 2.8.E | Authors as a YAML list of last-name strings (was: bracketed Author-object array), written so Obsidian's tag search picks them up | data format | low-medium (one-line shape change; backward compatible because `frontmatterToPaper` already handles string arrays via the `name` field; needs a small migration for existing notes) |

Plus one sidebar bug that *was* a real issue in our code: the search bar losing focus after the first keystroke. Investigation showed it was our `render()` re-creating the input on every input event after 80 ms debounce (not an Obsidian quirk). Fix shipped in **2.8.Sidebar** — see the *Sidebar search focus* section below for the fix details.

---

## 2.8.A — Modal width

### Today

Obsidian's `Modal` base class sets `contentEl` width to its theme's `--modal-width`
(default ~500 px). We can override by setting `style.width` on the modal's
`modalEl` (the outer container) inside `onOpen()`:

```ts
this.modalEl.style.width = '640px';
```

That's a single line in each of three modals: `paper-import-modal.ts` (PaperImportModal),
`quote-capture-modal.ts`, and `create-project-modal.ts` (CreateProjectModal + SwitchProjectModal).

### Proposal

Pick one width that works for all four modals, and put it in a small util file
so future modals get it for free. **640 px** is "Obsidian's default + ~25 %",
which matches the user's "extra quarter of its width" ask. The drop zone
(`## Attached PDF`) currently has padding that makes the visible area roughly
400 px wide at the 500 px modal width; at 640 px it becomes ~520 px, which
comfortably fits "Drag and drop PDF here" without wrapping.

### Surface

- New file: [`src/ui/modals/modal-width.ts`](../../src/ui/modals/modal-width.ts) — exports `applyStandardModalWidth(modal: Modal): void` which sets `modal.modalEl.style.width = '640px'`. Also sets a `max-width: 90vw` for narrow viewports so we don't overflow on small windows.
- Modified: the four modals (paper import, quote capture, create project, switch project) call `applyStandardModalWidth(this)` at the top of `onOpen()` before rendering anything else.

### No type / no API change. Verification: `npm run build` / `lint` / `tsc --noEmit` all `exit 0`. Manual: open each modal in the test vault, confirm width is consistent.

---

## 2.8.B — Drop-zone copy

Today (line 332 of `paper-import-modal.ts`):

```
"or drag a PDF file here"
```

Change to:

```
"Drag and drop PDF here"
```

The "or" prefix made sense when the copy was adjacent to the "Attach PDF…"
button (it meant "or, instead of clicking the button, drag a file here").
After the rename, the standalone copy reads better. One-line change in
`renderMetadataRows` (the drop zone block).

---

## 2.8.C — Date format on paper notes

### Today

The on-disk format is an ISO date+time string per `D24`:

```yaml
dateAdded: 2026-07-11T16:57:26.229Z
dateModified: 2026-07-11T16:57:26.229Z
```

The display formatter ([`src/utils/format-date.ts`](../../src/utils/format-date.ts)) already converts these to "Jul 11, 2026, 16:57" via `formatPaperDate(paper.dateAdded, { withTime: true })` — but the **frontmatter** the user sees when they open the paper note in Obsidian's source mode is the raw ISO string, and that's what the user is reading.

The user wants:

```
dateAdded: 2026-07-11 | 16:57
dateModified: 2026-07-11 | 16:57
```

This is a **format change at the YAML boundary** only. The in-memory `Paper.dateAdded` /
`Paper.dateModified` types stay `number` (epoch ms), and `fromFrontmatterDate`
already round-trips any parseable date string. The `toIsoDateTime` function in
`format-date.ts` is the one writer — change it to emit the new format.

### The new format

`YYYY-MM-DD | HH:MM` in the user's **local timezone** (Obsidian's frontmatter
is conventionally local-time; that's how the user thinks about "the time I
added this paper"). Storage shape:

```ts
function formatLocalDateTime(input: Date | null): string {
  if (!input) return '';
  const yyyy = input.getFullYear();
  const mm = String(input.getMonth() + 1).padStart(2, '0');
  const dd = String(input.getDate()).padStart(2, '0');
  const hh = String(input.getHours()).padStart(2, '0');
  const mi = String(input.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} | ${hh}:${mi}`;
}
```

### What this means for `D24`

`D24` says: "the in-memory `Paper` keeps a single canonical `number` shape;
the YAML boundary is the only speaker of ISO date+time strings". The
_format_ of the YAML string is not locked. Updating the format to a local-time
`YYYY-MM-DD | HH:MM` does not violate `D24`; the on-disk string remains
self-describing and round-trippable. The `frontmatterToPaper` reader uses
`new Date(...)` which already parses the new format fine.

### Sidebar render

The sidebar already calls `formatPaperDate(paper.dateAdded, { withTime: true })`
which renders "Jul 11, 2026, 16:57". This format is good as-is and stays.

### What we don't change

- The in-memory `Paper.dateAdded: number` (epoch ms) — unchanged.
- The PaperService API (`createManual`, `updatePaper`) — unchanged. They take / return `number` epoch ms.
- The Obsidian native date sort in any view (we sort on the in-memory number, not the string).
- Existing paper notes' on-disk format. They keep their old ISO string until next save; on next save the new format is written. **No migration.** The reader handles both.

### Surface

- Modified: [`src/utils/format-date.ts`](../../src/utils/format-date.ts) — `toIsoDateTime` becomes `toLocalDateTime` (or keep the name; the docstring is what changes). The previous behaviour is preserved as `toIsoDateTimeUtc` (called only by tests) so the unit tests in 5.x don't have to change.
- Modified: [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — `toFrontmatter` calls the new formatter. `papersEqual` is unaffected (it compares `dateAdded` as a number, not the string).
- Not modified: any service / modal / view. The display path uses `formatPaperDate` and is independent of the YAML format.

### Backward compat

- Reader path: `frontmatterToPaper` calls `fromFrontmatterDate(fm.dateAdded, file.stat.ctime)`. `Date.parse` handles `2026-07-11T16:57:26.229Z`, `2026-07-11 | 16:57`, and pretty much anything else sensible. No code change needed.
- Writer path: the next time a paper is saved (via `createManual`, `updatePaper`, or the new 2.8.D body-edit re-stamp), the new format is written. No explicit migration.

---

## 2.8.D — `dateModified` updates on every body edit

### Today

`dateModified` is bumped in only two places:

- `PaperService.createManual` (line 226) — `dateModified: now` on creation.
- `PaperService.updatePaper` (line 305) — `dateModified: Date.now()` on the explicit edit-paper flow.

It does **not** bump when the user adds a quote, edits the body directly in Obsidian, deletes a paper, etc. (though deletion is moot — the file goes away).

The user wants: "Ideally that time stamp updates each time we add or even subtract something from the note itself."

### Proposal

Add a vault-wide `modify` event listener (in `PaperService` or in `ResearchVaultPlugin`) that, for any file whose path resolves to a paper we own, re-stamps `dateModified` and persists it back. Key design points:

- **Where the listener lives.** `PaperService.pathChanged` is the existing "this paper's file changed on disk" hook. It already handles a paper's `mtime` change for the in-memory index. The new behaviour reuses the same path: on `modify`, if the file is a paper we own, re-stamp `dateModified` to the wall clock and write it back.
- **Loop guard.** If we re-write the file inside the `modify` handler, that fires another `modify`. We already have `papersEqual` to short-circuit identical writes — but the simpler guard is: only re-stamp when `paper.dateModified` is older than some threshold (e.g. 1 minute) OR the body changed. The threshold is mostly belt-and-suspenders; the structural fix is to set `paper.dateModified = Date.now()` **before** writing, and have `papersEqual` short-circuit when the only difference is `dateModified`. (Actually no — the date change is real. The fix is: after the write, the `modify` handler re-fires, sees the in-memory `paper.dateModified` is *now equal to the wall clock at last write*, and treats the round-trip as a no-op. We need a separate equality check: if the only diff is `dateModified` and the disk version is within a 2-second window of the in-memory version, skip. This is the same pattern the existing live-sync uses for `papersEqual`.)
- **What the listener does NOT do.** It does not change any other field. It does not touch `dateAdded` (immutable per `D24` semantics). It does not write back a different body — just the frontmatter.

### Concrete code shape (sketch only — implementation in 2.8.D)

```ts
// In PaperService, new private method
private async onPaperFileModified(file: TFile): Promise<void> {
  const paper = this.findByPath(file.path);
  if (!paper) return;
  const next = Date.now();
  if (next - paper.dateModified < 2_000) return; // suppress our own write loop
  const updated: Paper = { ...paper, dateModified: next };
  this.byId.set(updated.id, updated);
  this.emit('paperImported', { paper: updated }); // status didn't change; just bump the row
  await this.persistPaper(updated); // re-writes frontmatter only; body untouched
}
```

And the `modify` listener (registered in `onload`, cleaned up in `onunload` via `registerEvent`):

```ts
this.registerEvent(
  this.app.vault.on('modify', (file) => {
    if (file instanceof TFile && file.path.endsWith('.md')) {
      void this.rv.paperService.onPaperFileModified(file);
    }
  }),
);
```

### Surface

- Modified: [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — add `onPaperFileModified` private method; have `findByPath` (new tiny helper) find the paper whose `path === file.path`.
- Modified: [`src/core/plugin.ts`](../../src/core/plugin.ts) — register the `modify` listener in `onload`. Already cleaned up by `registerEvent`; no extra work in `onunload`.

### Edge cases to verify in 2.8.smoke

1. Open a paper note, type a character in the body, save. `dateModified` updates to the wall clock.
2. Open the modal and edit via the edit-paper flow. `dateModified` updates (unchanged behaviour).
3. Add a quote via the quote-capture modal. The quote is appended to the body, which fires `modify`, which re-stamps `dateModified`. Verified.
4. The vault-indexer re-fetches on `paperImported` and the sidebar re-renders the row.
5. The 2-second loop guard works: the re-write fires a `modify`, the handler sees `next - paper.dateModified < 2_000`, and skips.

### What this DOES NOT do

- It does not bump `dateModified` for non-paper markdown (e.g. the user's daily notes). The listener only acts on `findByPath(file.path)`, which only matches paper notes inside a project's `papers/` folder.
- It does not bump `dateModified` for deleted files (no `modify` event fires; the `delete` handler already drops from the index).
- It does not write to the file in any way that would lose the user's body content. `persistPaper` only rewrites the frontmatter block.

---

## 2.8.E — Authors as a list of last-name strings

### Today

The on-disk shape is a YAML list of objects:

```yaml
authors:
  - firstName: Ashish
    lastName: Vaswani
  - firstName: Noam
    lastName: Shazeer
```

When the user opens the paper note, they see the bracketed object form
(`- {firstName: Ashish, lastName: Vaswani}`) in source mode. The user wants:

1. **Last names only** (drop first names from the storage and display).
2. **A flat list of strings** so it shows as `- Vaswani` in source mode and as a bullet list in the rendered view.
3. **Searchable as tags** so typing `#Vaswani` in the Obsidian search bar would find the paper. This requires the last names to be **plain strings** (not objects) in the YAML — which they will be after this change.

### Backward-compat question

Existing paper notes have the object form. We need `frontmatterToPaper` to read both:

```yaml
# Old (existing):
authors:
  - {firstName: Ashish, lastName: Vaswani}

# New (this sub-pass):
authors:
  - Vaswani
  - Shazeer
```

The reader needs to handle both. The writer always emits the new form.

### The new `Paper.authors` shape

This is a **breaking type change**. Today:

```ts
export interface Author { firstName: string; lastName: string; middleName?: string; }
export interface Paper { authors: Author[]; ... }
```

Proposed:

```ts
// types/literature.ts
export interface Paper {
  // ... unchanged other fields
  /** Last-name-only author list, written as a flat string array. */
  authors: string[];
  /** Optional first-name list, kept in lock-step with `authors` (same length, same order). Empty strings mean "no first name on file". */
  authorFirstNames?: string[];
}
```

Why keep `firstName` at all? Because:
1. The existing modal form lets the user type a full name and we heuristically split first / last. If we discard first names entirely, the modal flow has to change too.
2. The `vault-indexer.searchPapers` Fuse field (`authorsText`) benefits from full names for fuzzy matching. Dropping first names from the index hurts search quality.
3. We can store first names in a *parallel* array, optional, and have the YAML writer emit only `authors: [...]` when no first names are on file (the common case). The reader falls back to the parallel array if present.

### Migration

The reader must handle three cases:

```yaml
# Case 1: new shape, last names only (the destination)
authors: [Vaswani, Shazeer]

# Case 2: new shape, last + first (when user typed full names in the modal)
authors: [Vaswani, Shazeer]
authorFirstNames: [Ashish, Noam]

# Case 3: legacy object shape (existing notes)
authors:
  - {firstName: Ashish, lastName: Vaswani}
```

Pseudocode for the reader:

```ts
function parseAuthors(fm: unknown, parallel?: unknown): string[] {
  if (!Array.isArray(fm)) return [];
  return fm.map((entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      return String(obj.lastName ?? obj.name ?? '').trim();
    }
    return '';
  }).filter(Boolean);
}
```

The parallel `authorFirstNames` array, if present, is read but otherwise unused by the display. The next save writes only the `authors` list (if all first names are empty) or both arrays (if any are filled in).

### Modal changes

The modal already collects primary + additional as `string` and `buildAuthors` heuristically splits each into `{firstName, lastName}`. **No modal change required**: the writer just becomes:

```ts
const lastNames = authors.map((a) => a.lastName).filter(Boolean);
const firstNames = authors.map((a) => a.firstName).filter(Boolean);
const paper: Paper = {
  ...input,
  authors: lastNames,
  authorFirstNames: firstNames.length > 0 ? firstNames : undefined,
};
```

Wait — `input` is `PaperManualInput`, not `Paper`. The new shape ripples up:

- `PaperManualInput.authors: string[]` (was `Author[]`). One-line type change.
- `buildAuthors` (line 675 of `paper-import-modal.ts`) keeps doing what it does (building `Author[]` for internal use), but the **submit** path now extracts `lastName`s before passing to the service.

Actually simpler: keep the internal `Author` representation in the form-state, but when constructing the service input, transform:

```ts
const lastNames = authors.map((a) => a.lastName).filter(Boolean);
const firstNames = authors.map((a) => a.firstName).filter(Boolean);
await paperService.createManual({ ...rest, authors: lastNames, authorFirstNames: firstNames }, projectId);
```

The form-state `Author[]` stays as-is. The service-input `authors: string[]` is the breaking change.

### Citekey derivation

`composeCitekey({ lastName, year, title })` already takes a `lastName: string`. Today the modal passes `baseAuthor = form.primaryAuthorLast.trim()`. With the new shape, the citekey derivation is **unchanged** — it always uses the first author's last name. 

### Vault indexer

`projectFor(paper)` (line 268) currently builds `authorsText` from `paper.authors[].lastName,firstName`. With the new shape, the `authors` field is already a string list of last names; the indexer just joins them with commas. `IndexedPaper.authorsText` becomes the comma-joined last-name list. Fuse search still works (matches against last names, which is what the user wants for "find all papers by Author X").

### Search-filters

`SearchFilters.authors?: string[]` (line 37 of `vault-indexer.ts`) currently matches `item.authorsText` (a `lastName, firstName` joined string). After this change, `authorsText` is just last names — so the filter still matches (last-name match is a strict subset of the previous match). No regression.

### Surface

- Modified: [`src/types/literature.ts`](../../src/types/literature.ts) — `Paper.authors: string[]`; add `Paper.authorFirstNames?: string[]`. `Author` interface kept for internal form-state use; export a new `AuthorLastName = string` alias for clarity.
- Modified: [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — `PaperManualInput.authors: string[]`; `toFrontmatter` writes the new shape; `frontmatterToPaper` parses the new shape (and tolerates the old). `papersEqual` compares `authors` as string arrays; `authorsEqual` helper becomes a join-and-compare (or stays an array-equal if the parallel `authorFirstNames` is not stored).
- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) — `submit()` constructs `lastNames` and `firstNames` arrays, passes them to `createManual`. No `buildAuthors` change.
- Modified: [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) — `projectFor` joins `paper.authors` (now `string[]`) directly into `authorsText`.
- Not modified: `composeCitekey` (input shape unchanged), `CitekeyGenerator`, `format-date.ts`, `template.ts`, settings tab.

### Backward compat for the YAML

Existing paper notes with the object form keep working — the reader handles it. The next save migrates the file to the new shape (we just write whatever the in-memory `Paper` has, which is already the new shape because we read it through the compat path).

---

## Sidebar search focus — shipped fix (2.8.Sidebar)

The user reports: "after one letter is typed, it seems to de-select the searchbar". Investigation showed it was **our** bug. Looking at the old code ([`projects-sidebar-view.ts:218-234`](../../src/ui/views/projects-sidebar-view.ts)):

- We created the input with `createEl('input', { type: 'search', ... })`.
- We `addEventListener('input', ...)` and on each input event we called `this.render()` after an 80 ms debounce.
- `render()` did `this.contentEl.empty()` then re-created the children.

**This was the bug.** Each re-render blew away the input element and created a new one. The new element had the same value, but the *focus* and the *caret position* were lost after the first input event fired. After 80 ms the new input was created; on the very next keystroke the same thing happened — the user typed a letter, the input event fired, after 80 ms the element was replaced, the new element was unfocused, the user had to click again.

The fix was to **stop re-rendering the whole view on every keystroke**. Two options were considered:

1. **Don't re-render the whole view.** Just re-render the **paper list** (the children below the header). The header (with the search input) stays mounted.
2. **Restore focus after re-render.** After `this.contentEl.empty()` and re-creating, find the search input by ID / selector and `focus()` it, then set the caret to the end. This is hacky and option 1 is much better.

**Shipped: option 1.** The header is a fixed shape; only the list of papers below it changes. `render()` was refactored to:

- `renderHeader()` — called once on `onOpen` and on project switch. Mounts the search input inside a persistent header div that is never re-rendered.
- `renderList()` — called on every state change (search input, paper upsert, status flip, project switch). Re-renders the paper rows only. Does **not** touch the header.
- The search input's `input` listener calls only `renderList()` after the debounce, so the input element is never replaced mid-typing.

The refactor touched `renderHeader`, `renderList`, the `searchInput` `input` listener, the `onOpen` listener wiring, and the four event-bus subscriptions (`paperImported`, `paperStatusChanged`, `projectChanged`, `indexUpdated`) — each calls only `renderList()` now. Total LoC: ~30 lines reshuffled, no new types, no new services. The user's hunch that "it could be Obsidian" was wrong — it was our code.

### Surface (shipped)

- Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — split `render()` into `renderHeader()` + `renderList()`. `onOpen` calls both. The `paperImported` / `paperStatusChanged` / `projectChanged` / `indexUpdated` listeners call only `renderList()`. The search input event listener calls only `renderList()`. The search input itself lives inside a persistent header div which is never re-rendered after `onOpen`.

### Verification

- Type "a" in the search box — the input keeps focus.
- Type "ab" — input keeps focus, list filters.
- Switch project — input is recreated (this is correct; new project = new filter).
- `paperImported` event fires — list updates, input keeps focus.

---

## 2.8.1 — Attached-PDF row squish fix (follow-up, shipped 2026-07-21, **two iterations** before it landed)

> **TL;DR.** The fix was wired twice. Shipped layout mounts help / drop zone
> / path-info on **`root`** (modal content, `display: block`) as full-width
> siblings below the Setting row. The first attempt mounted them on
> `pdfSetting.settingEl` — flex row, not block — and made the row worse
> (name column clipped, drop zone shrunk to a sliver, help text wedged into
> the right-hand column). Section 2.8.1 prescribes the corrected layout.
>
> If you need to touch this row in a future sub-pass, **read the iteration
> log in §"Today (and the fix)" below first** — the flex-vs-block trap is
> the load-bearing piece of this fix.

### Why this sub-pass exists

After deploying 2.8 and opening `PaperImportModal` to do the manual smoke, the
"Attached PDF" setting row was visually squished:

- The row's right-hand **control column** is the only place Obsidian's
  `Setting` helper reserves for short widgets (a button, a text input, a
  dropdown). It's intentionally narrow — about half the modal width, minus the
  setting's name column on the left.
- The 2.8 modal had attached a long multi-sentence help string to that row
  via `Setting.setDesc(...)`. The text wrapped to **three lines** in the
  narrow control column, and the **"Attach PDF…" button** was shoehorned into
  the same column.
- The drop zone (`Drag and drop PDF here`) had been appended to
  `pdfSetting.controlEl` — same cramped slot. So the button, the wrapped help
  text, and the drop zone were all stacked vertically inside a column sized
  for a button.

Result: 4 lines of grey text + a button + a 1-line drop zone crammed into a
~280-px column. The drop zone looked almost smushed.

### Today (and the fix)

Two changes, scoped to the PDF row only. Nothing else in the modal moves.

> **Iteration log (preserved on purpose).** The 2.8.1 patch was rewired twice
> before shipping. Keeping the trail so the next person who reaches for
> `pdfSetting.settingEl` knows it's a flex row and not a block container.
>
> 1. **First cut (broken).** Help text + drop zone + path-info were appended
>    to `pdfSetting.settingEl`. This made it **worse** — Obsidian's
>    `.setting-item` is `display: flex; flex-direction: row`, so all three
>    new children flowed left-to-right inline alongside the name column and
>    the button. Drop-zone shrank to a ~120 px sliver in the middle of the
>    row, name column was clipped, and a long vertical column of help text
>    ran down the right. Eyeballed this and re-did the patch.
> 2. **Second cut (shipped).** Mount each of the three blocks on **`root`**
>    (the modal contents element, which is `display: block`) and let them
>    stack as full-width siblings BELOW the Setting row. The Setting itself
>    stays a thin name + button row.

1. **Drop the long desc from the Setting row.** `Setting.setDesc(...)` is
   no longer called for "Attached PDF". The long help copy is
   `root.createDiv({ cls: 'researchvault-pdf-help' })` and rendered as a
   full-width block underneath the row.
2. **Move the drop zone + the path-info line out of the control column.**
   Both now hang off **`root`** too — as siblings of the help block rather
   than children of the Setting. This is what gives them full modal width.

Net layout under the modal's "Attached PDF" row, top-to-bottom:

```
[Attached PDF  (name column) ]   [Attach PDF…  (control column, button only)]
[ help text — long form, max-width: 480px, capped                    ]
[  Drag and drop PDF here  (full-width drop zone, dashed border)      ]
[ Linked PDF: <path>  or  PDFs will be copied to: <pdfs/>  (info)      ]
```

The button stays in the narrow control column where it belongs. The help
text, drop zone, and path-info each get the full modal body width.

### Surface

- **Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts)** —
  `renderMetadataRows` PDF block: drop the `setDesc(...)` call entirely;
  build the row as just `name + button`; mount the long help text, the
  drop zone, and `pdfInfoEl` as `root.createDiv({ cls: '...' })` calls
  *immediately below* the `new Setting(...)` line so they all sit on the
  modal content root in source order. Because `root` (`modal.contentEl`)
  is `display: block`, the three siblings stack vertically at full modal
  width even though the Setting row above them is a flex row. The click
  handler, the drag/drop handler, the `attachPdfFrom` wiring, and the
  `refreshPdfInfo` cache node are unchanged. Only the tree shape moved.
- **Modified: [`styles.css`](../../styles.css)** —
  - New `.researchvault-pdf-help` rule: `display: block` +
    `max-width: 480px` + `margin: 6px 0 8px` +
    `font-size: 0.85em` + `line-height: 1.4` + muted colour. The cap on
    `max-width` is the load-bearing piece — it ensures the help text never
    pushes the wrapping wider than the modal even at large window widths.
  - Retuned the existing `.researchvault-pdf-drop-zone` `margin-top` from
    `4px` to `0` (it no longer sits next to the control column, so it
    doesn't need that spacer; the help's `margin-bottom: 8px` handles the
    gap above it).
  - `.researchvault-pdf-path-info` keeps its `margin-top: 6px`. No
    `margin-bottom` — the next default Settings row's own top spacing
    handles separation.

### Verification gates (all green)

- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0; `main.js` is **88,190 B** (86.1 KB; +2,030 B
  from 2.8 — delta covers the new `root.createDiv(...)` calls, the small
  CSS block, the layout-shape comment block explaining the flex-vs-block
  trap, and helper-name adjustments). Dropping the unused `pdfSetting`
  binding in the second cut trimmed 38 B back off the first cut.
- `npm run deploy` — exit 0; replaced bundle in the test vault under
  `<researchvault-plugin-dir>/main.js`.

### What we do **not** change

- No new architectural decisions. 2.8.1 is a UI-tree-shape fix only — no
  schema, no type, no event, no behavioural change. Existing `D22`–`D28`
  decisions are untouched.
- No change to the drop-zone behaviour. Same drag/drop handlers, same
  file types accepted, same copy-into-`pdfs/` path. The only change is
  where in the DOM the render-attached elements sit.
- No change to the help-text copy. Only its mount point.
- No new click-through step in 2.8.smoke beyond "open the modal, confirm
  the row layout reads cleanly". The 6 existing 2.8.smoke steps cover the
  functional behaviour; 2.8.1 just needs an eyeball check.

### Files touched / added

- Modified: [`plans/ui-polish-2.8-research.md`](./ui-polish-2.8-research.md)
  (this section), [`plans/plan.md`](./plan.md) (in-progress row + dated
  entry + §14 row for 2.8.1).

### Looking ahead

- **2.8.smoke** is now a combined 2.8 + 2.8.1 check — running the 6
  functional steps plus step 7 ("open the modal, confirm the PDF row
  reads without squish") against the 2.8.1 build. Closes both sub-passes
  in one click-through.
- **2.9** — sidebar filter overhaul — still parked behind 2.8.smoke.

## Order of changes inside 2.8

The five changes are independent. Recommended order:

1. **2.8.A** Modal width — UI only, lowest risk, fast win.
2. **2.8.B** Drop-zone copy — UI only, one line.
3. **2.8.Sidebar** Sidebar render refactor (search-focus fix) — structural, do it before any other sidebar change.
4. **2.8.C** Date format on paper notes — display-only format change. Read backward-compat is free.
5. **2.8.D** `dateModified` re-stamp on body edit — touches the live-sync path; do it before 2.8.E so the new date format ships first and the re-stamp uses it from day one.
6. **2.8.E** Authors as string list — last because it ripples through 5 files and has the biggest blast radius (legacy YAML, modal submit, indexer, type). Doing it last means the type / service surface is otherwise stable.

In practice these can all ship in one PR; the order is just the order to write the diffs in.

---

## Verification gates

- `npm run build` / `lint` / `tsc --noEmit` all `exit 0`.
- New unit-test fixtures (when 5.x lands): `format-date.ts` round-trips both old and new formats through `fromFrontmatterDate`. `papersEqual` is unchanged in behaviour.
- Manual click-through (2.8.smoke):
  1. Open `PaperImportModal` — confirm it's wider and the drop zone fits the new copy.
  2. Open `QuoteCaptureModal` — confirm it matches the new width.
  3. Create a paper with full names ("Ashish Vaswani"). Open the note, confirm the YAML is `- Vaswani` (last name only) and the rendered view is a clean list. (Re-save once to migrate the legacy form if you're testing against an old paper.)
  4. Open the paper note, type a character, save. Confirm `dateModified` in the frontmatter is `YYYY-MM-DD | HH:MM` and matches the wall clock.
  5. Type "a" in the sidebar search. Confirm the input keeps focus.

---

## Bundle cost

No new dependencies. Total new code: ~120 LoC pre-bundling (modal width util is ~10 LoC, date format change is ~20 LoC of utils + 2 call sites, authors refactor is ~50 LoC across 5 files, sidebar render split is ~30 LoC). Expected `main.js` delta: **+0.5 KB or less** (the YAML writer is the same length, the format string is the same length, the indexer code is shorter).

---

## Open questions

1. **First names — keep or drop entirely?** I'm proposing we keep them in a parallel `authorFirstNames?` array (off the disk for the 90 % case where the user only typed last names) so the modal's "type a full name" flow still works. If you want a stricter "last names only" experience, we can drop the parallel array and have the modal's "Additional authors" field require `lastname, lastname, ...` (no first-name heuristic). The first option is more user-friendly; the second is simpler. My recommendation: keep the parallel array, write it only when non-empty, and treat it as an implementation detail.
2. **Sidebar header refactor — does "split into renderHeader + renderList" sound right, or do you want a different shape (e.g. never re-render the input, just keep its value in `this.currentQuery` and let the input element persist across renders)?** The split-render approach is the standard Obsidian community-plugin pattern; the never-re-render approach is faster but breaks the "switch project recreates the input" expectation.
3. **`dateModified` re-stamp — what about the staleness derivation in the sidebar?** Today "Needs action" treats `paper.dateModified` as the proxy for "when was this last touched". With this change, every body edit re-stamps, which means the staleness clock resets on every keystroke. Is that what you want? My read of the user feedback is yes ("ideally that timestamp updates each time we add or even subtract something"), but the side-effect on "Needs action" is worth flagging. If you want a *separate* "last body edit" timestamp that doesn't reset staleness, we can add `dateBodyModified?: number` in a follow-up.

## Decisions (signed off 2026-07-14)

1. **First names** - keep them in a parallel optional `authorFirstNames?` array. On disk: `authors: [Vaswani, Shazeer]` for the common case where no first name was typed; `authors: [Vaswani, Shazeer]` plus `authorFirstNames: [Ashish, Noam]` when the user typed a full name in the modal. Modal flow is unchanged; the indexer can use the full "Vaswani, Ashish" text for fuzzy matching.
2. **Sidebar refactor** - split `render()` into `renderHeader()` (called once per `onOpen` and on project switch) plus `renderList()` (called on every state change). Standard Obsidian community-plugin pattern. About 30 LoC.
3. **Scope of 2.8** - polish plus the search-quality bug fix only (Fuse `minMatchCharLength: 1`, `threshold: 0.4`). The full filter overhaul (status / priority / year / hasPdf / hasNotes filter chip row, author autocomplete from project authors, saved filter state) is deferred to sub-pass **2.9** to be added to `plans/plan.md` section 14.
4. **`dateModified` re-stamp** - accept it. The "Needs action" group is reworked to use a different proxy for "needs attention" (status alone, or `dateAdded`, or a non-body-sensitive threshold) so an actively-annotated paper no longer silently disappears from "Needs action". A separate `dateBodyModified?` can be added in a follow-up if needed.
5. **Sidebar focus bug is real and ours** - rolling the focus fix into 2.8.Sidebar. Caused by `render()` calling `contentEl.empty()` and re-creating the search input on every input event after 80 ms debounce.
6. **Search-quality bug** - Fuse `minMatchCharLength: 2` and `threshold: 0.35` together cause 1-character queries to return nothing and partial-prefix queries (e.g. `vaswan` instead of `vaswani`) to miss. Rolling the config change into 2.8.Sidebar.

## Deferred to 2.9

- Sidebar filter chip row (status, priority, year, hasPdf, hasNotes, custom fields).
- Author autocomplete popover built from the project's `paper.authors` set (much simpler after 2.8.E ships because the field is now a flat string list).
- Saved filter state per project (optional).
- Possibly: structured query syntax (`status:reading author:Vaswani`).

2.9 will need its own phase plan in section 14 after 2.8 ships.
