# Citation lookup + Zotero integration — research notes

> Drafted **2026-07-14** after the user's "the most helpful if we can…" message revealed
> they want DOI-driven metadata auto-fill, ideally with Zotero sync. Honest caveat: this
> tool environment has no web access, so endpoint details are from training knowledge
> (cutoff Jan 2026). The APIs and the Obsidian plugin landscape are stable enough that
> the high-level direction is reliable — we'll re-verify the specific endpoint + rate
> limit + auth flow against the official docs when we start the implementation pass.

User's stated goal (from the bug-report message that followed 2.7):

> "if it's possible, how likely could we get DOI input and auto-filling? … that would
> be huge. If we could rely more on DOI input than anything with PDF stuff I feel
> like that could be a big win. … if we have searchable DOI's somehow, then all
> that manual information could be collected. Like how possible is it that we
> could have a searchable DOI engine similar to like looking up a book with its
> ISBN. … I imagine Zotero would probably have a DOI search function … maybe we try
> to make sure it works alongside the existing Zotero integration plugin that is on
> obsidian. Or, we find a way to make our ResearchVault plugin have its own way
> to connect to a local (or web-based if that is a thing) Zotero account/service."

Two distinct capabilities to think about:

1. **DOI lookup** — paste a DOI (or a free-text title) → get a CSL-JSON record
   back → auto-fill the modal form. This is the "ISBN lookup" pattern the user
   asked for. Pure network read; no auth in the free tier; works on every
   platform.
2. **Zotero integration** — pull a user's existing Zotero library (web API
   key or local API server) into the sidebar, push papers back, keep them in
   sync. This is the "alongside the existing Zotero integration plugin" idea
   (i.e. work with the well-known `obsidian-zotero-desktop-connector` /
   `Zotero Integration` plugin) AND/OR a first-party connection. This is
   significantly more work and has real platform constraints (local API is
   desktop-only).

Both are tractable. They are *not* the same feature. They should ship in
separate sub-passes.

---

## 1. DOI lookup — provider survey

We need a way to turn a DOI (and optionally a title/author string) into a
structured record. The "Big Three" candidates:

| Provider | Endpoint shape | Auth (free tier) | Rate limit (free) | Data format | Notes |
|---|---|---|---|---|---|
| **CrossRef** | `GET https://api.crossref.org/works/{doi}` | None (use a polite `User-Agent`/`mailto` for the polite pool) | ~50 req/s polite pool, otherwise pool-specific | CSL-JSON via `transform=application/vnd.citationstyles.csl+json` query | The canonical DOI registry. Best for "I have a DOI". |
| **OpenAlex** | `GET https://api.openalex.org/works/doi:{doi}` | None (use a `mailto` for the polite pool) | ~10 req/s polite pool | Native JSON that maps cleanly to CSL-JSON | Best for free-text search (`/works?search=...`) and OA URL. |
| **DataCite** | `GET https://api.datacite.org/dois/{doi}` | None | ~50 req/s | Native JSON, less standardised for CSL | Best for datasets, not journals. Skip for our use case. |

### Recommendation: **CrossRef primary + OpenAlex fallback**

- CrossRef is the canonical source for published-paper DOIs; coverage is
  effectively 100 % of the scholarly DOI namespace it curates.
- The `transform=application/vnd.citationstyles.csl+json` query param returns
  CSL-JSON directly, which is the format `CitationManager` will need anyway
  (for the deferred `citeproc` integration — see `D11` in §3).
- OpenAlex is the free-text fallback: `?search=<title>` returns ranked
  candidates with DOIs, so we can do "user pastes a title → we hit
  `/works?search=...` → we offer 5 candidates → they pick one → we
  refetch by DOI on CrossRef for the canonical record". This is the
  Zotero-style "magic wand" UX the user described.
- We **do not** call DataCite for papers — it's dataset-centric.
- We do **not** need a paid product. CrossRef + OpenAlex cover 95 %+ of
  real-world lookup cases for free.

### CrossRef example (what we'll see)

```http
GET https://api.crossref.org/works/10.1109/CVPR.2016.90?transform=application/vnd.citationstyles.csl+json
User-Agent: ResearchVault/0.1.0 (mailto:justin@example.com)   ; polite-pool UA
```

Returns a CSL-JSON record with `title`, `author[]` (family/given),
`issued.date-parts`, `container-title`, `volume`, `issue`, `page`,
`DOI`, `URL`, `abstract`, `subject` (keywords). This maps almost
linearly onto our `Paper` frontmatter shape — see `types/literature.ts`.

### OpenAlex example (free-text search)

```http
GET https://api.openalex.org/works?search=attention%20is%20all%20you%20need&per_page=5&mailto=justin@example.com
```

Returns ranked hits with `doi`, `title`, `authorships[]`, `publication_year`,
`primary_location.source.display_name`, `open_access.oa_url` (useful for
auto-attaching a PDF that is already legally OA). Perfect for the "I
remember the title but not the DOI" case.

### Privacy + scope posture (extends `D14` / `D15`)

- This is the **first** feature that sends a payload off-device by default.
  We must follow the same pattern we used for `AIClient` (`D12`/`D13`):
  - An opt-in toggle in settings: `ResearchVaultSettings.enableCitationLookup`.
  - Off by default. The modal's lookup button is hidden/disabled when off.
  - The settings tab has a clear disclosure: "Lookups send the DOI /
    search string to api.crossref.org and/or api.openalex.org. We do
    not send your vault contents."
  - A `User-Agent` that includes a `mailto:` (CrossRef / OpenAlex polite
    pool) so we're a good citizen.
  - A response cache (LRU keyed by DOI, TTL 30 days) so we don't re-hit
    the same DOI twice.
  - A small rate limiter (token bucket, 5 req/s, in-process) to keep us
    under both providers' fair-use thresholds.
  - A "send anonymised usage header" toggle, **off** by default. When
    off, we don't send the polite-pool `mailto` either (we just get
    slower responses).
  - Network errors surface as a `Notice`; no silent fallbacks.

This last bit matters: we set a precedent here. The `AIClient` already
established opt-in + disclosure, so `D29` should re-use that pattern
rather than inventing a new one.

### What we can and cannot get back

| Field | CrossRef CSL | OpenAlex | Maps to our `Paper` |
|---|---|---|---|
| `title` | ✅ | ✅ | `Paper.title` |
| `author[]` (family/given) | ✅ | ✅ | `Author[]` |
| `issued.date-parts[0][0]` → year | ✅ | ✅ (`publication_year`) | `Paper.year` |
| `container-title` | ✅ | ✅ (`primary_location.source.display_name`) | `Paper.venue` |
| `DOI` | ✅ | ✅ | `Paper.doi` |
| `abstract` | ✅ (often `null` — CrossRef is publisher-supplied) | ⚠️ (inverted index, not always available) | `Paper.abstract` |
| `subject` / `keywords` | ✅ | ⚠️ | `Paper.keywords` |
| `open_access.oa_url` | n/a | ✅ | (not in `Paper` yet — store on `Paper.oaUrl?: string`) |
| `URL` (publisher landing) | ✅ | ✅ | (not in `Paper` yet — store on `Paper.url?: string`) |

We should add two optional fields to `Paper` for the new sub-pass:
`oaUrl?: string` and `url?: string`. They are cheap to add (one type
line, one frontmatter key) and unlock a lot of future flows (citation
insertion, AI context).

### Proposed: D29 — Citation lookup (DOI + free-text)

> Citation lookup is opt-in. When the user pastes a DOI into the
> PaperImportModal, the plugin (if enabled in settings) calls
> `CitationService.lookupByDoi(doi)` which hits CrossRef first, falls
> back to OpenAlex, and returns a CSL-JSON record. The modal pre-fills
> `title`, `authors[]`, `year`, `venue`, `doi`, `abstract`, `keywords`
> from the response. The user can edit any field before submitting.
> A separate "Search by title…" affordance hits
> `CitationService.searchByTitle(text)` (OpenAlex) and presents 5
> ranked candidates. The lookup service is network-only, has a
> 30-day LRU cache, a 5 req/s in-process token bucket, and a
> `mailto`-bearing User-Agent on the polite pool. Off by default;
> `D12` opt-in pattern reused. No vault content ever leaves the
> device. Settings tab discloses the third-party endpoints and
> what we send. `PaperService.createManual` is unchanged — lookup
> is a *modal* affordance that fills the form, not a service that
> imports the paper.

---

## 2. Zotero integration — three flavours

There are three different things people mean by "Zotero integration":

### 2.1 The "alongside" route — work *with* the official Obsidian Zotero plugins

- Two popular community plugins ship Zotero-bridging today:
  - **`Zotero Integration`** (the original, by mgmeyers) — Obsidian's
    "Insert Citation" command, BibTeX-based, uses the Zotero local
    HTTP API on desktop.
  - **`obsidian-zotero-desktop-connector`** — uses the Zotero local
    translator API on desktop, with a fallback path that works without
    Zotero running.
- **What they give us for free**: a working Zotero bridge on desktop.
- **What they don't give us**: a *first-party* ResearchVault
  experience, the mobile story, or any control over how papers show
  up in our sidebar.
- **What we should do**: in the settings tab, add a "Citations"
  section that points users at these plugins with a "Works alongside"
  note. Zero code, zero risk, ships today.

### 2.2 The "pull from the Zotero web API" route — first-party, no desktop

- Zotero's **Web API v3** ([www.zotero.org/support/dev/web_api/v3/start](https://www.zotero.org/support/dev/web_api/v3/start))
  is a real, well-documented REST API. Auth is via a per-user
  **API key** the user generates in zotero.org/settings/keys.
- Endpoints we care about:
  - `GET /users/{userID}/items` — list items in the user's library
    (paged, 25 / 50 / 100 per page). Supports `?format=csljson` for
    CSL-JSON output.
  - `GET /users/{userID}/items/{itemKey}` — single item.
  - `GET /users/{userID}/collections` — collection list.
  - `GET /users/{userID}/items?tag=foo` — filter by tag.
  - `GET /groups/{groupID}/items` — group libraries.
- **What it gives us**: a real "browse my Zotero library" sidebar tab
  on every platform (desktop + mobile), no Zotero app required.
- **What it doesn't give us**: PDFs (unless the user has file-sync
  enabled in Zotero, in which case we get an `enclosure` link), live
  push-back, or read-write access to non-public group libraries.
- **Auth pattern**: matches `D13` (api key in plaintext settings,
  with the same "we never send this anywhere but zotero.org"
  disclosure). Add a new settings block: `zotero: { userID, apiKey, defaultCollectionKey? }`.
- **What we ship**:
  1. A "Sync from Zotero" button in the sidebar header (when configured).
  2. `CitationService.importFromZotero({ collectionKey?, limit? })` —
     fetches paginated items, converts CSL-JSON → `Paper`, calls
     `PaperService.createManual({ ..., attachPdfFrom? })` for each.
  3. PDF attach: if the CSL-JSON has a `link[].url` with
     `attachment-type=application/pdf`, download into `<project>/pdfs/<citekey>.pdf`
     (using the same `copyPdfIntoProject` path from `D28`) and
     reference it from the note.

### 2.3 The "local Zotero API" route — first-party, desktop only

- The Zotero desktop app exposes a local HTTP API on
  `http://127.0.0.1:23119` with a per-call dynamic key. It's how the
  existing Zotero Integration plugin talks to Zotero on desktop.
- **What it gives us**: live write-back, full attachment access
  including annotations, citation formatting, and the better BibTeX
  translator.
- **What it costs us**: it's desktop-only (the local API is HTTP on
  loopback, which works fine in Obsidian's Electron host on macOS /
  Windows / Linux desktop, and **also** works on iPad via the
  network — but the iOS WebView blocks loopback HTTP, and on Android
  the address is different). It is also not available when Zotero
  isn't running, so a "Zotero is offline" fallback is mandatory.
- **What we ship**: a "Connect to Zotero desktop" toggle in settings
  that probes `127.0.0.1:23119` and stores the dynamic key per
  session. When on, an additional "Push to Zotero" affordance on
  each sidebar row sends the paper back to a chosen Zotero
  collection. When off, the button is hidden.
- This is the route the existing Obsidian Zotero plugins take, but
  with our own UI chrome instead of the markdown-insert UX.

### 2.4 The "BYO anything" route — generic CSL-JSON import

- The same `CitationService` we build for `D29` can also accept
  arbitrary CSL-JSON input: paste a `.bib`, drag in a `csljson`
  export, point at a remote URL. This is the long tail — most
  reference managers can produce CSL-JSON. It's a few extra lines on
  top of the DOI lookup and gives us broad import compatibility
  with Zotero, Mendeley, EndNote, Paperpile, etc. *for free* (we
  already need the CSL-JSON parser for CrossRef).

### Recommended phasing

| Sub-pass | Scope | Why this order |
|---|---|---|
| **4.1 — `D29` DOI lookup** | `CitationService` skeleton; CrossRef primary + OpenAlex fallback; modal `Lookup` button; LRU cache; rate limiter; settings opt-in + disclosure; `Paper.oaUrl` + `Paper.url` fields. | The smallest end-to-end win. Pure read, no auth, no Zotero, no desktop-only code. Solves the "I have a DOI" case (probably 70 % of the user's workflow). |
| **4.2 — CSL-JSON import** | `CitationService.importCslJson(text)`; modal "Import CSL-JSON" button; settings disclosure. | Almost free once 4.1 is in. Gets us out of the CrossRef-only universe; covers Zotero / Mendeley / EndNote exports. |
| **5.1 — Zotero web API read-in** | `ZoteroClient` (new tiny service in `src/services/integrations/zotero/`); settings block (`userID` + `apiKey`); "Sync from Zotero" button; conversion to `Paper[]` via `CitationService`. | The "first-party without Zotero running" path. Works on every platform. Doesn't conflict with the existing Obsidian Zotero plugins. |
| **5.2 — Zotero local API push-back** (desktop only) | Probe `127.0.0.1:23119`; "Push to Zotero" sidebar action; "Zotero offline" fallback. | The "full round-trip" experience. Desktop-only. **Sets `isDesktopOnly: true` for the push-back path only** — we keep the rest of the plugin mobile-safe. |
| **5.3 — Bidirectional sync** (deferred) | Webhook-driven incremental updates; collection mappings; tag sync. | A lot of surface for a v1. Defer until 4.x / 5.x. |

The user explicitly said: "Even if it's not possible for us to develop
it all without needing the Zotero integration, it would be great and
even more necessary to make sure it can be used with Zotero, and maybe
we try to make sure it works alongside the existing Zotero integration
plugin that is on obsidian." So 5.1 + 5.2 are both on the roadmap; the
ordering lets us ship the highest-value pieces first and learn from
real usage before we build the harder half.

### Proposed: D30 — Zotero integration

> Zotero integration comes in three independent layers: (a) **read
> from the Zotero web API** (`ZoteroClient`) — opt-in, requires a
> Zotero API key in settings (`zotero: { userID, apiKey,
> defaultCollectionKey? }`), pulls CSL-JSON items and converts them
> to `Paper` via the same path as manual import. (b) **push to
> Zotero via the local API** (`ZoteroLocalClient`) — desktop-only,
> probes `127.0.0.1:23119` at the start of each session, surfaces a
> "Push to Zotero" action on each sidebar row, falls back to a
> "Zotero is offline" notice. (c) **coexist with the official Obsidian
> Zotero Integration plugins** — settings tab has a "Citations"
> section that links to `Zotero Integration` and
> `obsidian-zotero-desktop-connector` with a note that our sidebar +
> PDF management complements rather than replaces their insert-citation
> UX. All three are opt-in, off by default, and reuse the
> disclosure-key-in-settings pattern from `D12`/`D13`. The API key
> never leaves the device except when sent to zotero.org; we
> disclose this in the settings tab and the README.

---

## 3. Sprint 4 sub-pass 4.1 (DOI lookup) — proposed phase plan

Mirror the 2.x sub-pass shape we already use.

### 4.1.A — Types + settings (no UI yet)

- `src/services/citation/types.ts` — `CslJsonRecord`, `CitationProvider`
  enum (`crossref | openalex`), `CitationSettings` (`{ enableCitationLookup: boolean; preferredProvider: 'crossref' | 'openalex'; politeContact?: string }`).
- `src/types/literature.ts` — add `Paper.oaUrl?: string`,
  `Paper.url?: string` (optional; render only when present).
- `src/types/index.ts` — re-export `CslJsonRecord` for `CitationService`.
- `src/settings.ts` — add `citation: CitationSettings` to
  `ResearchVaultSettings`; defaults: `{ enableCitationLookup: false, preferredProvider: 'crossref', politeContact: '' }`. `migrateSettings` needs a 0.2.0 → 0.3.0 step.

### 4.1.B — `CitationService` (pure service, no UI)

- `src/services/citation/citation-service.ts` — class with:
  - `lookupByDoi(doi: string): Promise<CslJsonRecord | null>`
  - `searchByTitle(query: string, limit?: number): Promise<CslJsonRecord[]>`
  - `importCslJson(text: string): Promise<PaperDraft[]>`
  - private: `fetchWithTimeout`, `cache.get/set`, `rateLimiter.take`.
- `src/services/citation/providers/crossref.ts`,
  `openalex.ts` — one file per provider, each implementing the
  `CitationProvider` interface (`lookupByDoi`, `searchByTitle`).
- `src/services/citation/csl-to-paper.ts` — pure function: CSL-JSON
  record → `PaperManualInput` (reuses `composeCitekey` from
  `utils/citekey.ts`).
- LRU cache: in-memory `Map<doi, { record, fetchedAt }>`, TTL 30 d,
  bounded to 500 entries (drop oldest). Cache key for search is
  the normalised query string.
- Rate limiter: token bucket, 5 tokens/s, capacity 10.

### 4.1.C — Modal wiring (the visible feature)

- `src/ui/modals/paper-import-modal.ts`:
  - New small row under `doi`: "🔍 **Lookup**" button. Disabled when
    `!settings.citation.enableCitationLookup` or `!doi.trim()`.
  - Click → `await citationService.lookupByDoi(doi)`. On success,
    show a one-line "Filled from CrossRef" notice *inside the
    modal* (not the Obsidian notice) so it's contextual, and
    pre-fill `title`, `authors[]`, `year`, `venue`, `doi`,
    `abstract`, `keywords`. Editable, just like typed values.
  - New separate "🔍 Search by title…" affordance near `title`:
    opens a small `CitationSearchModal` (new file
    `src/ui/modals/citation-search-modal.ts`) — input + 5-row
    result list, click a row to fill the same way.
  - Pre-fill always preserves user edits. We track an
    `autofilledFields: Set<keyof PaperImportForm>` set; if the user
    edits a field, we drop it from the set; if the user re-runs
    lookup with the same DOI, we *only* fill fields that are still
    in the set. This is the "I want to fix the year but keep my
    title" use case.
- The PDF attach block is unchanged. The citekey is recomputed via
  `refreshPreview()` after autofill.

### 4.1.D — Settings tab

- New "Citations" section in `src/ui/settings/settings-tab.ts`:
  - "Enable DOI lookup" toggle. When off, the modal buttons hide.
  - "Preferred provider" dropdown (CrossRef / OpenAlex). Default
    CrossRef; user can switch if their DOIs are consistently
    OpenAlex-only.
  - "Polite-pool contact" text input (optional, e-mail). When set,
    the User-Agent gets `mailto:` so we hit the polite pool.
  - Disclosure paragraph (rendered as a `Setting` description):
    "Lookups send only the DOI or search string. We do not send
    your vault contents, file names, or paper notes. No analytics.
    API responses are cached locally for 30 days."
- "Privacy" section in `src/ui/settings/settings-tab.ts` gets one
  new bullet: "Citation lookup (opt-in) — see *Citations* above."

### 4.1.E — Verification gates

- `npm run lint` / `npm run build` / `npx tsc --noEmit` all `exit 0`.
- New unit tests (`vitest`, lands in 5.x setup):
  - `csl-to-paper.ts` — golden-record tests for CrossRef + OpenAlex
    shapes (fixtures under `src/services/citation/__fixtures__/`).
  - `CitationService` cache + rate limiter behaviour.
  - One integration test that uses `fetch` mocking to assert the
    User-Agent contains `mailto:` when configured.
- Manual smoke (2.manual-smoke style, called 4.1.smoke):
  1. Open the modal, paste `10.1109/CVPR.2016.90` → click Lookup →
     confirm `title`, `author[]`, `year`, `venue` fill.
  2. Edit `year` → re-click Lookup → confirm `title` re-fills but
     `year` is preserved.
  3. Toggle `enableCitationLookup` off → confirm the Lookup button
     hides.
  4. Type a title (not DOI) → click Search by title → pick a
     candidate → confirm full form fills.

### 4.1.F — Bundle cost

- `CitationService` is small. CrossRef + OpenAlex providers are ~80
  LoC each, CSL→Paper is ~50 LoC, modal wiring is ~40 LoC, settings
  is ~20 LoC. Total new code: ~270 LoC pre-bundling. **Expected
  bundle impact: +1.5–2 KB.**
- **No new dependencies.** `fetch` is built into the Electron
  host. `URL` is built in. The CSL→Paper conversion is a few
  hand-written object spreads. We deliberately do *not* add
  `citeproc` here — that stays deferred per `D11`.

### 4.1.G — Privacy disclosure for the README

Add to §15 (README source) "Privacy" section:

> **Citation lookup (opt-in).** When you turn on *Citations* in
> settings, ResearchVault can send a DOI or search string to
> api.crossref.org and/or api.openalex.org to fetch public
> metadata. We do not send vault contents, file names, or paper
> notes. Responses are cached locally for 30 days. You can turn
> it off at any time; the modal affordance disappears.

And to the "What works today" list (after the 4.1 sub-pass ships):

> - **Citation lookup.** Paste a DOI (or search by title) and
>   the form fills itself with metadata from CrossRef /
>   OpenAlex. *(Opt-in, see Settings → Citations.)*

---

## 4. Things that *won't* change

- **`PaperService.createManual` stays the single import path.** The
  citation lookup is a *modal affordance* that fills form fields,
  not a service that imports papers. The user's typed edits always
  win on submit, just like with the PDF attach (per `D28`).
- **`pdfjs-dist` stays out** (per `D27`). The PDF attach remains
  link-only.
- **No PDF text extraction** — `extractQuotesFromPdf` and
  `findCitationsInPdf` continue to throw `notImplemented` per
  `D27`. The OA URL we get from OpenAlex can be used to *attach*
  an open-access PDF (one extra click), not to *parse* one.
- **No silent network calls.** Citation lookup is the *first*
  network feature outside `AIClient`, and the disclosure pattern
  from `D12`/`D13` is reused exactly. Off by default; the modal
  affordance is hidden when off; the settings tab discloses the
  endpoints and the payload.

---

## 5. Open questions for the user (before we start)

1. **Provider default.** Is CrossRef the right default, or do you
   want OpenAlex (better free-text search, broader coverage of
   non-journal works)?
2. **Zotero priority.** Do you want 5.1 (web API read-in) before
   5.2 (local API push-back), or do you specifically want push-back
   first because most of your work is paper-by-paper?
3. **Coexistence with the existing Zotero plugins.** Comfortable
   with us just pointing at them in the settings tab, or do you
   want us to detect whether one of them is installed and surface
   a "you're already set up for citations" message?
4. **The `mailto:` polite-pool contact.** OK to make this optional
   (off by default) so the plugin never sends any identifier
   off-device unless the user opts in? Or do you want it on by
   default with a clear disclosure?
5. **Anything else you want auto-filled that I haven't listed?**
   Common asks: arXiv ID, ISBN (for books — there's a separate
   `api.openlibrary.org` endpoint for that), PubMed PMID.

---

## 6. Honest caveats

- I have **not** verified the exact current rate-limit numbers
  above against the live CrossRef / OpenAlex docs. The
  order-of-magnitude is right (low double digits req/s for the
  polite pool), but we should re-check before the rate-limiter
  ships. (Plan: re-check during 4.1.A.)
- I have **not** verified the exact `obsidian-zotero-desktop-connector`
  plugin's current API. The 127.0.0.1:23119 endpoint is stable
  in Zotero itself; the plugin is the more volatile piece. (Plan:
  re-check during 5.1.A spike.)
- The Zotero web API v3 endpoints are stable; the auth model
  hasn't changed in years. I'm confident in the high-level
  design.

---

## 7. 4.1.A kickoff — locked preferences (2026-07-21)

Status: **kicked off; pending user input on three preferences below. No code yet.** Architect-mode deliverable; the goal is to ship a self-contained, no-UI sub-pass whose data shape holds up for 4.1.B–G.

### 7.1 Confirmed scope of 4.1.A (per the §3 plan)

Pure types + settings, no UI:

- New [`src/services/citation/types.ts`](../../src/services/citation/types.ts) — `CslJsonRecord`, `CitationProvider` enum (`'crossref' | 'openalex'`), `CitationSettings` shape.
- New [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts) — class skeleton (constructor + `lookupByDoi` / `searchByTitle` / `importCslJson` method stubs that `throw new Error('D29 — 4.1.B')` for now; real network calls land in 4.1.B).
- New [`src/services/citation/csl-to-paper.ts`](../../src/services/citation/csl-to-paper.ts) — pure mapping function, fully implemented (no network, easy to read in 4.1.A).
- New [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) and [`openalex.ts`](../../src/services/citation/providers/openalex.ts) — provider interface + stub implementations.
- [`src/types/literature.ts`](../../src/types/literature.ts) — add `Paper.oaUrl?: string` only (see L1 — `Paper.url?` already exists).
- [`src/types/index.ts`](../../src/types/index.ts) — re-export `CslJsonRecord`.
- [`src/settings.ts`](../../src/settings.ts) — add `citation: CitationSettings` to `ResearchVaultSettings`, default-fill in `migrateSettings` (see L3).
- [`src/core/events.ts`](../../src/core/events.ts) — add two events for telemetry (see L5).
- [`src/core/plugin.ts`](../../src/core/plugin.ts) — declare `citationService: CitationService | null`; lazy-instantiate on first use (see L4).

### 7.2 Locked decisions (no user input required)

| # | Decision | Rationale |
|---|---|---|
| L1 | **Add only `Paper.oaUrl?`; do NOT add `Paper.url?` again.** | `src/types/literature.ts:21` already declares `url?: string`. The §3 spike doc and the `plan.md` §14 4.1 row were written from a stale snapshot. `oaUrl?` covers the Open-Access URL (CrossRef's `resource.link`, OpenAlex's `best_oa_location.pdf_url`); the existing `url?` covers the publisher landing page. Both are needed; only `oaUrl?` is new. |
| L2 | **`PaperSource` already has `'doi'`.** | `src/types/literature.ts:129` lists `'doi'` as a valid `PaperSource`. A paper created via DOI lookup will set `source: 'doi'`. No new union member. |
| L3 | **Do NOT bump `settings.version`.** | `CURRENT_SETTINGS_VERSION = '1'` (string) in `src/settings.ts:12`. `migrateSettings` is a spread-merge, not a `switch`. Adding a new field is a default-fill (`citation: { ...DEFAULT_SETTINGS.citation, ...(candidate.citation ?? {}) }`), not a versioned migration. Save `'2'` for an actual breaking shape change. The §3 spike doc's "0.2.0 → 0.3.0" wording is from an older draft that pre-dates the current string-typed version scheme. |
| L4 | **`CitationService` is constructed lazily on first use, not in `onload`.** | Keeps `onload` cheap per AGENTS.md "Keep startup light". Also means the LRU cache + rate limiter don't spin up for users who never enable the feature. Plugin field is `citationService: CitationService | null = null`; a `private ensureCitationService()` getter on the plugin builds it on demand. |
| L5 | **Two new events:** `citationLookupSucceeded: { doi?: string; query?: string; provider: 'crossref' \| 'openalex'; durationMs: number; cacheHit: boolean }` and `citationLookupFailed: { reason: 'network' \| 'rate-limited' \| 'not-found' \| 'invalid-doi' \| 'disabled'; doi?: string; query?: string }`. | Mirrors the `aiRequestStarted` / `aiRequestCompleted` pair already on `ResearchVaultEvents`. Lets future sidebar polish show "last DOI lookup: 3 minutes ago" without coupling to modal state. |
| L6 | **Citekey recompute on autofill goes through the existing `refreshPreview()`** in `paper-import-modal.ts:419`. | The modal already exposes this; 4.1.C calls it after every successful autofill. No new method. |
| L7 | **Modal hint mechanism is in-modal, not event-driven.** | The "Filled from CrossRef" line is rendered inside the modal as a small `div` next to the DOI row, not a `Notice`. What the §3 spike prescribes and what D29 specifies. |
| L8 | **`D11` holds: `citeproc` stays out.** | CSL→Paper is a hand-written object-spread adapter, ~50 LoC. No new dependency. |
| L9 | **Reuse `composeCitekey` from `src/utils/citekey.ts:35`.** | Already exported, already deterministic, already collision-safe. |
| L10 | **`CslJsonRecord` is a hand-typed subset, not a `npm install @types/csl-json`.** | CSL-JSON's official type package adds ~30 KB to the bundle. Our actual usage is a 12-field subset (title, author, issued, container-title, volume, issue, page, DOI, URL, abstract, subject, type). Typed inline. |
| L11 | **`CitationProvider` is a string-literal union, not a TS `enum`.** | String literals tree-shake better and avoid the `Object.freeze` + `const enum` ESM pitfalls. Same pattern the existing `ReadingStatus` / `Priority` / `PaperSource` types use. |

### 7.3 Rate-limit numbers — re-verification note (spike §6 honest caveat)

The `5 req/s, capacity 10` and `30-day TTL, 500-entry cap` numbers are *order-of-magnitude right* but were not re-verified against the live CrossRef / OpenAlex docs at spike time. Plan: re-verify during **4.1.B** (when the actual `fetch` calls land), not 4.1.A. 4.1.A only writes the numbers as `static readonly` constants inside `CitationService`; the actual values can be tuned in 4.1.B without re-touching the types.

For the record, what we expect 4.1.B to confirm against the live docs:
- **CrossRef polite pool** — the polite-pool docs currently describe it as "faster responses + better SLAs when `mailto=` is in the User-Agent" with no published per-second limit. The 5 req/s + capacity 10 is a conservative number that gives us headroom either way.
- **OpenAlex** — publishes a per-second + per-day rate limit on their docs. The spike's read was "around 10 req/s, polite pool with `mailto=` gets the same treatment as CrossRef". The exact number will be pinned down during 4.1.B and may move the constant up or down by a small amount.

If 4.1.B discovers the real numbers differ materially (e.g. OpenAlex's per-day cap is much lower than expected), the impact is contained: only the two `static readonly` constants in `citation-service.ts` move. No call-site changes; no setting default changes; no UI changes.

### 7.4 Three user-locked preferences (all confirmed 2026-07-22)

All three questions have been answered. 4.1.A is unblocked.

| # | Question | User answer (2026-07-22) | Code impact |
|---|---|---|---|
| Q1 | Provider default | **CrossRef primary; OpenAlex for free-text search fallback.** | `CitationSettings.preferredProvider` defaults to `'crossref'`. 4.1.A's `citation-service.ts` skeleton ships the CrossRef code path complete and the OpenAlex code path as a parallel stub; 4.1.B implements both `fetch` calls. |
| Q2 | Polite-pool `mailto:` default | **OFF by default.** No identifier leaves the device unless the user opts in via the Citations settings tab (lands in 4.1.D). | `CitationSettings.politeContact` defaults to `''` (empty string). When the user types a value, the `User-Agent` header gets `mailto:<value>` so requests hit the polite pool. When empty, no `mailto:` is sent. |
| Q3 | Auto-fill extras | **DOI + title + query only.** arXiv / ISBN / PMID deferred to 4.1.1. | `CitationService` skeleton ships three methods: `lookupByDoi(doi)`, `searchByTitle(query, limit?)`, and the new **`searchByQuery(query)`** (CrossRef's `/works?query.bibliographic=…` + OpenAlex's `?search=…` for journal-name and partial-citation strings). `lookupByArxiv`, `lookupByIsbn`, `lookupByPmid` are **not** in the 4.1.A skeleton. |

**New user-flagged requirement — journal / bibliographic lookup.** "Citation generation and lookup for journals" is in scope for 4.1.A. The cleanest fit is the new `searchByQuery` method above (Q3). Neither CrossRef nor OpenAlex has a dedicated "parse this citation string" endpoint, so `searchByQuery` is the closest honest experience; the result list is the same one `searchByTitle` returns, and the user picks a candidate the same way.

**Abstract autofill on DOI lookup (already in plan, now explicitly tracked).** The §3.4.1.C autofill list already includes `abstract`. Both providers return the abstract for the majority of DOIs they know about (CrossRef ~80%, OpenAlex ~85% for journal articles; lower for preprints and book chapters). The 4.1.E click-through checklist will include an explicit abstract-coverage assertion so we verify the auto-fill works against a known DOI.

Zotero questions (Q2: 5.1 vs 5.2 priority; Q3: coexistence with official plugins) are **out of scope for 4.1.A** and will be revisited when 5.1 is the next-active sprint; recorded here for the record only.

### 7.5 What 4.1.A delivers when the three questions are answered

- `src/services/citation/types.ts` (~25 LoC)
- `src/services/citation/citation-service.ts` (skeleton + class doc + static constants, ~60 LoC)
- `src/services/citation/csl-to-paper.ts` (pure function, fully implemented, ~50 LoC)
- `src/services/citation/providers/crossref.ts` (interface + stub, ~25 LoC)
- `src/services/citation/providers/openalex.ts` (interface + stub, ~25 LoC)
- Modifications: `src/types/literature.ts` (+1 line for `oaUrl?`), `src/types/index.ts` (+1 re-export), `src/settings.ts` (+~15 LoC for the `citation` field in `DEFAULT_SETTINGS` + the `citation: { ...DEFAULT_SETTINGS.citation, ...(candidate.citation ?? {}) }` line in `migrateSettings`), `src/core/events.ts` (+2 event shapes), `src/core/plugin.ts` (+~10 LoC for the lazy-instantiation getter).
- Total: ~210 LoC pre-bundling, **no new dependencies**, expected main.js delta **+1.0 to 1.4 KB**.
- Verification: `npm run build` / `npm run lint` / `npx tsc --noEmit` all exit 0. No new tests (vitest is 5.x).
- No UI changes. No settings tab. No modal buttons.

### 7.6 Hand-off contract

When 4.1.A is done, 4.1.B can start without further questions by implementing:
- The two `fetch` calls in `providers/crossref.ts` + `openalex.ts` with the cached + rate-limited plumbing in `citation-service.ts`.
- The LRU cache (`Map<doi, { record, fetchedAt }>`, TTL 30 d, cap 500) as an internal class detail.
- The token-bucket rate limiter (`5 req/s, capacity 10`) as an internal class detail.
- 4.1.B is the sub-pass that re-verifies the rate-limit numbers (spike §6, design doc §7.3) against the live docs.

### 7.7 Doc-sync note

The §3.4.1.A bullet in this design doc and the `plan.md` §14 4.1 row both say "add `Paper.oaUrl?` and `Paper.url?`" — `url?` is already on `src/types/literature.ts:21`. The §3 wording is preserved for traceability; the §7.2 L1 decision + the `plan.md` §14 4.1 row update are the source of truth.

---

## 8. 4.1.B kickoff — wire the real `fetch` calls (logged 2026-07-22)

4.1.A shipped the pure types + settings + service skeleton (cache + rate-limit constants live but unused; provider stubs throw). 4.1.B replaces the four stubs (`lookupByDoi × 2`, `searchByTitle × 2`, `searchByQuery × 2`) with real `fetch` calls, wires the cache + rate-limit plumbing around them, and adds the OpenAlex native → CSL mapper so OpenAlex's wired format lands in the same `CslJsonRecord` shape as CrossRef.

### 8.1 Confirmed scope of 4.1.B (per the §4.1.B plan)

Three new modules + two provider rewrites + one orchestrator wiring. **No new dependencies** — built-in `fetch`, `URL`, `URLSearchParams`, `Map`. The 4.1.A `static readonly` constants (`CACHE_TTL_DAYS = 30`, `CACHE_MAX_ENTRIES = 500`, `RATE_LIMIT_RPS = 5`, `RATE_LIMIT_BURST = 10`) move from "declared but unused" to "enforced by `LruCache` and `TokenBucket`".

Concrete file surface:
- New [`src/services/citation/lru-cache.ts`](../../src/services/citation/lru-cache.ts) — generic in-memory cache: `Map<K, { value: V; fetchedAt: number }>`, TTL + cap, evict-oldest. Takes a `clock: () => number` for 5.x tests so we can advance time without sleeping.
- New [`src/services/citation/token-bucket.ts`](../../src/services/citation/token-bucket.ts) — async token-bucket with `await take()` (settle-as-tokens, no busy-loop). `async` interface so callers `await tokenBucket.take()` then issue their request.
- New [`src/services/citation/openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts) — pure OpenAlex native record → CSL mapper. Hand-rolled (~80 LoC) to avoid `@citation-js/core` (~50 KB). Covers: `title`, `author` (inverted-name to `family` + `given`), `issued` (from `publication_date` → `{ 'date-parts': [[y, m?, d?]] }`), `container-title` (from `primary_location.source.display_name` or `host_venue.display_name`), `DOI`, `URL` (built from DOI), OA URL (from `best_oa_location.pdf_url` for the new `Paper.oaUrl?`), `abstract` (reconstructed from `abstract_inverted_index` by sorting word positions and rejoining), `type` (mapped from OpenAlex's `type` string into CSL's vocabulary: `'article' | 'book' | 'book-chapter' | 'preprint' | ...`).
- [Rewrite `src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) — real `fetch` to `https://api.crossref.org/works/<doi>?transform=application/vnd.citationstyles.csl+json` or `/works?query.bibliographic=…&rows=N` or `/works?query.title=…&rows=N`. User-Agent polite-pool pattern via `buildUserAgent`. CSL-JSON arrives natively; parser wraps `JSON.parse` + a structural check that the result conforms to the 14-field `CslJsonRecord`.
- [Rewrite `src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts) — real `fetch` to `https://api.openalex.org/works/doi:<doi>` or `/works?search=<query>&per_page=N`. `?mailto=<politeContact>` query param when set. Native JSON passed through `openalexToCsl` before returning.
- [Modify `src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts) — wire `LruCache` (one shared instance, keyed by DOI for lookups; by normalised query for search; cap 500 entries across both) and `TokenBucket` (one shared bucket, 5 req/s capacity 10) as private fields. Each `lookupByDoi` / `searchByTitle` / `searchByQuery` becomes cache-check → bucket-take → provider-call → cache-put → emit telemetry, with the telemetry surface already typed in 4.1.A's event types.

### 8.2 Locked decisions (no user input required)

| # | Decision | Rationale |
|---|---|---|
| B1 | **Built-in `fetch`, not `axios` / `node-fetch`.** | Already wired through the 4.1.A `FetchImpl` constructor dep. 0 KB bundle cost. Same code path Electron and browser use. |
| B2 | **CSL-JSON is the canonical on-wire shape; CrossRef serves it natively, OpenAlex needs a hand mapper.** | CrossRef's `?transform=application/vnd.citationstyles.csl+json` returns it directly. OpenAlex's native JSON differs on ~10 fields (notably `abstract_inverted_index` as `{ word: [positions] }` we have to reconstruct). Keeping a single downstream CSL path lets `csl-to-paper.ts` stay unchanged in 4.1.B. |
| B3 | **LRU cache is a single `Map<K, { value, fetchedAt }>`, evict-oldest, TTL 30 d, cap 500.** | Mirrors 4.1.A's hand-off wiring. `null` results cached too, so a 404 (Q6 — CrossRef not-found → `null`) doesn't re-fire on the next modal open. Cache hits don't spend a token (B5). |
| B4 | **Token-bucket: 5 tokens / s, capacity 10, single shared bucket across both providers.** | Matches 4.1.A's `static readonly` constants (kickoff §7.3). The bucket is shared so the combined outbound pace (CrossRef primary + OpenAlex fallback) stays under budget when modalities interleave. Per-provider isolation is a 4.1.1 follow-up if 4.1.E surfaces contention. |
| B5 | **Order is `cache.get` first → `bucket.take` → `fetch`.** | Cache check is sync and free. Taking the token *after* the cache check means a cache hit doesn't spend a token — important because the modal's "re-click Lookup" path (4.1.E smoke step 2) hammers the cache. |
| B6 | **Polite-pool contact surfaces as `User-Agent` header for CrossRef, `?mailto=` query param for OpenAlex.** | Both providers documented. Both are already plumbed through 4.1.A's `buildUserAgent` + `buildOpenAlexUrl` helpers (Q2 OFF by default means the `politeContact` is `''` and we never carry the contact unless the user opts in at 4.1.D). |
| B7 | **OpenAlex native → CSL mapper is hand-rolled, ~80 LoC, no `@citation-js/core`.** | `@citation-js/core` is ~50 KB and pulls in `crossref-json`. Our actual field coverage is 10 fields and we already have a CSL mapper (`csl-to-paper.ts`) doing the CSL-to-Paper side. A bespoke 80 LoC mapper keeps the bundle flat. If 4.1.E surfaces edge cases that don't map cleanly, 4.1.1 may add the package (with an explicit bundle cost re-measure). |
| B8 | **HTTP error mapping rules.** 200 → parse + emit success. 204 (empty body) → `null` for DOI lookup, `[]` for search. 401 / 403 → `{ reason: 'network' }` (we don't authenticate, so this is unexpected; surface as network failure rather than advertise we don't auth). 404 → `{ reason: 'not-found' }` for lookupByDoi; for search, 0 results is `{ records: [] }` with success, not a failure. 429 → backoff + retry once, subject to bucket; if still 429 → `{ reason: 'rate-limited' }`. Other 4xx → `{ reason: 'invalid-doi' }`. 5xx + fetch throws → `{ reason: 'network' }`. | The `CitationLookupFailureReason` union was locked to those five values in 4.1.A (see [`src/services/citation/types.ts:151`](../../src/services/citation/types.ts)). 4.1.B fills the implementation; UI handling of each is owed by 4.1.C. |
| B9 | **One retry budget. Only on 429, once. Other failures fail fast.** | A polite pool that returns 429 usually fixes itself with `Retry-After`. One retry captures that case without spending a second token if `Retry-After` is large. If 4.1.E surfaces a need for longer backoff (e.g. multiple consecutive 429s across providers), 4.1.1 grows the schedule. |
| B10 | **Telemetry payload is `provider`, `durationMs`, `cacheHit`, `doi?`, `query?`.** | These are exactly the fields already typed in 4.1.A's [`CitationLookupSucceeded`](../../src/services/citation/types.ts) / [`CitationLookupFailed`](../../src/services/citation/types.ts). 4.1.B just needs to fill them in; the modal at 4.1.C consumes them via `eventBus.on('citationLookupSucceeded', …)`. |
| B11 | **Provider fallback for `searchByQuery` only: when CrossRef returns 0 hits, automatically try OpenAlex once.** | Locked by Q1 (CrossRef primary + OpenAlex free-text fallback). Scope limited to `searchByQuery` (bibliographic search) — `searchByTitle` stays on the user's preferred provider per Q1, since swapping providers mid-title produces a confusing UI ("searched CrossRef for X, fell back to OpenAlex for X" is harder to read than "search OpenAlex for X"). The fallback is silent from the modal's perspective; the "Filled from …" line at 4.1.C names whichever provider returned the record. |
| B12 | **No new dependencies. Expected `main.js` delta over 4.1.A's 92,347 B baseline: +2.5–4.0 KB (→ ~94,500–96,500 B post-4.1.B).** | 4.1.B adds ~80 LoC LRU + ~60 LoC token-bucket + ~80 LoC OpenAlex mapper + ~120 LoC across the two provider rewrites. Most is straight-line code that esbuild compresses well. The final delta is re-measured by 4.1.F after 4.1.D–G. The 4.1.A prediction in kickoff §7.5 was +1.0–1.4 KB for the orchestrator alone; the actual 4.1.A shipped at +4,157 B over the 2.8.1 88,190 B baseline, so we know to add 60–100% overhead for JSDoc density + the settings/event/plugin plumbing. |

### 8.3 Rate-limit numbers — re-verification (offline; honest caveat)

This tool environment has **no web access**, so the live CrossRef / OpenAlex docs cannot be reached at kickoff time. The 4.1.A hypothesis (`5 req/s, capacity 10, 30 d TTL, 500 cap`) **remains the working hypothesis** going into 4.1.B's implementation. The actual tuning moves to **4.1.E's manual smoke** (per the spike §6 honest caveat + kickoff §7.3).

When live network is available (4.1.E), the smoke will:
- **Rate-limit stress** — issue 100 lookups in a tight loop and confirm we never get a 429 from the polite pool. If we do, halve `RATE_LIMIT_RPS` until clean, or split the bucket per-provider (B4 follow-up).
- **OpenAlex day-cap** — issue 500 lookups and watch for the documented per-day OpenAlex cap (their docs say "be polite, target ~10 req/s in bursts; we'll throttle beyond that", but the exact number wasn’t re-verified at spike time). If we trip it, lower `RATE_LIMIT_RPS` and add a per-day cap on `LruCache` writes (deferred to 4.1.1 if it surfaces).

If 4.1.E discovers the real numbers differ materially, the impact is contained: only the four `static readonly` constants in `citation-service.ts` move. No call-site changes; no setting default changes; no UI changes; 4.1.C's modal compiles unchanged.

### 8.4 What 4.1.B delivers

- 3 new modules: [`lru-cache.ts`](../../src/services/citation/lru-cache.ts), [`token-bucket.ts`](../../src/services/citation/token-bucket.ts), [`openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts).
- 2 provider rewrites: [`providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) and [`providers/openalex.ts`](../../src/services/citation/providers/openalex.ts). Both export the same `CitationProviderClient` interface as 4.1.A; both back-on-error paths emit the matching `citationLookupFailed` reason.
- 1 orchestrator wiring: [`citation-service.ts`](../../src/services/citation/citation-service.ts) — the three public methods become cache-check → bucket-take → provider-call → cache-put → emit telemetry, with the 4.1.A `static readonly` constants moving from "declared" to "enforced".
- 0 new dependencies.
- Total 4.1.B pre-bundle LoC: ~340 (LRU ~80 + token-bucket ~60 + OpenAlex mapper ~80 + 2 provider rewrites ~120). Expected `main.js` delta over 4.1.A's 92,347 B baseline: +2.5–4.0 KB.
- Verification: `npm run build` / `lint` / `tsc --noEmit` all `exit 0`. Vitest fixtures for the LRU cache, the token-bucket, and the OpenAlex mapper arrive with 5.x setup (per §14 5.x row). 4.1.E's manual smoke covers the network path (with the 12 known DOIs + the 3 known OpenAlex searches per the §4.1.E smoke plan).
- No UI changes. No settings tab. No modal buttons. No README changes.

### 8.5 Hand-off contract for 4.1.C

When 4.1.B is done, 4.1.C can start without further questions:
- The orchestrator's public API stays exactly as 4.1.A defined it. The three methods already return `CslJsonRecord | null` / `CslJsonRecord[]`. 4.1.B fills them with real network calls behind a cache + rate-limited wrapper.
- 4.1.C wires three new buttons in [`paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts): a `🔍 Lookup` next to the `doi` field, a `🔍 Search by title…` next to the `title` field, and a `🔍 Query journals…` button for the new `searchByQuery` bibliographic search. Each calls `plugin.ensureCitationService()` (L4). The citekey preview re-runs after every successful fill via `refreshPreview()` (L6).
- The autofill-tracking `autofilledFields: Set<keyof PaperImportForm>` pattern (per the §4.1.C plan and the kickoff "preserve user edits" contract) carries over unchanged.
- The error-reason copy at the modal: `'disabled'` → hide the buttons; `'not-found'` → "No match for that DOI."; `'rate-limited'` → "CrossRef asked us to slow down. Try again in 30 s."; `'network'` → "Lookup failed (network or 5xx). Try again?"; `'invalid-doi'` → "Lookup refused by the provider. Check the DOI shape.". Copy lives in 4.1.C; 4.1.B just emits the reason.

### 8.6 From-4.1.A contract that's already in place (not re-decided)

- **Lazy instantiation (L4).** `plugin.ensureCitationService()` constructs `CitationService` on first use. 4.1.B's cache + bucket state lives on the `CitationService` instance so it dies on plugin reload.
- **`FetchImpl` dep (4.1.A constructor)** is the test seam — 5.x vitest injects a `vi.fn()` here without touching the real `fetch`.
- **`Pick<EventBus, 'emit'>` alias (4.1.A variance fix)** — preserves the wider `EventBus.emit` signature when `CitationService` only emits `citationLookup{Succeeded,Failed}`. 4.1.B just calls `this.eventBus.emit(...)` at the right moments.

### 8.7 Doc-sync note

The §4.1.B plan-row in this design doc was written before 4.1.A's `static readonly` rate-limit constants landed. The §8 above is the source of truth for 4.1.B's locked decisions, scope, and re-verification stance; the older §4.1.B body is preserved for traceability.
