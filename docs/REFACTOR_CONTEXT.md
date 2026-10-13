# ResearchVault — pre-1.0 cleanup & release context

> **Purpose.** Hand-off document for continuing the release-prep refactor.
> Read this first before touching anything; update it after every phase,
> commit, or decision change. Written 2026-10-08 (updated after Phases 1–2).

---

## 1. Goal

Clean up the plugin for a first public release: fix real correctness bugs,
shrink the bundle, reorganise the largest files, and complete release
hygiene (manifest, license, README, CI). Target: `0.9.0` first, then `1.0.0`
in the Obsidian community catalog.

## 2. Decisions

| # | Decision | Notes |
|---|----------|-------|
| D24 (amended 2026-10) | `dateModified` is **derived from `file.stat.mtime`**, never written to frontmatter, never re-stamped on edit | Was: stored ISO string, re-written on every `modify` event → note re-written while the user types. The `PaperFrontmatter.dateModified` key is kept optional for backwards compatibility (older notes still carry it; it is ignored on read, dropped on next persist). `toFrontmatter` emits `dateModified: undefined` (js-yaml omits it). In-memory `updatePaper` still sets `Date.now()` as an approximation. `papersEqual` still compares `dateModified`, so body edits now emit `paperUpdated` once per debounce window — intended ("Recently touched" sort keeps working). |
| D33 (new, 2026-10) | Fuzzy search uses Obsidian's `prepareFuzzySearch`, not fuse.js | fuse.js was 26.4 KB of the 134 KB bundle. Same field weights applied as score multipliers (title .4 / authors .2 / keywords .2 / quotes .1 / citekey .05 / venue .05). Semantics change slightly: subsequence matching (Quick-Switcher style) instead of approximate edit-distance; the old threshold/minMatchCharLength config is gone — a paper matches if any weighted field matches. Limit 200 kept. |
| — | Citekeys are unique **per project**, not vault-wide; in-memory `Paper.id` is the composite `${projectId}/${citekey}` | New (2026-10-13), post-smoke-test fix. Previously `paper.id === citekey` and a vault-wide `citekeyToId` map blocked adding the same paper to two projects ("citekey already in use"). The map clobbered one project's entry, so simply ignoring it would have corrupted the index. Now: `resolveCitekey`/`computePreviewedCitekey` only check the target project; `citekeyToId` is gone (`getByCitekey(citekey, projectId?)` scans `byId`); `frontmatterToPaper` derives the composite id and ignores the disk `id`; `toFrontmatter` still writes the plain citekey as `id` (disk format unchanged — existing notes stay byte-stable). `idAtPath`'s rename/delete fallback matches on citekey + parent folder. |
| — | Hide AI features for 1.0 | Pending (Phase 4). AI settings + `notImplemented` stubs must not be user-visible. |
| — | License stays 0-BSD | `docs/LICENSE` text IS 0-BSD (matches `package.json`) but the copyright line says "Dynalist Inc." (copied from obsidian-sample-plugin) → fix holder, move to repo root (Phase 4). |

### Author identity (resolved 2026-10-08)

From `git config` + remote (looked valid, used without re-asking):

- **author**: `ststudio907` (git user.name; email seektruthstudio@gmail.com)
- **authorUrl**: `https://github.com/ststudio907/ResearchVault` (the remote)
- Confirm exact URL casing (remote path is `ResearchVault`) before using in links.

## 3. Rejected suggestions (from the other AI's review)

- Lazy `import()` / esbuild `splitting` — Obsidian loads a single CJS `main.js`; splitting is impossible.
- `const enum` — conflicts with `isolatedModules`.
- Removing barrel files — no bundle-size gain.
- Shortening CSS class names — breaks user CSS snippets; harmful.
- LRU eviction for the in-memory paper maps — unnecessary at realistic sizes.
- Changing the listener-copy pattern in the event bus — current pattern is correct.
- Dropping console calls — only `warn`/`error` are used; acceptable.

## 4. Bundle measurements

- Before cleanup: `main.js` 134.4 KB minified, ~39 KB gzipped (already minified).
- Largest inputs then: fuse.js 26.4 K, `paper-import-modal` 16.9 K, `paper-service` 14.4 K, sidebar 13.4 K, `settings-tab` 10.3 K.
- After Phase 2: **105.6 KB** (target "≈105 KB" reached). Metafile breakdown build report still TODO (Phase 4).

## 5. Real bugs (audit-confirmed)

1. **Empty search index at startup** — `paperService.hydrate()` was `void`-fired, indexer hydrated against an empty store; indexer ignored `paperUpdated`/`paperRemoved`. ✅ **Fixed (Phase 1).**
2. **Writes while the user types** — `onPaperFileModified` re-stamped + re-wrote the note on every autosave; racing `void syncFromFile`. ✅ **Fixed (Phase 1)** — D24 amended; debounced sync only.
3. **Disk work at startup** — `hydrate` called `ensureProjectFolders` + sequential `vault.read`. ✅ **Fixed (Phase 1)** — folders created only on write; `metadataCache` frontmatter w/ `cachedRead` fallback; per-project `Promise.all`.
4. **O(n) path lookups** — `findByPath` scanned all papers per modify; rename/delete drops couldn't find the file after it disappeared. ✅ **Fixed (Phase 1)** — `pathToId` map kept in sync via `indexPaper`/`dropFromIndex`; `idAtPath` O(1) with basename-fallback guarded by folder match.
5. **Duplicate error surfacing** — `requireProject` / `requireById` showed a Notice AND threw. ✅ **Fixed (Phase 1)** — throw-only; callers surface UI.
6. **Racing read-modify-write** — persist/addQuote/PDF-refresh did `vault.read` → `vault.modify`, losing user edits in between. ✅ **Fixed (Phase 1)** — `vault.process` (atomic; API present since Obsidian 1.1.9, `minAppVersion` is 1.6.6).

## 6. Phase plan & status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Correctness (above bugs) | ✅ done — commit "cleanup phase 1" |
| 2 | fuse.js → `prepareFuzzySearch` | ✅ done; bundle 134.4 → 105.6 KB |
| 3 | Split `paper-service.ts` (~1160 lines), `paper-import-modal.ts`, sidebar, `settings-tab.ts` via `git mv` + targeted edits; delete dead `notImplemented` stubs (27 total across services) | ⬜ TODO |
| 4 | Release hygiene: fix manifest author/authorUrl (see §2), move LICENSE to root + fix copyright line, rewrite README (drop "Sprint 1" copy, add privacy/network section, features from 5.3/2.9 docs), hide AI settings + stubs, providers use `requestUrl` not `window.fetch`, standardize Notice prefixes ("ResearchVault:"), replace inline `modalEl.style.width` with a CSS class, `git rm` tracked clutter (`.ag-scripts/`, `PROJECT_CONTEXT.md`, `docs/ResearchVault Living Document.md`), add metafile size report to build | ⬜ TODO |
| 5 | Vitest for pure utils (`citekey`, `frontmatter`, `template`, `format-date`, `uuid`); CI test step | ⬜ TODO |
| 6 | Version → 0.9.0 (`manifest.json` + `versions.json`), release via `release.yml`, BRAT beta notes, then PR to `obsidianmd/obsidian-releases` for 1.0.0 | ⬜ TODO |


## 7. Phase 1 changes (detail)

**`src/core/plugin.ts`**
- Hydration moved into `app.workspace.onLayoutReady`: `await paperService.hydrate()` → `vaultIndexer.hydrate()` → `registerVaultSync()` (registered after hydration so early modify events can't interleave with `hydrate` clearing/rebuilding maps).
- Modify handler: `consumeSelfWrite` check, then `paperService.scheduleSync(file)` — no more `onPaperFileModified` write-back.
- `onunload` also disposes `paperService` (clears debounce timers).

**`src/services/paper-service.ts`** (partially split in Phase 3 — see §11)
- `hydrate`: no `ensureProjectFolders`; per-project `Promise.all`; `readPaperFile(f, projectId, { preferCache: true })` uses `metadataCache.getFileCache` frontmatter, falling back to `cachedRead` + manual parse. Also fixes a latent **citekey casing bug** (index now keyed lower-cased, matching `getByCitekey`).
- New `pathToId: Map<lcPath, id>`; single mutation helpers `indexPaper` / `dropFromIndex` keep all three maps consistent; `idAtPath` (O(1) + guard) and `dropAtPath` (emits `paperRemoved`) replace `findByPath`, `dropByPath`, `dropPaperAtPath`.
- `scheduleSync(file)` — 750 ms per-path debounce → `syncFromFile`; timers canceled in new `dispose()`.
- `selfAwareProcess(file, fn)` — `vault.process` with self-write marker; used by `persistPaper`, `addQuote`, `refreshAttachedPdfBody`.
- `requireById` throws only (no Notice).
- `PaperFrontmatter.dateModified?` optional; `toFrontmatter` emits `undefined`; `frontmatterToPaper` reads `file.stat.mtime`.

**`src/services/vault-indexer.ts`**
- Subscribes to `paperUpdated` and `paperRemoved` (also see §8 for Phase 2 rewrite).

**`src/services/project-manager.ts`**
- `requireProject` throw-only.
- `getProjectFiles` walks the project's `TFolder` children recursively instead of scanning `vault.getMarkdownFiles()`.

## 8. Phase 2 changes (detail)

- `vault-indexer.ts`: `fuse`/`rebuild()` gone; `byId` Map is the source of truth; `searchPapers` computes per query via `prepareFuzzySearch` + `fuzzyScore` (weighted best-field match, see `SEARCH_FIELDS`), stable sort score → dateAdded desc → title asc, 200-result cap kept, `SearchFilters` post-filter unchanged. Public API unchanged.
- `package.json`: `fuse.js` removed; `npm uninstall` already run.
- Note the obsidian typings: `prepareFuzzySearch` returns `(text) => SearchResult | null` (`SearchResult = {score, matches}`; score ≤ 0, closer to 0 = better).

## 9. Verification

- `npx tsc -noEmit`, `npm run lint`, `npm run build` all green after each phase.
- Not yet verified live in a vault; **Phase 6** smoke list: fresh vault + existing vault with legacy `dateModified` keys; edit a note body (no writes, index updates within ~1 s); rename/delete of a note; search weighting sanity.

## 10. Open items / watch list

- `syncFromFile` still uses `cachedRead` (not metadataCache frontmatter) — deliberate: the cache may lag the write; fine.
- Confirm in Phase 4 which network paths still use `window.fetch` (citation providers, Zotero) and route them through `requestUrl` (Zotero local connector already does since commit `d0f37d9`).
- `versions.json` currently lists 1.0.0 — needs the 0.9.0 mapping in Phase 6.

## 11. Phase 3 changes (detail)

**Dead-code deletion** (caller-verified by grep before removal — no references anywhere in `src/`):
- `src/services/ai-client.ts` deleted whole-file. Every method threw `notImplemented`; the class had zero imports. Stale mentions in `lru-cache.ts` / `project-manager.ts` comments reworded.
- `paper-service.ts` stubs removed: `createFromDoi`, `createFromPdf` (tombstone — compile-time safety makes it redundant), `importBibtex`, `exportBibtex`, `updateReadingProgress`, `extractQuotesFromPdf`, `findCitationsInPdf`, `addCitation`, `addRelated`, and the private `notImplemented` helper. Header comment updated; `docs/REFACTOR_CONTEXT.md` is now the pointer for the deferred roadmaps.
- `vault-indexer.ts` stubs removed: `searchNotes`, `findUnlinkedMentions`, `getCitationGraph`, `getRelatedPapers`, `getChunksForPaper`, `getProjectContext`, `updateIndex`, the private `notImplemented` helper, the orphaned `TextChunk` / `CitationGraph` interfaces, the unused `LiteratureNote` import, and the trailing `TFile` re-import hack. `addToIndex` / `removeFromIndex` kept — thin wrappers over `onPaperUpsert` / `byId.delete` used by the `PaperService` sync paths.
- `paper-import-modal.ts` header comment reworded (no `notImplemented` references remain in the codebase).

**File splits**
- New `src/services/papers/paper-file-format.ts` (~330 lines): `PaperFrontmatter` type, `DEFAULT_PAPER_TEMPLATE`, `toFrontmatter`, `frontmatterToPaper`, `templateDataFor`, `upsertAttachedPdfSection`, `renderQuoteSection`, plus internal `normaliseAuthorName` / `authorsFromLegacy` / `trimOrUndefined` / `isoDate` / `coerceFrontmatterScalar`. Stateless pure functions — the Phase 5 Vitest targets.
- New `src/services/papers/paper-paths.ts`: `papersFolderOf`, `canonicalPathOf`, `SYNC_DEBOUNCE_MS`.
- `paper-service.ts`: 1160 → 780 lines (class + `papersEqual`/`authorsEqual`/`keywordsEqual` kept adjacent to the sync logic that consumes them).
- **Deferred splits** (recorded here instead of acted on): `paper-import-modal.ts` (1056), `projects-sidebar-view.ts` (861), `settings-tab.ts` (477), and the remaining `paper-service.ts` class body (~700). Rationale: each is a single cohesive Obsidian object (one Modal class / one ItemView class / one PluginSettingTab class / one service class with shared private Maps) and splitting them means either facade re-exports or `this`-sharing across files, which the architecture rules flag as "clearly worse". Revisit post-1.0 if these files grow.

**Verification**: `tsc --noEmit`, `npm run lint`, `npm run build` all green. Bundle 105.6 KB → 103.9 KB.

## 12. Phase 4 changes (detail) — release hygiene

**Manifest & legal**
- `manifest.json`: `author` → `ststudio907`, `authorUrl` → the ststudio907 GitHub repo.
- New root `LICENSE` (clean 0-BSD text with corrected copyright). Deleted `docs/LICENSE` (stale copyright line) and `docs/README.md` (leftover sample-plugin readme).

**README rewrite** — sprint-chronicle replaced with a user-facing doc: shipped-features list (projects, paper tracking w/ DOI + CSL-JSON import, PDF attach, quote capture, sidebar, templates), install + getting-started steps, opt-in privacy disclosures for Crossref/OpenAlex, Zotero sync, and Zotero local push, plus dev commands.

**Settings tab** — AI section hidden until AI features ship (`renderAI` deleted; `settings.ai` schema and `AI_PROVIDERS`/CSL exports in `types/index.ts` kept so persisted data and future work survive). File 477 → ~345 lines.

**Notice prefix standardization** — all `Researchvault:` → `ResearchVault:`, plus the previously unprefixed folder-suggestion notice. The `obsidianmd/ui/sentence-case` rule rewrites the interior capital, so `eslint.config.mts` now passes `{ ignoreRegex: ['^ResearchVault:'] }` for exactly the brand-prefix strings (remainder of each sentence stays sentence case).

**Modal width** — inline `style.width`/`style.maxWidth` assignments replaced by the `.researchvault-modal` class in `styles.css` (width 640px / max-width 90vw, user-overridable via snippet); `modal-width.ts` now only calls `addClass`.

**Tracked clutter** — `git rm -r .ag-scripts/` (17 one-off patching scripts, superseded by committed results).

**Bundle analysis** — production builds emit `esbuild-metafile.json` (gitignored) plus a per-module size report; `npm run analyze` is an alias for `build`. Bundle 103.9 KB → 101.6 KB.

**Verified already done in earlier phases** (Phase 4 checklist items): all network traffic already uses `requestUrl` — no `window.fetch` calls remain in `src/`. `vault.process` + debounced index sync + `sync-note-noise` fix shipped in Phases 1–2.

**Open items carried to Phase 5/6**
- Phase 5: Vitest for pure utils — `papers/paper-file-format.ts` first.
- Phase 6: `versions.json` mapping for the pre-release version (needs the 0.9.0 mapping), GitHub release, live smoke tests in fresh + legacy vaults (deploy with `npm run deploy`).


## 13. Phase 5 changes (detail) — test infrastructure (commit `aafa58f`)

- **vitest** installed at `^3` (v3.2.7; `^4` ERESOLVE-conflicts with the
  pinned `@types/node`). No config file needed — defaults resolve
  `tests/**/*.test.ts` against pathless pure modules. Scripts: `npm test`
  (`vitest run`), `npm run test:watch`.
- `eslint.config.mts` `projectService.allowDefaultProject` extended with
  `tests/*.ts` so the obsidianmd rules typecheck the suite (tsconfig stays
  scoped to `src/`; vitest+esbuild don't need tsc for tests).
- **53 tests, 4 files** targeting pure modules (no obsidian runtime imports):
  - `tests/paper-file-format.test.ts` (23) — highest-risk surface first.
    Frontmatter ⇄ `Paper` round-trip, legacy author-object migration,
    non-scalar YAML coercion, status/priority label migration, D24-amendment
    `dateModified`-from-mtime, `projectId`/`papersFolder` re-stamping,
    `templateDataFor` ↔ `DEFAULT_PAPER_TEMPLATE` key parity,
    `upsertAttachedPdfSection` edge cases (empty body, trailing section,
    section-only body), `renderQuoteSection` formatting.
  - `tests/format-date.test.ts` (11) — TZ-stable via `new Date(y,m,d,…)`
    local-component fixtures.
  - `tests/citekey.test.ts` (12), `tests/template.test.ts` (7).
- **REAL BUG CAUGHT BY THE TESTS**: `Date.parse('2026-07-11 | 16:55')` →
  `NaN` on modern V8, contradicting the stale 2.8.C comment claiming the
  local-tz frontmatter format parses "in every evergreen browser / Node".
  Consequence in production: every paper note written since 2.8.C read back
  `dateAdded` as the file's *ctime* (silent, plausible-looking drift — this
  is why it survived) and dropped `dateRead` entirely. Fixed in
  `format-date.ts`: `toDate` now matches the canonical shape explicitly
  (`LOCAL_TZ_RE`) before the generic `Date` parse; the stale comment was
  corrected. This alone justifies the test phase.
- **Doc/behavior mismatch pinned, not fixed (needs product decision)**:
  `renderTemplate`'s header comment claims unknown `{{keys}}` are left
  as-is; the implementation (and the original inline code) blanks them.
  Tests pin the implemented behavior and flag the discrepancy in a comment.
- Gate green: `vitest run` 53/53, `tsc --noEmit`, `eslint .`,
  `npm run build` all pass after the fix.

### Phase 6 remaining (release prep)
- Set `manifest.json` version 0.9.0 + `versions.json` mapping, GitHub release
  tag match, release assets (`main.js`, `manifest.json`, `styles.css`).
- Live smoke tests in a fresh vault and a legacy vault via `npm run deploy`.

