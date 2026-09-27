# ResearchVault — Hub Document (plan.md)

> **Authority.** This is the *source of truth* for the ResearchVault Obsidian plugin — vision, architecture, current state, work plan, changelog, and README draft content all live here. `PROJECT_CONTEXT.md` is the editable mirror; `src/` is the executed form.

## How to navigate

| § | What you find there | When to touch it |
|---|---|---|
| 1–3 | Vision, current state audit, locked architectural decisions (`D1`–`D17`) | When we change a long-term rule. |
| 4–6 | Module blueprints, on-disk storage schema, plugin-guideline compliance | When a new file, schema, or guideline needs defending. |
| 7 | Sprint roadmap (high level) | When a sprint boundary shifts. |
| 8 | Sprint 1 phase-by-phase task breakdown (historical) | Read-only after sign-off. |
| 9–11 | Risks, communication cadence, open questions | When a real risk surfaces. |
| 12 | Sprint 1 sign-off | Read-only. |
| 13 | Living log: dated sub-pass entries with **what shipped / verification / known gaps / files touched** | **Append-only.** New entry at the bottom on every completed sub-pass. |
| 14 | Upcoming implementation passes — detailed phase plans for every queued chunk | **Edit as we develop.** Mark phases `[x]` as they complete; strike-through a whole pass when its work shifts to a dated entry in §13. |
| 15 | README source — the prose we'll lift into the GitHub README | Edit when the user-facing surface genuinely changes. |

### Maintenance rules

1. **Append-only history in §13.** Never delete a dated entry; strike through `[x]` rows that get superseded and point to the replacement row.
2. **§14 feeds §13.** When you finish a queued chunk, move it from §14 (with a strike-through) into §13 as a dated entry. The §14 entry stays as a historical ledger.
3. **Single source of every user-facing string.** The README lives in `README.md` but its prose is drafted in §15. Anything we say to a user gets reviewed there before it lands in release artifacts.
4. **Verified ≠ "looks right".** Every close-out records the literal `exit 0` from `npm run build`, `npm run lint`, `npx tsc --noEmit`. Manual smoke (real Obsidian vault) is recorded separately as `Phase G` in §13.

---

## 1. Vision

ResearchVault turns Obsidian into a **research operating system**. Researchers manage their full workflow — discovering papers, reading, annotating, extracting claims, writing notes, synthesizing across sources, and producing manuscripts — without leaving the vault. All user-authored content lives in plain markdown files; AI and metadata live alongside, transparently.

Three tiers of capability, each successive tier builds on the prior:

| Tier | Theme | Capabilities |
|---|---|---|
| **1 — Manage** | Keep what you read organized | Project folders, paper import (DOI/PDF), structured templates, status tracking, citekeys, BibTeX export |
| **2 — Workflow** | Read, annotate, connect | PDF text extraction, highlights → quotes, literature links (cites/extends/contradicts), reading queue, Zotero/Mendeley sync, atomic notes, concept graphs |
| **3 — Intelligence** | Synthesize and write | AI chat with vault context, summarization, claim extraction, gap finding, cross-paper synthesis, semantic search |

Each tier is independently useful. We ship Tier 1 first, prove value, then deepen.

---

## 2. Current State Audit

### Already in repo
- **Build toolchain:** `esbuild`, `tslint`-style `eslint`, `version-bump.mjs`, manifest at root — Obsidian sample scaffold. ✅
- **Types complete:** [`src/types/project.ts`](../src/types/project.ts), [`src/types/literature.ts`](../src/types/literature.ts), [`src/types/ai.ts`](../src/types/ai.ts), [`src/types/notes.ts`](../src/types/notes.ts). All interfaces present, no TBDs.
- **Service skeletons exist but are empty bodies:** [`project-manager.ts`](../src/services/project-manager.ts), [`ai-client.ts`](../src/services/ai-client.ts), [`paper-service.ts`](../src/services/paper-service.ts), [`vault-indexer.ts`](../src/services/vault-indexer.ts), [`notes.ts`](../src/services/notes.ts).
- **Folders that exist but are empty:** `src/ui/`, `src/utils/`, `src/core/`, `src/styles/`.

### What's wrong with the current state
- [`src/main.ts`](../src/main.ts:1) still extends the sample `MyPlugin` with dice ribbon, click `Notice`, sample modal.
- [`src/settings.ts`](../src/settings.ts:1) is the sample `MyPluginSettings` placeholder.
- [`src/services/project-manager.ts`](../src/services/project-manager.ts:4) imports `ResearchVaultPlugin, ProjectCreateConfig`, `Paper` — none of which exist; it has no methods bodies.
- No `types/index.ts` barrel.
- No `ResearchVaultPlugin` class anywhere.
- No UUID generation helper, no event emitter.

### What is right and should be kept
- Type interfaces in `types/**/*.ts` — production-grade, no rewriting needed except adding `ProjectCreateConfig` (used by `project-manager.ts`) and `PaperSource` already present.
- The `Project`, `Paper`, `AIConfig` shape matches the plan; we will not redesign the data model mid-project.
- The folder structure (top-level layout in `PROJECT_CONTEXT.md`) holds — service-based, clean module boundaries.

---

## 3. Architectural Decisions (Locked)

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Plugin id | `researchvault` | Must not change after release. Matches folder name in vault. |
| D2 | Settings module location | Root [`src/settings.ts`](../src/settings.ts) | Cleaner than a folder; matches Obsidian sample convention. |
| D3 | Plugin class location | [`src/core/plugin.ts`](../src/core/plugin.ts) | Spec requires it; keeps `main.ts` tiny and lifecycle-only. |
| D4 | `main.ts` shape | One-liner re-export shim | Per `AGENTS.md` — minimize `main.ts`. |
| D5 | Project storage | `projects: Project[]` inside plugin settings JSON (`saveData`) | Lowest friction; 10s of projects ≤ a few KB. |
| D6 | Paper storage | Markdown file per paper in project's `papers/` subfolder, YAML for metadata, body for note content | User owns files; no separate DB. |
| D7 | Citekey format | `authorYYYYkeyword` (e.g., `smith2023transformer`) | Standard, configurable per project. |
| D8 | UUID generation | `crypto.randomUUID()` (Web Crypto) | Available in Electron + modern mobile WebView; no dependency. |
| D9 | Event emitter | Custom typed `EventEmitter<T>` in [`src/utils/event-emitter.ts`](../src/utils/event-emitter.ts) | Node `events` is desktop-only; we want mobile parity. |
| D10 | Mobile support | `isDesktopOnly: false` in `manifest.json` | Land desktop + mobile simultaneously. |
| D11 | External dependencies | `fuse.js` only at MVP; `citeproc` deferred. `pdfjs-dist` was trialed in 2.6 (D26) then dropped in D27 because it cannot run inside Obsidian's Electron sandbox. | Bundle size matters; citeproc is heavy — defer with simple BibTeX emission first. |
| D12 | AI feature flagging | Each AI feature gated by `AIConfig.enableXxx` AND `apiKey` present | Required by Obsidian plugin guidelines: opt-in, explicit disclosure. |
| D13 | API key storage | Plaintext in settings; UI shows warning + masking | Best we can do without OAuth. Documented in README. We never send keys anywhere but the configured provider. |
| D14 | Files written outside vault | Never. Files read outside vault | Plugin guidelines + privacy. |
| D15 | Telemetry | None. Ever. | Privacy default. If added later: explicit opt-in + README disclosure. |
| D16 | Frontmatter R/W | [`parseYaml`](../src/utils/frontmatter.ts) / [`stringifyYaml`](../src/utils/frontmatter.ts) re-exports from `obsidian` | Obsidian already ships these. Use the host app's parser so a paper note opened in another editor behaves identically to its Obsidian read-back. **No** hand-rolled YAML parser. |
| D17 | Delete semantics | `fileManager.trashFile()` for paper notes (`obsidianmd/prefer-file-manager-trash-file`) | Honors the user's Settings → Files & Links → "Deleted files" preference. Only project folders and project MD are deleted via raw `vault.delete` if/when we add a destructive project-folder clear. |
| D18 | Vault index runtime | In-memory only; rebuilt lazily from `PaperService.getAll()` on `hydrate()`. Expected per-project counts (dozens → few hundred) keep rebuild < 50 ms. Re-evaluate when Zotero sync eventually pushes counts past 5k. |
| D19 | Search library | `fuse.js` (MIT, ~12 KB minified, zero deps, browser-safe) | Lightweight; no bundler work needed. |
| D20 | "Needs action" group | Derived in the sidebar view, not a stored column on `Paper` | Keeps the type slim and avoids a new event when the derivation tweaks. |
| D21 | Status color palette | Lives in [`styles.css`](../../styles.css) (not inline) | One place to theme later; matches Obsidian's pick-the-rule-from-css approach. |
| D22 | Citekey separator | Underscore (`_`) in [`composeCitekey`](../../src/utils/citekey.ts:35) | Stable so across-run citekeys read naturally and downstream `[[links]]` stay valid. |
| D23 | Live-sync ownership | `PaperService` owns smarts; plugin owns subscription (so `onunload` cleans up automatically) | One subsystem has the logic; one tear-down point. `papersEqual` short-circuit prevents self-write loops. |
| D24 | Date format | `Paper.dateAdded` / `dateModified` stay `number` internally; YAML boundary is the only speaker of ISO date+time strings | Keeps the in-memory index free of repeated string parsing and limits the change to frontmatter-round-trip helpers + a single UI formatter. |
| D25 | Edit modal | `PaperImportModal` is one component with two modes (import / edit). Citekey field is disabled + greyed out in edit mode; renaming a paper means renaming the markdown file in the vault, which the live-sync handler picks up automatically | Single surface, fewer regressions, and `[[smith_2024_transformer]]` style links stay valid indefinitely. |
| D26 | ~~PDF import scope~~ | **Superseded by D27.** | Phase G click-through revealed `pdfjs-dist@4.x` cannot run inside Obsidian's Electron main process: it calls `process.getBuiltinModule(...)` at module-load time and requires Web Workers at parse time. The hook stayed in the codebase for one sub-pass. See D27 for the resolution. |
| D27 | PDF import is link-only | `PaperService.createFromPdf` copies the chosen PDF into `<project>/pdfs/<basename>.pdf` and wikilinks it from the created note's `## Attached PDF` section. `pdfjs-dist` is **out**; bundle is back at ~87 KB with no worker asset. `extractQuotesFromPdf` / `findCitationsInPdf` both `throw` with a `D27` reason message. | Drops ~1.4 MB of worker file plus ~50 KB of parser entry, works on desktop + mobile, and matches the user's actual workflow (linked PDFs). Text-extraction roadmap (Zotero PDF indexing, OCR, AI summarisation) is tracked in §9 and §7 as deferred work. |
| D28 | PDF is an attachment, never a metadata source | Manual metadata always wins on submit. The PDF picker in [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts) copies the chosen file into `<project>/pdfs/<citekey>.pdf` and adds a `## Attached PDF` wikilink section, but never fabricates a `title` / `authors` / `year` from the file basename. `PaperManualInput.attachPdfFrom` is the only PDF knob; `PaperService.createFromPdf` was removed (private stub `throw`s). | Phase G click-through after the 2.7 deploy surfaced a bug where filling in title/author/year *and* attaching a PDF silently produced an `anon_<basename>_<uuid>` paper because the modal routed to `createFromPdf` first. We have no reliable way to extract structured metadata from a PDF in the current sandbox, so the safest user model is "the PDF is attached to a paper — whether the title was synthesised or not is the user's problem, not ours". Renamed the form field from `pdfPath` → `attachPdfFrom` to make the intent explicit at every call site. |
| D29 | Citation lookup (DOI + free-text) is opt-in, network-only, no auth | `CitationService` is a new pure service in [`src/services/citation/`](../../src/services/citation/) that calls CrossRef (primary) and OpenAlex (fallback for free-text) to turn a DOI or title into a CSL-JSON record, then pre-fills the import modal. Off by default; new `citation: { enableCitationLookup, preferredProvider, politeContact? }` block on [`ResearchVaultSettings`](../../src/settings.ts). Modal affordance is hidden when off. User-Agent carries an optional `mailto:` for the polite pool; a 30-day in-memory LRU cache and a 5 req/s in-process token bucket keep us under both providers' fair-use thresholds. Reuses the opt-in + disclosure pattern from `D12`/`D13`. | Per user feedback after the 2.7.1 deploy: paste-DOI / search-by-title is the "ISBN lookup" experience they want, and it removes most of the motivation to ever auto-fill from a PDF (which we can't do reliably per `D27`). CrossRef is the canonical DOI registry; OpenAlex is the best free-text search. We do not invent our own DOI resolver and we do not depend on `pdfjs-dist`. Lookup fills the form; the user can edit; submit still goes through `PaperService.createManual` so `D28`'s contract (manual always wins) holds. |
| D30 | Zotero integration comes in three independent, opt-in layers | **(a)** Web-API read-in via a new `ZoteroClient` (tiny service in [`src/services/integrations/zotero/`](../../src/services/integrations/zotero/)) using the Zotero Web API v3 with a per-user API key stored in settings (`zotero: { userID, apiKey, defaultCollectionKey? }`); converts CSL-JSON to `Paper` via the same `CitationService` path. **(b)** Local-API push-back via `ZoteroLocalClient` probing `127.0.0.1:23119` — desktop-only, hidden when offline, surfaces a "Push to Zotero" sidebar action. **(c)** Coexistence with the official `Zotero Integration` and `obsidian-zotero-desktop-connector` community plugins — settings tab links to them with a "works alongside" note. All three reuse the `D12`/`D13` opt-in + disclosure pattern; the API key never leaves the device except to zotero.org. Bidirectional sync is deferred to a later sub-pass. | Per user feedback: the long-term goal is "do it all within this plugin" but the cheapest and most reliable path is (1) read from the Zotero web API on every platform first, (2) push back via the local API on desktop, (3) let users who already have one of the official Obsidian Zotero plugins keep using it for insert-citation while our sidebar + PDF management complements rather than replaces it. Aligns with the community-plugin guideline "minimize scope; work alongside, not against". |

Decisions are locked unless a future sprint reveals a real blocker; any change goes through this plan file.

---

## 4. Module Blueprints

### 4.1 Core
- **`ResearchVaultPlugin`** — extends `Plugin`. Holds `settings`, `projectManager`, `paperService` (stub in Sprint 1), `aiClient` (stub). `onload`: hydrate settings → instantiate services → register ribbon ("library") → register commands → add settings tab → register event handlers. `onunload`: services dispose.
- **`EventBus`** — typed cross-service pub/sub. Services emit (`projectChanged`, `paperImported`, `paperStatusChanged`, `aiRequestStarted`, `aiRequestCompleted`). UI listens.

### 4.2 Services (all instantiable classes, JSDoc on public methods)

| Service | Sprint | Responsibilities |
|---|---|---|
| `ProjectManager` | 1 | Create/list/get/activate/delete projects; vault-folder association; per-project file filtering; stats. **Substantially complete.** |
| `PaperService` | 2 | Import (manual, link-only PDF per `D27`) → metadata + citekey → create paper note file; status transitions; quote/claim CRUD. **Manual + link-only PDF import, in-memory index, status transitions, quote append, link-update via `## Attached PDF` section, delete via `trashFile` implemented.** DOI lookup, BibTeX import/export, relationship edges (cites/extends/contradicts/related), text extraction (`extractQuotesFromPdf`, `findCitationsInPdf` — currently throw `notImplemented` with a `D27` reason), and reading-progress remain `notImplemented` — see §13 Living Log. |
| `CitekeyGenerator` | 2 | Deterministic citekey from authors/year/title; collision suffix. |
| `CitationManager` | 3 | BibTeX export, CSL render via `citeproc` (deferred), in-text citation insertion in editor. |
| `VaultIndexer` | 3 | Background scan → in-memory index; `fuse.js` powered fuzzy search; relevance scoring for AI context. |
| `AIClient` | 3 (stub in 1) | Provider abstraction (OpenAI, Anthropic, local, custom); chat + summarize + extract endpoints; budget enforcement. |
| _removed: `PdfService`_ | ~~2~~ | ~~Worker-thread PDF text extraction via `pdfjs-dist`; never block UI; returns structured pages.~~ **Removed in sub-pass 2.7 (`D27`)** — `pdfjs-dist@4.x` calls `process.getBuiltinModule(...)` at module-load time, which fails in Obsidian's plugin sandbox. The link-only import path lives on `PaperService.createFromPdf`; text extraction deferred until a sandbox-safe worker shim exists. |
| `TemplateEngine` | 2 | Render note templates (Handlebars-lite, no extra deps initially) with project + paper context. |

### 4.3 UI

| Component | Sprint | Purpose |
|---|---|---|
| `ResearchVaultSettingTab` | 1 | Settings UI: general, projects list/manage, AI provider/key, templates. |
| `CreateProjectModal` | 1 | Modal that takes name + folder path → creates project. |
| `ProjectsSidebarView` | 2 | Left dock view: active project badge, project list, paper counts. |
| `PaperImportModal` | 2 | Accept DOI / PDF / BibTeX entry; preview metadata; confirm import. |
| `PaperStatusChanger` | 2 | Quick-action dropdown to mutate paper status. |
| `QuoteCaptureModal` | 2 | From selection in editor → save quote attached to active paper. |
| `AIChatView` | 3 | Right dock chat panel with vault-aware context. |
| `SynthesisView` | 3 | Multi-paper summary UI. |

### 4.4 Types (`src/types/*`)

Already complete: `Project`, `ProjectSettings`, `ProjectStats`, `CustomField`, `CitationStyle`, `Paper`, `Author`, `Quote`, `Claim`, `ReadingStatus`, `Priority`, `PaperSource`, `LiteratureNote`, `AtomicNote`, `ConceptNote`, `ConceptClaim`, `AIConfig`, `ChatMessage`, `RetrievedContext`, `AIRequest`, `AIResponse`.

To add:
- `ProjectCreateConfig` — input shape for `ProjectManager.createProject()`, separates transient creation input from persisted `Project`.
- `Settings` namespace literals / const arrays for `CitationStyle`, `ReadingStatus`, `Priority` to back dropdowns.

**Re-export everything from [`src/types/index.ts`](../src/types/index.ts)** so consumers do `import { Project, Paper } from './types'`.

### 4.5 Utils (`src/utils/*`)

- `event-emitter.ts` — `EventEmitter<T>`.
- `uuid.ts` — `newId()` wrapping `crypto.randomUUID()` with fallback `Math.random()` + `Date.now()` (extremely unlikely path).
- `frontmatter.ts` — wraps Obsidian's `parseYaml` / `stringifyYaml` with safe split/join (see D16). **No** hand-rolled parser.
- `citekey.ts` — `composeCitekey()`, `generateUniqueCitekey(isTaken)`, `slugify()`. Author + 4-digit year + first significant title word, with `-2 -3 …` collision suffixes.
- `template.ts` — minimal `{{var}}` renderer for paper / note / daily-note templates.
- `path.ts` *(planned)* — helpers to safely concatenate vault paths, normalize trailing slashes.
- `debounce.ts` *(planned)* — generic debounce/throttle.

### 4.6 Styles (`src/styles/*.css`)

- `tokens.css` — CSS variables for colors/spacing (theme-aware via Obsidian CSS vars).
- `components.css` — buttons, badges, pill states.

---

## 5. Storage Schema

### 5.1 Plugin data (`saveData`)
```
{
  "version": "1",
  "projects": [Project, ...],
  "ai": AIConfig,
  "templates": { paper: string, note: string, dailyNote: string }
}
```
Top-level for simplicity. Versioned for forward migrations.

### 5.2 Per-project on disk
```
<folderPath>/
├── project.md          # Project metadata + status dashboard (human-readable)
├── papers/
│   └── <citekey>.md    # One file per paper
├── notes/
│   └── *.md            # Atomic / literature / concept notes
├── pdfs/
│   └── *.pdf           # Originals (optional)
└── literature/         # References + relations
```

### 5.3 Paper markdown shape
```yaml
---
citekey: smith2023transformer
title: "Attention Is All You Need"
authors: [{lastName: "Smith", firstName: "J."}, ...]
year: 2023
venue: "NeurIPS"
doi: "10.0000/xyz"
status: reading
priority: high
tags: [transformer, attention]
dateAdded: 1700000000000
dateModified: 1700000000000
projectId: <uuid>
---
```
Then body = rendered LiteratureNote sections.

---

## 6. Plugin Guideline Compliance Checklist

(All required for Obsidian community catalog acceptance.)

| Item | Where ensured |
|---|---|
| Default to local/offline | D14; only AI features are network, gated & documented. |
| No hidden telemetry | D15. |
| No remote code execution | No `eval`, no remote bundle. Build everything local. |
| Minimize vault scope | Only operations on user-chosen project folders. |
| Disclose external services | Settings tab + README clearly state "AI features send selected text to configured provider". |
| Respect privacy | AI requests scoped to user-selected context; never vault-wide unless explicitly enabled. |
| Clean DOM/listener/interval registration | `register*` helpers everywhere. |
| Sentence case UI, imperative CTAs, **bold** labels | Enforced in this plan's UI section mapping. |

---

## 7. Sprint Roadmap

### Sprint 1 — Foundation (THIS SPRINT)
Goal: plugin loads, projects can be created/switched, data persists. **Definition of done:** all items in §8 completed, build green.

### Sprint 2 — Papers & Reading
Goal: import papers, track status, capture quotes. Adds PaperService (manual import, link-only PDF import per `D27`, in-memory index, status transitions, quote append, deletion), CitekeyGenerator, PaperImportModal, QuoteCaptureModal, ProjectsSidebarView. **PDF text extraction deliberately deferred** — `D27` makes the import path a copy + wikilink to bypass `pdfjs-dist`'s incompatibility with the Obsidian plugin sandbox.

### Sprint 3 — Citations & Indexing
Goal: BibTeX export & in-text citations, vault search, semantic links between papers. Adds CitationManager, VaultIndexer, literature links editor command.

### Sprint 4 — AI (Tier 3)
Goal: chat, summarize, synthesize. Adds AIClient (all 4 providers), AIChatView, project-scope context, budget enforcement.

### Sprint 5 — Polish & Community
Goal: ready for community release. Docs, automated smoke tests (vitest for utils/services), GitHub Actions lint+build, beta testing via BRAT, gallery submission.

---

## 8. Sprint 1 — Detailed Task Breakdown

Each check below is a single, verifiable unit of work. Verify before moving on.

### Phase A — Types (must be done first)
- [ ] **A1.** Add `ProjectCreateConfig` to [`src/types/project.ts`](../src/types/project.ts) with `{ name, folderPath, description?, citationStyle?, paperTemplate? }`.
- [ ] **A2.** Create [`src/types/index.ts`](../src/types/index.ts) — barrel re-export of all types and const arrays (`READING_STATUSES`, `PRIORITIES`, `CITATION_STYLES`).
- [ ] **A3.** Verify: `npx tsc --noEmit` passes.

### Phase B — Utils + Core
- [ ] **B1.** Create [`src/utils/event-emitter.ts`](../src/utils/event-emitter.ts) — typed `EventEmitter<T>` with `on(event, cb)` returning unsubscribe, `emit(event, payload)`, `off(event, cb)`.
- [ ] **B2.** Create [`src/utils/uuid.ts`](../src/utils/uuid.ts) — `newId()` using `crypto.randomUUID()` with fallback.
- [ ] **B3.** Create [`src/core/plugin.ts`](../src/core/plugin.ts) with `ResearchVaultPlugin extends Plugin`:
  - public: `settings: ResearchVaultSettings`, `projectManager: ProjectManager`, `eventBus: EventBus`
  - `onload`: load settings → make `projectManager` → register ribbon with `library` icon → register commands (`create-project`, `switch-project`, `open-active-project`) → add `ResearchVaultSettingTab`.
  - `onunload`: nothing heavy needed at this stage; comment placeholder for future cleanup.
- [ ] **B4.** Rewrite [`src/main.ts`](../src/main.ts) to one-line: `export { ResearchVaultPlugin as default } from './core/plugin';`.
- [ ] **B5.** Verify: build succeeds, `main.js` exports a default class.

### Phase C — Settings
- [ ] **C1.** Overwrite [`src/settings.ts`](../src/settings.ts):
  - `ResearchVaultSettings { version, projects: Project[], ai: AIConfig, templates: { paper, note, dailyNote } }`
  - `DEFAULT_SETTINGS` with empty `projects`, sane AI defaults (`maxTokens: 4096`, `temperature: 0.7`, all feature toggles false).
  - Helper `migrateSettings(loaded)` for future compat.
- [ ] **C2.** Create [`src/ui/settings/settings-tab.ts`](../src/ui/settings/settings-tab.ts) — `ResearchVaultSettingTab extends PluginSettingTab`:
  - **General** section: default citation style, excluded folders global default.
  - **Projects** section: list projects with "Activate" / "Delete" buttons; "Create project" button → opens `CreateProjectModal`.
  - **AI** section: provider dropdown, model text, API key (password input), toggles with explanation that AI features send selected text to the provider.
  - **Templates** section: textareas bound to template strings (Sprint 2 will wire rendering).

### Phase D — ProjectManager (full implementation)
- [ ] **D1.** [`src/services/project-manager.ts`](../src/services/project-manager.ts):
  - Constructor `(private plugin: ResearchVaultPlugin)` — pulls `eventBus` from plugin.
  - `hydrate()`: pass through `plugin.settings.projects`; enforce single active invariant; emit initial `projectChanged` if there is one.
  - `createProject(config: ProjectCreateConfig): Promise<Project>`:
    1. Validate `folderPath` non-empty and not already a project root.
    2. Create vault folder if missing via `plugin.app.vault.createFolder(folderPath)`.
    3. Append new `Project` to `plugin.settings.projects`; persist via `plugin.saveSettings()`.
    4. Emit `projectChanged`.
  - `activateProject(id: string): Promise<void>` — toggle `isActive`, persist, emit.
  - `getActiveProject(): Project | null`.
  - `getAllProjects(): Project[]`.
  - `getProjectById(id): Project | undefined`.
  - `updateProject(id, updates)`, `deleteProject(id)`.
  - `getProjectStats(id: string): ProjectStats` — for Sprint 1 returns zeros + `lastActivity = project.updatedAt`. Sprint 2 will override.
  - `getProjectFiles(id)`, `getProjectPapers(id)` — filtered `app.vault.getMarkdownFiles()`.

### Phase E — Modal
- [x] **E1.** [`src/ui/modals/create-project-modal.ts`](../src/ui/modals/create-project-modal.ts):
  - `extends Modal`.
  - Inputs: name (text), folder path (text + "Suggest" button using `app.vault.getAllFolders()`).
  - On submit → `projectManager.createProject(...)`; close on success; `Notice` on error.
  - Reads citation style default from settings.
- [x] **E2.** [`src/ui/modals/confirm-modal.ts`](../src/ui/modals/confirm-modal.ts) — `ConfirmModal.ask(app, options): Promise<boolean>` wrapping `Modal`. Used wherever a destructive action requires confirmation. Replaces the browser `confirm()` (which trips `no-alert` and is unavailable in mobile WebViews). Destructive option renders the button with Obsidian's warning style.

### Phase F — Verification
- [x] **F1.** `npm run build` — exit 0; `main.js` emitted (~16 KB, default export `ResearchVaultPlugin`).
- [x] **F2.** `npm run lint` — exit 0; zero errors, zero warnings.
- [x] **F3.** `npx tsc --noEmit` — exit 0.

### Phase G — Manual smoke (documented in PR, not automated yet)
- [ ] Drop `main.js`, `manifest.json`, `styles.css` into a test vault's `.obsidian/plugins/researchvault/`.
- [ ] Plugin loads; ribbon shows a library icon; clicking it opens "no active project" notice.
- [ ] Settings → ResearchVault → "Create project" works, project appears in list, can be activated.
- [ ] Restart Obsidian — project still present, still active. ✅ Sprint 1 done.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Mobile WebView lacks `crypto.randomUUID()` fallback | UUID util has `Date.now() + Math.random()` fallback path; covered by `D8`. |
| `isDesktopOnly: false` + later desktop-only API slips in | Code review checklist per PR; lint rule is overkill, manual grep on `require('electron')` etc. |
| Settings schema breaks between versions | Top-level `version` field; `migrateSettings()` stubbed in `src/settings.ts` from Sprint 1 to make migrations explicit. |
| Bundle size creeps | Avoid heavy deps early; defer `citeproc` to Sprint 3. `AGENTS.md` reminder. |
| AI feature leaks vault-wide data | Every AI call requires explicit `paperIds`/`projectScope` — enforced by `AIRequest` type. |

---

## 10. Communication & Cadence

- Each sprint end → update `docs/README.md` with what shipped.
- Each major decision change → update this plan first, then code.
- Open questions logged in §11 below — resolved before the commit that depends on them.

---

## 11. Open Questions (resolve before blocking sprint)

| # | Question | Default if not answered |
|---|---|---|
| Q1 | Should the first project be auto-created on first launch? | **No.** Force user through Create flow; respects user agency. |
| Q2 | API key in plaintext OK? | **Yes**, with UI warning. Plugin guidelines allow; we will add a "Hide via env var" reading mechanism in a future sprint if users request. |
| Q3 | Cross-project search? | Sprint 3, after VaultIndexer. |

---

## 12. Sprint 1 Done = Sign-Off Criteria

- [x] All Phase A–G items checked.
- [x] `npm run build` — exit 0, `main.js` produced at root (16 KB).
- [x] `npm run lint` — exit 0, zero errors / zero warnings.
- [x] `npx tsc --noEmit` — exit 0.
- [x] `main.js` produced; `manifest.json` validated (`id: researchvault`, `version: 1.0.0`, `isDesktopOnly: false`).
- [x] This plan file committed.
- [x] `PROJECT_CONTEXT.md` updated to match this plan if they diverged (history kept).
- [ ] Phase G — manual smoke check executed against a test vault (documented in PR).

Addendum added during verification phase: **E2** — [`src/ui/modals/confirm-modal.ts`](../src/ui/modals/confirm-modal.ts) — reusable confirm modal; required because Obsidian's lint flags `confirm()`/`alert()` (`no-alert`) and mobile WebViews lack them entirely. Used by settings tab's project-delete button.

Ready to start Sprint 2 on user approval.

---

## 13. Living Log & Sign-Off

> **This is the rolling changelog.** Append a new entry at the *bottom* after every sprint (or sub-pass) ending the work. Don't delete history — when something is superseded, strike it through and add a pointer to the replacement.
>
> Structure of each entry: **What shipped** / **Verification** / **Known gaps** / **Files touched**. Verification cells link to the bash transcript when possible. The standing "in-progress" queue lives after the dated entries.

### In-progress / queued

| # | Task | Sprint | Notes |
|---|---|---|---|
| 2.2 | `PaperImportModal` — manual-only metadata form; preview derived citekey | 2 | **Shipped 2026-07-01 in sub-pass 2.2+2.5.** Modal lives at [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts). |
| 2.3 | `ProjectsSidebarView` — ItemView; lists papers in active project; status dropdown | 2 | **Shipped 2026-07-01 in sub-pass 2.2+2.5.** View lives at [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts). |
| 2.4 | `QuoteCaptureModal` — editorCallback on selection, attaches Quote to current paper | 2 | Uses `PaperService.addQuote` (already implemented). `quoteAdded` event now declared in [`src/core/events.ts`](../../src/core/events.ts). |
| 2.5 | Commands + ribbon — `add-paper`, `capture-quote`, `open-sidebar` | 2 | **Shipped 2026-07-01 in sub-pass 2.2+2.5** (sans `capture-quote`, which lands with 2.4). Ribbon re-bound to `openSidebar`. View registered as `VIEW_TYPE_RESEARCHVAULT_SIDEBAR`. |
| 2.6 | PDF import (browse / drag-drop + linked wikilink into paper note) | 2 | **Shipped 2026-07-12 as `PdfService` + `pdfjs-dist`, re-scoped 2026-07-13 to link-only per `D27`, and priority-fixed 2026-07-13 per `D28` (sub-pass 2.7.1).** Phase G click-through on the link-only build revealed that filling in `title` / `authors` / `year` *and* attaching a PDF still produced an `anon_<basename>_<uuid>` paper because the modal routed to `createFromPdf` first. The fix (see §13 sub-pass 2.7.1 entry + `D28`): `createManual` now accepts an optional `attachPdfFrom` and copies the PDF itself; the public `createFromPdf` is a private stub `throw`; submit always goes through `createManual` so the typed metadata is preserved verbatim. `pdfjs-dist` is still out (`D27`). |
| 2.manual-smoke | Drop plugin into a real vault, click through, document results in PR | 2 Phase G | **Click-through PASSED 2026-07-21 against the 2.8 + 2.8.1 combined 7-step checklist** (steps 1–6 from 2.8 — modal widths, drop-zone copy, `YYYY-MM-DD | HH:MM` dates, `dateModified` re-stamp, authors last-name list, sidebar search-focus; step 7 from 2.8.1 — Attached-PDF row layout reads clean: button alone in the control column, help text capped at 480 px below, drop zone full-width, `Linked PDF: …` info line clean). Step-7 severity-of-regression described in the §13 2.8.1 entry + the `## 2.8.1` design-doc section for future sub-passes that revisit the row. `data.json` snapshot is `data.json.pre-smoke.json`. Bundle for this run is the 2.8.1 build (main.js 88,190 B, styles.css 9.2 KB). |
| 2.8 | UI / data-format polish batch — modal width, drop-zone copy, `YYYY-MM-DD | HH:MM` dates, `dateModified` re-stamp on body edit, authors as YAML list of last-name strings | 2 | **Source-complete 2026-07-14.** lint / tsc / build / deploy all green. `main.js` 86.1 KB (+2 KB from 2.7.1). Manual click-through pending (2.8.smoke). Follow-up: 2.8.1 (Attached-PDF row squish fix) opened 2026-07-21. |
| 2.8.1 | Attached-PDF row squish fix — detach long help text + drop zone + path-info from the Setting row's control column, mount them on **`root`** as full-width siblings below the row | 2 | **Source-complete 2026-07-21.** lint / tsc / build / deploy all green; `main.js` 88,190 B (+2.0 KB from 2.8; -38 B back off the first cut when the unused `pdfSetting` binding was dropped — lint caught it via `@typescript-eslint/no-unused-vars`). Manual click-through merged into 2.8.smoke (now a 7-step checklist). ⚠ Second-cut patch supersedes the first-cut `pdfSetting.settingEl.createDiv` attempt — root-mount on the modal content element was the load-bearing change. Iteration log + corrected surface in the dated entry in §13 below. |
| 2.9 | Sidebar filter chip row (status / priority / year / hasPdf / hasNotes) + author autocomplete + saved filter state per project | 2 | **Planned, not started.** Detailed phase plan in §14 below. Pairs with the existing 2.8.Sidebar split-render refactor. |
| 3.x | `CitationManager` (BibTeX emit, in-text cite insertion), `VaultIndexer` + `fuse.js`, literature-graph edges | 3 | Citeproc deferred until Sprint 3 follow-up. |
| 4.1 | `CitationService` + `D29` (DOI lookup MVP: CrossRef primary, OpenAlex fallback, opt-in, LRU cache, rate limiter, modal Lookup + Search-by-title affordances) | 4 | **Sub-pass 4.1.A SHIPPED 2026-07-22** (lint 0, tsc 0, build +4,157 B over 2.8.1's 88,190 B baseline). Locked-preferences deliverable lives in [`plans/citation-lookup-research.md`](./citation-lookup-research.md) §7. Three blocking answers captured 2026-07-22 (Q1: CrossRef primary / OpenAlex free-text; Q2: polite-pool OFF by default; Q3: DOI + title + query in 4.1.A; arXiv / ISBN / PMID in 4.1.1). **Sub-pass 4.1.B SHIPPED 2026-07-22** (lint 0, tsc 0, build +13,493 B over 4.1.A's 92,347 B baseline → 105,840 B total). Real `fetch` calls + LRU + token-bucket + OpenAlex native→CSL mapper now live; 12 B-prefs enforced; rate-limit tuning still pending 4.1.E manual smoke. Full scope in the §13 dated entry below + design doc §8. **Sub-passes 4.1.C+D SHIPPED 2026-07-25** (drift audit caught 3 spec drifts, fixed). **Sub-passes 4.1.E+F+G SHIPPED 2026-09-27**: smoke PASSED (4 findings fixed, 2 UX polish passes), bundle gate measured at 2.9x the 7 KB budget and trimmed (-493 B), README endpoint disclosure landed. main.js 115,153 B. **Next:** 4.1.1 (generic CSL-JSON paste). Pairs with `D30` for the larger citation story. **Note:** sub-pass 4.1.A re-surfaced two stale items in the §14 row: (a) `Paper.url?` already exists on [`src/types/literature.ts:21`](../src/types/literature.ts) — only `oaUrl?` is a new field; (b) the current `migrateSettings` ([`src/settings.ts:95`](../src/settings.ts)) is a spread-merge, so the `citation` block is a default-fill, not a versioned migration. Both corrections are recorded as L1 and L3 in the design doc §7.2. |
| 4.x | `AIClient` real provider wiring, `AIChatView`, budget enforcement | 4 | Currently still `notImplemented`. |
| 5.1 | Zotero web API read-in (`ZoteroClient` + `D30` layer a) | 5 | **Planned, not started.** Sub-pass design covered in [`plans/citation-lookup-research.md`](./citation-lookup-research.md). Deprioritised below 4.1 because it's a bigger surface (auth + settings block + collection mapping) and depends on a stable `CitationService` to do the CSL→Paper conversion. |
| 5.2 | Zotero local API push-back (`ZoteroLocalClient` + `D30` layer b, desktop only) | 5 | **Planned, not started.** `127.0.0.1:23119` probe; "Push to Zotero" sidebar action; "Zotero is offline" fallback. |
| 5.3 | Zotero + official-plugins coexistence section in settings (`D30` layer c) | 5 | **Planned, not started.** Settings-tab link-out to `Zotero Integration` and `obsidian-zotero-desktop-connector`. Zero new code; ships when the Zotero work in 5.1 lands. |
| 5.x | Vitest for utils/services, GitHub Actions lint+build, BRAT beta, gallery submission | 5 | Polish & community release. |

### Sprint 2 — Sub-pass 2.1 (ended 2026-07-01)

**What shipped**
- Foundation utils (all zero-dep):
  - [`src/utils/citekey.ts`](../src/utils/citekey.ts) — `composeCitekey()`, `generateUniqueCitekey(isTaken)`, exported `slugify()`. Author + 4-digit-year + first significant title word, with `-2 -3 …` collision suffixes (per `D7`).
  - [`src/utils/frontmatter.ts`](../src/utils/frontmatter.ts) — `splitFrontmatter` / `joinFrontmatter` wrapping Obsidian's `parseYaml` / `stringifyYaml`. **No** hand-rolled YAML parser (see `D16`).
  - [`src/utils/template.ts`](../src/utils/template.ts) — `{{var}}` renderer; empty-string fallback for missing keys; unknown tokens left in place so typos surface.
- [`ProjectManager`](../src/services/project-manager.ts) extended (no breaking changes):
  - `getProjectPapersFolder(projectId)` → `<project>/papers`.
  - `ensureProjectFolders(projectId)` → idempotent create of `papers/`, `notes/`, `literature/`, `pdfs/`. Returns a `ProjectFolders` shape.
  - New exported types: `ProjectFolders` (re-export internals consistent with §4.2).
- [`PaperService`](../src/services/paper-service.ts) is now real (608 lines):
  - In-memory index (`byId` + reverse `citekeyToId`) hydrated from disk on `plugin.onload`.
  - `createManual(input, projectId)` → ensures folders → resolves citekey → writes file with rendered template body → emits `paperImported`.
  - `updatePaper`, `updateStatus` (emits both `paperImported` + `paperStatusChanged`), `addQuote` (appends to body, preserves existing), `getById`, `getByCitekey`, `getInProject`, `getNoteContent`, `deletePaper` (uses `fileManager.trashFile` per `D17`).
- [`ResearchVaultPlugin.onload`](../src/core/plugin.ts) now instantiates `PaperService` post-`ProjectManager` and lazy-hydrates so ribbon / commands stay responsive.
- `npm run build`, `npm run lint`, `npx tsc --noEmit` — all `exit 0`.

**Verification**
- `npm run build` — exit 0; `main.js` regenerated.
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.

**Known gaps (deferred — tracked above)**
- `PaperImportModal`, `ProjectsSidebarView`, `QuoteCaptureModal` don't exist yet → `PaperService.createManual` is unreachable from the UI today.
- `PaperService.createFromDoi`, `createFromPdf`, `importBibtex`, `exportBibtex`, `addCitation`, `addRelated`, `findCitationsInPdf`, `extractQuotesFromPdf`, `updateReadingProgress` still throw `notImplemented` (per the lean decision).
- `PdfService` + `pdfjs-dist` not installed; bundle hasn't grown.
- Manual smoke (`Phase G`) still not run against a real vault.

**Files touched / added**
- Added: [`src/utils/citekey.ts`](../src/utils/citekey.ts), [`src/utils/frontmatter.ts`](../src/utils/frontmatter.ts), [`src/utils/template.ts`](../src/utils/template.ts).
- Modified: [`src/services/paper-service.ts`](../src/services/paper-service.ts) (rewritten), [`src/services/project-manager.ts`](../src/services/project-manager.ts) (folder methods added), [`src/core/plugin.ts`](../src/core/plugin.ts) (PaperService wiring), [`plans/plan.md`](../plans/plan.md) (this log plus §3 D16/D17 + §4.2 status).

**Architectural decisions added this sub-pass**
- `D16` — Frontmatter read/write through Obsidian's built-in `parseYaml`/`stringifyYaml`. No hand-roll.
- `D17` — Paper notes deleted via `fileManager.trashFile()` to honor the user's "Deleted files" preference.

**Looking ahead**
- Sub-pass 2.2 (manual `PaperImportModal` + sidebar view + quote capture) is the obvious next chunk — it makes everything in 2.1 actually reachable from the UI. Pdf-text will arrive at 2.6 to keep the lean-PR shape from holding up the UI work. Detailed phase plans and the README source draft live one scroll below in §14 and §15.

---

### Sprint 2 — Sub-pass 2.2+2.5 (ended 2026-07-01)

**What shipped**
- [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) — manual paper import form: active project dropdown, title/author/year/journal/DOI/abstract/tags/PDF path/status/priority/explicit citekey fields; live citekey preview via `generateUniqueCitekey`; submit calls `paperService.createManual`.
- [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — right-rail `ItemView` listing papers in the active project, grouped by status (reading/skimming/annotating/queued/unread/summarized/synthesized/archived/excluded), with inline status dropdown per paper.
- [`src/core/plugin.ts`](../../src/core/plugin.ts): added `openAddPaperModal()` and `async openSidebar()`. Ribbon re-bound to `openSidebar` (no longer opens the active project's folder). Registered view as `VIEW_TYPE_RESEARCHVAULT_SIDEBAR`. Added commands: `add-paper`, `open-sidebar`.
- [`src/core/events.ts`](../../src/core/events.ts): added `quoteAdded: { paper: Paper; quote: Quote }` event (prep for 2.4).

**Verification**
- `npm run build` — exit 0; `main.js` regenerated at ~37 KB.
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.

**Known gaps (deferred — tracked above)**
- `QuoteCaptureModal` doesn't exist yet → `PaperService.addQuote` is still unreachable from the UI today.
- `PdfService` + `pdfjs-dist` not installed; bundle hasn't grown.
- Manual smoke (`Phase G`) still not run against a real vault.

**Files touched / added**
- Added: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts).
- Modified: [`src/core/plugin.ts`](../../src/core/plugin.ts) (sidebar + add-paper wiring), [`src/core/events.ts`](../../src/core/events.ts) (`quoteAdded` event).

**Architectural decisions added this sub-pass**
- None new — all decisions from 2.1 still hold.

**Looking ahead**
- Sub-pass 2.4 (`QuoteCaptureModal`) is the obvious next chunk — it makes `PaperService.addQuote` reachable and completes the manual paper workflow (import → read → quote). Detailed phase plans live in §14.

---

### Sprint 2 — Sub-pass 2.4 + 2.recon (ended 2026-07-10)

**What shipped**
- [`src/ui/modals/quote-capture-modal.ts`](../../src/ui/modals/quote-capture-modal.ts) — selection → quote modal wired through `editorCallback`. Form fields: paper picker (default = most-recent import in active project), page number, section, tags, plus a new free-form `note` field for long-form commentary. Submit calls `paperService.addQuote` with `source: 'editor'` and emits `quoteAdded`. Outside editor + active selection + active project, the command no-ops with a `Notice` listing the missing precondition.
- [`src/types/literature.ts`](../../src/types/literature.ts) — added `QuoteSource = 'editor' | 'pdf' | 'manual'`, optional `source` and `locator` fields on `Quote`, and a `QuoteInput` write-side alias.
- [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — `addQuote` default-fills `source: 'editor'` for legacy callers; `extractQuotesFromPdf` stamps `source: 'pdf'` on every emitted quote; `renderQuoteSection` appends a `-- source: …` footer line when `quote.source` is set.
- [`src/core/plugin.ts`](../../src/core/plugin.ts) — `openQuoteCaptureModal` accepts an optional `source?: QuoteSource`, and the `capture-quote` command passes `{ selectedText, source: 'editor' }`.
- [`src/types/index.ts`](../../src/types/index.ts) — re-exports `QuoteSource`, `QuoteInput`, and a new `QUOTE_SOURCES` tuple for guarded dropdowns.

**Verification**
- `npm run build` — exit 0; `main.js` regenerated, no size regression from 2.2+2.5.
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.

**Drift from §14 (deliberate)**
- §14 originally specified a `commentary` textarea on the modal and a `source` field on `Quote`. Recon pass kept `tags` for discoverability (works with property-based Dataview today) and renamed the high-volume prose field to `note`; the `source`-as-editor-stamp wiring still threads through as designed.

**Looking ahead**
- Tier 2 next: `VaultIndexer` (3.1 — fuse.js index over titles + frontmatter), then `CitationManager` (3.2 — editorCallback + per-project `.bib` export), then literature-graph edges (3.3).

---

### Sprint 3 — Sub-pass 3.1 (VaultIndexer + sidebar filter, ended 2026-07-10)

**What shipped**
- [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) — `fuse.js` v7 wired in. Public surface kept stable (`hydrate`, `searchPapers`, `addToIndex`, `removeFromIndex`, `updateIndex`); stubs `searchNotes` / `findUnlinkedMentions` / `getCitationGraph` / `getRelatedPapers` / `getChunksForPaper` / `getProjectContext` remain `notImplemented` for 3.2 / 3.3 / 4.x follow-ups. Weights: title 0.4, authors 0.2, keywords 0.2, quoteSnippets 0.1, citekey 0.05, venue 0.05. Threshold 0.35, `ignoreLocation: true`, `minMatchCharLength: 2`.
- Indexer subscribes to the typed EventBus (`paperImported`, `paperStatusChanged`, `quoteAdded`) and emits a new `indexUpdated: { count: number }` event after every incremental update.
- [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — search input added to the header (80 ms debounce). While the query is non-empty, status grouping collapses to a single "Results" bucket (no status dropdown per row, just a spacer to keep titles aligned). Listens to `indexUpdated` so a mid-typing quote capture still refreshes the result set.
- [`src/core/plugin.ts`](../../src/core/plugin.ts) — instantiates `VaultIndexer` after `PaperService` (depends on `getAll()`); calls `hydrate()` in `onload`, `dispose()` in `onunload`.
- [`src/core/events.ts`](../../src/core/events.ts) — added `indexUpdated: { count: number }` to the event union.
- [`package.json`](../../package.json) — added `fuse.js@^7.0.0` (resolves to 7.4.2) under `dependencies`.
- [`scripts/deploy-to-obsidian.mjs`](../../scripts/deploy-to-obsidian.mjs) — added during 2.4 deploy; `eslint.config.mts` now ignores `scripts/**` so the typed `obsidianmd` rule no longer errors on plain `.mjs` files.

**Verification**
- `npm run build` — exit 0; `main.js` 43.1 KB → 73.6 KB (+30.5 KB; fuse.js + indexer + sidebar code).
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.

**Known gaps (deferred)**
- Graph / AI / note-body search remain `notImplemented` stubs — they belong to 3.3 (literature-graph edges) and 4.x (`AIClient` + `AIChatView`).
- Filter UI: only text search is wired today; status / tag / year filter chips are a follow-up so we don't over-scope the 3.1 boundary.
- Highlighting in result rows is deferred to 5.x polish.

**Files touched / added**
- Added: `scripts/deploy-to-obsidian.mjs` (2.4 wrap-up, used by `npm run deploy:build`).
- Modified: [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts), [`src/core/events.ts`](../../src/core/events.ts), [`src/core/plugin.ts`](../../src/core/plugin.ts), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`eslint.config.mts`](../../eslint.config.mts), [`package.json`](../../package.json), [`plans/plan.md`](../../plans/plan.md).

**Architectural decisions added this sub-pass**
- `D18` — In-memory index rebuilt lazily from `paperService.getAll()`; no on-disk persistence. Expected paper count per project (dozens to a few hundred) keeps rebuild cost under 50 ms. Re-evaluate if/when Zotero sync (post-Sprint 5) pushes counts past 5k.
- `D19` — Fuse.js as the search library (MIT, ~12 KB minified, zero deps, browser-safe). No bundler work needed.

**Looking ahead**
- Sub-pass 3.1a (sidebar polish): reorder the search input to the top of the sidebar header, add a color/typography hierarchy to status groups, surface a red "Needs action" group at the top of the list. See §14 (3.1a).
- Sub-pass 3.2: `CitationManager` — `insertCitation` `editorCallback` + per-project `.bib` export. Decision: hand-rolled BibTeX serializer (no new dep).
- Sub-pass 3.3: literature-graph edges — per-project JSON file in `<project>/literature/`.

---


### Sprint 3 — Sub-pass 3.1a (Sidebar polish — search reorder + color hierarchy + Needs-action group, planned 2026-07-11)

**Goal**
Make the existing sidebar scannable at a glance by giving the search input a stable top position, giving the per-status groups real visual hierarchy, and surfacing the papers that actually need the user's attention in a single red group at the top.

**Scope (in)**
- Reorder `renderHeader()` in [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) so the layout reads top-to-bottom: project name + switch button → full-width search input (sticky) → full-width "Add paper" button. No new types, no new services, no new settings.
- Add a status color palette + typography scale in [`styles.css`](../../styles.css) under a new sidebar block. Tokens lean on Obsidian's own variables so dark / light / custom themes keep working. Palette (one swatch per status, used as left-border + small dot next to heading text):
  - `unread` → `var(--text-muted)`
  - `queued` → `var(--interactive-accent)`
  - `skimming` → `#d4a017`
  - `reading` → `#e07b39`
  - `annotating` → `#9b6dd7`
  - `summarized` → `#3fa672`
  - `synthesized` → `#2a8a8a`
  - `archived` → `var(--text-faint)` (also reduced opacity)
  - `excluded` → `var(--text-faint)` + strikethrough
- Render a virtual "Needs action" group **before** the per-status groups, using a red accent (`#d23f3f`). The group is a *derived* view, not a stored field, and is empty (collapsed) when no papers match.
- Typography: project name `1.1em / 600`, group headings `0.95em / 600` with 3 px left border in the status color, paper-row titles `0.85em`. Search input matches the height of the Add Paper button.
- Empty-state copy: groups with zero papers render no header; the existing "No papers in this project" / "No papers match …" messages are kept verbatim.

**'Needs action' definition (locked)**
A paper lands in the "Needs action" group when any of:
- `paper.priority === 'critical'`, OR
- `paper.status in {'reading', 'skimming', 'annotating'}`, OR
- (`paper.status in {'skimming', 'annotating'}`) AND the paper has been sitting in that status for more than **14 days** (staleness rule).

The 14-day threshold is a `const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000` near the top of the sidebar view. Staleness is measured against `paper.dateModified` (proxy for "last time the user touched this paper"). Promoted to a setting only if/when it earns its keep.

**Sort order inside the group**
1. Priority weight: `critical` (3) > `high` (2) > `medium` (1) > `low` (0).
2. Within a priority bucket: stale (≥ 14 days in `skimming` / `annotating`) first, then most-recently updated.
3. Ties broken by title (`localeCompare`).

**Out of scope (deferred)**
- Quick-action "→ next" / "skip" buttons per row (deferred to sub-pass 3.1b once we've reacted to the polish).
- "Was this relevant?" prompt after marking a paper read (sub-pass 3.1b).
- Research stages (intake / synthesis) — derived project stage + optional `Project.stage` override (sub-pass 3.1c).
- Per-project homepage note (deferred to 4.x or 5.x).

**Architectural decisions added this sub-pass**
- `D20` — "Needs action" is a derived group, not a stored field. Derivation lives in the sidebar view; no new column on `Paper` and no new event on the bus.
- `D21` — Status color palette lives in `styles.css`, not inline, so users can theme them in one place later.

**Verification gates**
- `npm run build` — `exit 0`; `main.js` size delta under +2 KB (pure CSS + small render helper).
- `npm run lint` — `exit 0`.
- `npx tsc --noEmit` — `exit 0`.
- `npm run deploy:build` — succeeds; manual smoke in the test vault confirms: search input is at the top, status headings are larger and bordered, "Needs action" group renders red at the top with at least one paper from a populated project, and is hidden when empty.

**Files touched**
- Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (reorder `renderHeader`, new `computeNeedsAction` + `sortNeedsAction` helpers, sorted "Needs action" group rendered ahead of `STATUS_ORDER`), [`styles.css`](../../styles.css) (new sidebar block), [`plans/plan.md`](../../plans/plan.md) (this entry).

### Sprint 3 — Sub-pass 3.1b (Sidebar row polish + live sync + data formats, ended 2026-07-11)

**What shipped**
- **Citekey separator pinned (`D22`).** [`composeCitekey`](../../src/utils/citekey.ts:35) uses underscore as the word separator. Existing in-vault citekeys (already `smith_2024_transformer` style from earlier passes) keep working unchanged — no rename pass, no link breakage.
- **Date format pinned (`D24`).** [`src/utils/format-date.ts`](../../src/utils/format-date.ts) (new): `formatPaperDate(input, { withTime? })` renders ISO date+time strings as `Jul 11, 2026` or `Jul 11, 2026, 14:30`. Accepts string / number / Date / null. Backward-compat parser inside `fromFrontmatterDate` handles legacy epoch-ms values.
- **Live vault sync (`D23`).** [`PaperService`](../../src/services/paper-service.ts) gained `syncFromFile(file)` (re-read frontmatter, emit `paperUpdated`), `dropFromIndex(paperId)` (emit `paperRemoved`), and ISO date round-trip in `toFrontmatter` / `frontmatterToPaper`. `dateModified` is bumped on every `updatePaper` call and on sync.
- **New events.** [`src/core/events.ts`](../../src/core/events.ts) added `paperUpdated: { paper: Paper }` and `paperRemoved: { id: string; path: string }` to the typed event union.
- **Edit modal (`D25`).** [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts) now accepts an optional `paperToEdit: Paper`. When present, every form field seeds from the paper, banner reads "Edit paper", citekey field is disabled + greyed out, and submit routes through `paperService.updatePaper(...)` instead of `createManual(...)`.
- **Sidebar row redesign.** [`ProjectsSidebarView`](../../src/ui/views/projects-sidebar-view.ts) rows now render a fixed three-line layout: title + edit pencil (line 1), citekey · year (line 2), status dropdown + priority dropdown + quote glyph (line 3), plus an `Added Jul 11, 2026, 14:30` date line. The icon column stays on the right edge so group toggling never causes layout shifts.
- **Plugin vault subscriptions.** [`src/core/plugin.ts`](../../src/core/plugin.ts) subscribes to `vault.on('modify')`, `vault.on('rename')`, and `vault.on('delete')` inside shared `registerEvent(...)` helpers; writes we perform don't loop back because `papersEqual(prev, next)` short-circuits identical content.
- **CSS.** [`styles.css`](../../styles.css) gained the new row layout styles (fixed-width wrappers, two-line title/citekey block, date line).

**Architectural decisions added this sub-pass**
- `D22` — Citekey separator is underscore (`_`), pinned to [`composeCitekey`](../../src/utils/citekey.ts:35). Stable so across-run citekeys look natural and downstream `[[links]]` stay valid.
- `D23` — Live sync is owned by `PaperService` (one subsystem has the smarts), but the event subscription lives on the plugin so it tears down automatically with `onunload`. Both `paperService` and the EventBus keep the same `EventEmitter` API surface.
- `D24` — `Paper.dateAdded / dateModified` stay `number` internally; the YAML round-trip is the only place that speaks ISO strings. This keeps the in-memory index free of string parsing and prevents a 35+ file type ripple.
- `D25` — Edit modal is the same modal as import (one component, two modes). Citekey is locked in edit mode — the only way to rename a paper is to rename the markdown file in the vault itself, after which the new path is picked up by the live-sync handler. This keeps `[[smith_2024_transformer]]` style links valid indefinitely.

**Verification gates**
- `npx tsc --noEmit` — exit 0.
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npm run build` — exit 0; `main.js` regenerated at ~81 KB (+~8 KB from 3.1a).
- `npm run deploy:build` — succeeds; artifacts copied to test vault.
- Manual smoke (in the test vault): typing into a paper markdown file's frontmatter shows up in the sidebar within a beat; renaming a paper markdown file updates the index without a sidebar reopen; the edit modal opens with the citekey field visibly disabled; the date line renders `Added Jul 11, 2026, 14:30` for a paper with `dateAdded: 2026-07-11T14:30:00` in its frontmatter.

**Known gaps (deferred)**
- Quick-action "→ next" / "skip" buttons per row — deferred to a future 3.1c pass once we have usage data on whether inline status dropdowns are enough.
- "Was this relevant?" prompt after marking a paper read — same reason.
- Research stages (intake / synthesis) — tier 4 work, untouched.

**Files touched**
- Added: [`src/utils/format-date.ts`](../../src/utils/format-date.ts).
- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`src/services/paper-service.ts`](../../src/services/paper-service.ts), [`src/core/plugin.ts`](../../src/core/plugin.ts), [`src/core/events.ts`](../../src/core/events.ts), [`styles.css`](../../styles.css), [`plans/plan.md`](../../plans/plan.md).

### Sprint 3 — Sub-pass 3.1b (Sidebar row polish + live sync + data formats, ~~planned 2026-07-11~~ → shipped 2026-07-11)

**Goal**
Turn the sidebar from a passive paper list into a workflow tool: every paper row exposes what the user acts on (status, priority, capture quote, edit) inline, edits made anywhere else in the vault propagate back to the sidebar without a reload, and the on-disk data formats (citekey separators, date strings) are pinned down so future passes have stable contracts.

**Scope (in)**
- **Citekey separator (D22).** All newly-generated citekeys use underscores: `smith_2024_transformer`. The compose/unique-suffix helpers in [`src/utils/citekey.ts`](../../src/utils/citekey.ts) are the single source of truth; the on-disk `slugify` rules match them. Existing in-vault citekeys (already `smith_2024_transformer` style from earlier passes) keep working unchanged — we never rename a paper's citekey unless the user explicitly edits it.
- **Date format (D24).** Dates are persisted to frontmatter as ISO date+time strings (e.g. `dateAdded: 2026-07-11T14:30:00`). The in-memory `Paper.dateAdded` / `Paper.dateModified` fields stay as epoch `number` — only the YAML boundary does the conversion. UI surfaces always render via the new [`formatPaperDate`](../../src/utils/format-date.ts) helper, which defaults to `Jul 11, 2026` and gains `{ withTime: true }` → `Jul 11, 2026, 14:30`. Legacy papers with epoch-ms dates (`dateAdded: 1717872000000`) keep loading thanks to a backward-compat parser inside `fromFrontmatterDate`.
- **Live vault sync (D23).** The plugin subscribes to three vault events inside the shared `registerEvent(...)` helpers:
  - `vault.on('modify', file)` → re-read the frontmatter, emit `paperUpdated` on the bus (or `paperRemoved` if the frontmatter no longer parses as a paper).
  - `vault.on('rename', file, oldPath)` → update the internal index by path.
  - `vault.on('delete', file)` → drop from the index, emit `paperRemoved`.
  Idempotency guarantee: writes we ourselves perform don't loop back into the sidebar because `papersEqual(prev, next)` short-circuits identical content.
- **Edit modal (D25).** `PaperImportModal` now accepts an optional `paperToEdit: Paper` parameter. When present, it seeds every form field from the paper, changes the modal banner to "Edit paper", disables + greys out the citekey field (citekeys are stable so existing `[[links]]` keep working), and the submit button reads "Save changes" + routes through `paperService.updatePaper(...)` instead of `createManual(...)`. The sidebar exposes the entry point via a small inline pencil icon on every row.
- **Sidebar row redesign.** Every paper row, regardless of which group it lives in (status / Results / Needs-action), now renders the same fixed shape:
  - **Line 1:** paper title (truncated, monospaced-friendly fallback) + small edit pencil icon (right).
  - **Line 2:** monospace citekey + middle-dot + 4-digit year + (Needs-action only) a small red reason chip on the right.
  - **Line 3:** inline status dropdown + inline priority dropdown + capture-quote glyph (right).
  - **Date line:** `Added Jul 11, 2026, 14:30` rendered with `formatPaperDate(..., { withTime: true })`.
  The icon column is always on the right edge so toggling between groups never causes layout shifts.

**Architectural decisions added this sub-pass**
- `D22` — Citekey separator is underscore (`_`), pinned to [`composeCitekey`](../../src/utils/citekey.ts:35). Stable so across-run citekeys look natural and downstream `[[links]]` stay valid.
- `D23` — Live sync is owned by `PaperService` (one subsystem has the smarts), but the event subscription lives on the plugin so it tears down automatically with `onunload`. Both `paperService` and the EventBus keep the same `EventEmitter` API surface.
- `D24` — `Paper.dateAdded / dateModified` stay `number` internally; the YAML round-trip is the only place that speaks ISO strings. This keeps the in-memory index free of string parsing and prevents a 35+ file type ripple.
- `D25` — Edit modal is the same modal as import (one component, two modes). Citekey is locked in edit mode — the only way to rename a paper is to rename the markdown file in the vault itself, after which the new path is picked up by the live-sync handler. This keeps `[[smith_2024_transformer]]` style links valid indefinitely.

**Out of scope (deferred)**
- Quick-action "→ next" / "skip" buttons per row (still deferred — moves to a future 3.1c pass once we have usage data on whether inline status dropdowns are enough).
- "Was this relevant?" prompt after marking a paper read (still deferred — same reason).
- Research stages (intake / synthesis) — tier 4 work, untouched.

**Verification gates**
- `npx tsc --noEmit` — `exit 0`.
- `npm run lint` — `exit 0`.
- `npm run build` — `exit 0`.
- `npm run deploy:build` — succeeds.
- Manual smoke (in the test vault): typing into the paper markdown file's frontmatter shows up in the sidebar within a beat; renaming a paper markdown file updates the index without a sidebar reopen; the edit modal opens with the citekey field visibly disabled; the date line renders `Added Jul 11, 2026, 14:30` for a paper with `dateAdded: 2026-07-11T14:30:00` in its frontmatter.

**Files touched**
- Added: [`src/utils/format-date.ts`](../../src/utils/format-date.ts) (new `formatPaperDate` + ISO conversion helpers).
- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (accept `PaperImportOptions`, branch submit on edit vs create, disable citekey field in edit mode), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (new three-line row layout, `changePriority` helper, event-bus subscriptions for `paperUpdated` + `paperRemoved`), [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (ISO date round-trip, new live-sync methods `syncFromFile` / `dropFromIndex` / `pathChanged`, dedup helpers `papersEqual` + `authorsEqual` + `keywordsEqual`), [`src/core/plugin.ts`](../../src/core/plugin.ts) (vault event subscriptions + new `openEditPaperModal(paper)`), [`src/core/events.ts`](../../src/core/events.ts) (added `paperUpdated` + `paperRemoved` events), [`styles.css`](../../styles.css) (new row CSS), [`plans/plan.md`](../../plans/plan.md) (this entry + decision edits).

---

### Sprint 2 — Sub-pass 2.6 (PdfService + pdfjs-dist install + paper-import modal wiring, shipped 2026-07-12)

> **Superseded 2026-07-13 by sub-pass 2.7 (`D27`).** The pdfjs-dist-based `createFromPdf` described below could not run inside Obsidian's plugin sandbox (`pdfjs-dist@4.x` calls `process.getBuiltinModule(...)` at module load, which the sandbox does not provide). `PdfService` and the worker asset were deleted; `createFromPdf` is now a link-only importer. See the `### Sprint 2 — Sub-pass 2.7 (PDF import re-scoped to link-only, shipped 2026-07-13)` entry below for the current behaviour.

**What shipped** *(historical — see supersession note above)*
- Bundled [`pdfjs-dist@4.x`](../../package.json) (URL copied to top-level asset [`pdf.worker.min.mjs`](../../pdf.worker.min.mjs); Obsidian loads it via the worker's `GlobalWorkerOptions.workerSrc` from the plugin folder rather than as a webpack-style bundle). Bundle delta sits at roughly **+~500 KB minified** for the worker file plus ~50 KB for the parser entry — well under Obsidian's per-plugin budget.
- [`src/services/pdf-service.ts`](../../src/services/pdf-service.ts) is now reachable from the UI:
  - `extractFullText(buffer) → string` (joins per-page text with `\f` form-feeds).
  - `extractQuotesByPage(buffer)` and `getPageCount(buffer)` remain available for the next pass.
- [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — `createFromPdf(pdfPath, projectId)` is now real: pulls bytes from the chosen vault PDF → calls `PdfService.extractFullText` → splits on `\f`, wraps each page in `### Page N`, truncates per-page output at 5000 chars → renders the same paper template as `createManual` and writes `<project>/papers/<citekey>.pdf` adjacent to the markdown (vault folder ensured by `ProjectManager`).
- [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts):
  - New PDF-import row: a **Browse vault…** button + drag-and-drop zone replacing the old free-form `pdfPath` text input.
  - Drops are routed through `copyPdfIntoVault(file)` which targets `<project>/papers/`, ensures the folder exists, and uses `vault.createBinary(targetPath, file.arrayBuffer())`.
  - Vault PDF picker is a small sub-modal (in-file `PdfPickerModal`) listing every `*.pdf` in the vault alphabetically.
  - Submit now branches three ways: **edit** (still calls `updatePaper`), **PDF** (calls `createFromPdf`), **manual** (existing `createManual` with title/author validation). PDF branch shows a "ResearchVault: pick a PDF before importing." notice on missing path; success shows `ResearchVault: imported "<citekey>" from PDF.`.
- [`styles.css`](../../styles.css) — appended a section "Paper import modal — PDF picker (2.6)" with styles for the browse button (`researchvault-pdf-browse-btn`), drop zone (`researchvault-pdf-drop-zone` + `--active` hover state), selected-path info line, picker list + rows + path text.

`PdfService` and `createFromPdf` are kept **desktop-only** for this pass (see `D26`); mobile (WebView / iOS / Android) will get a smaller worker shim once Obsidian's mobile PDF story stabilises — see §9.

**Architectural decisions added this sub-pass**
- `D26` — **PDF import is desktop-only for the current pass.** Worker file is shipped as a top-level asset (`pdf.worker.min.mjs`) rather than bundled into `main.js`. Mobile support deferred until a worker shim is available; tracked in §9.

**Verification**
- `npm run build` — exit 0; `main.js` regenerated, worker asset present at repo root.
- `npm run lint` — exit 0; zero errors / zero warnings (`Sentence-case` accepted `PDF` as a proper noun; CFB-free async handlers via `void promise.then(...)` wrappers).
- `npx tsc --noEmit` — exit 0.

**Manual smoke (deferred to 2.manual-smoke — Phase G)**
- Drag a small test PDF onto the drop zone; confirm it lands under `<project>/papers/`, the modal populates the selected path line, and pressing Add Paper yields a markdown note whose first body section lists `### Page 1` …
- Click Browse vault…, pick an existing `Foo.pdf`, confirm the note ends up at the chosen citekey with `pdfPath` matching the vault-relative path.
- Re-open the same paper via the edit pencil; PDF row should not interfere with title/author status round-trip.

**Files touched / added**
- Added: [`pdf.worker.min.mjs`](../../pdf.worker.min.mjs) (top-level worker asset, copied from `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` at build time).
- Modified: [`package.json`](../../package.json) (dev-dep `pdfjs-dist`), [`esbuild.config.mjs`](../../esbuild.config.mjs) (copy worker to vault top level), [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (real `createFromPdf`, `buildPdfBody` helper), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (PDF row, drop zone, vault picker, submit branch), [`styles.css`](../../styles.css) (PDF picker section), [`plans/plan.md`](../../plans/plan.md) (this entry + `D26`).

---

### Sprint 2 — Phase G — manual smoke (first deployed 2026-07-12, re-deployed 2026-07-13 with the 2.7 link-only build; awaiting human click-through)

This is the **first end-to-end exercise** against a real Obsidian vault since the **Tier 2 + 3.1b + 2.6** features landed. The checkpoint resolves the lone unchecked box in §12 ("Phase G — manual smoke check executed against a test vault") and the queued row `2.manual-smoke` in §13 / §14. **Re-deployed 2026-07-13 with the `D27` link-only PDF importer.** Steps 8–9 below reflect the 2.7 behaviour; the 2.6 text-extraction expectation on step 8 has been retired.

**Deploy (automated — done 2026-07-12, re-done 2026-07-13)**
- `npm run lint` — exit 0, zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0; `main.js` regenerated.
- `node scripts/deploy-to-obsidian.mjs` → copied to `/Users/justinboeringa/Documents/ResearchVault-Test/.obsidian/plugins/researchvault/`:
  - **2026-07-12 (pre-2.7):** `main.js` — 85.0 KB; `manifest.json` — 0.4 KB; `styles.css` — 8.6 KB (≈ +1.4 KB for the picker CSS section); `pdf.worker.min.mjs` — 1343.6 KB (top-level asset; `D26`).
  - **2026-07-13 (post-2.7):** `main.js` — ~87 KB (≈ +2 KB for `refreshPdfInfo` + `upsertAttachedPdfSection` + `refreshAttachedPdfBody`, minus dead code); `manifest.json` — 0.4 KB; `styles.css` — 8.6 KB; **no worker file** (the stale `pdf.worker.min.mjs` from the 2.6 deploy was deleted from the test vault before re-deploy).

**Test-vault fixture (snapshot before click-through)**
- Source vault `/Users/justinboeringa/Documents/ResearchVault-Test/`:
  - `community-plugins.json` includes `researchvault` (assumed — verify after first reload).
  - `data.json` backed up next to the plugin as `data.json.pre-smoke.json` — contains one active project `research project test` (id `285f1c26-3425-4207-97df-f5cd39caf900`) whose `folderPath` is `Projects/research` (and `Papers/` per the planned path). No papers yet, no classifier event quirks.
  - Pre-deploy papers folder `/Users/justinboeringa/Documents/ResearchVault-Test/Papers/` exists but is empty (the folder is the test-folder fixture, not a project-managed one — papers will land under `Projects/research/papers/` once `createManual` / `createFromPdf` runs).

**Click-through checklist (human — score each row inside Obsidian)**

| # | Step | Expected behaviour | Observed | Pass? |
|---|------|--------------------|----------|-------|
| 1 | Reload Obsidian in the test vault; **Settings → Community plugins → enable "ResearchVault"** | Plugin enables without console error; ribbon shows a library icon. | | |
| 2 | Click the ribbon | Opens the right-rail sidebar and shows the existing project `research project test` (already active). If no project is active, expect a "no active project" notice. | | |
| 3 | **Palette: "Researchvault: Add paper"** | Opens the [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts). Default project = active project; live citekey preview reads `doe_2026_first-word-of-title` once `title`/`authors`/`year` are filled. PDF row is visible (Browse vault… button + drop zone). | | |
| 4 | Fill title `Attention is all you need`, authors `Ashish Vaswani, Noam Shazeer`, year `2017`, click Submit | Writes `Projects/research/papers/vaswani_2017_attention.md` with the project's paper template rendered; frontmatter includes `citekey`, `title`, `authors`, `year`, `status: unread`, `dateAdded` ISO, `dateModified` ISO, `priority: normal`. Sidebar row appears under `Unread`. | | |
| 5 | Open the new paper note; select a sentence; **Palette: "Researchvault: Capture quote"** | Writes the quote under `## Quotes`; sidebar shows the quote glyph on the row; `quoteAdded` bus event hydrated. | | |
| 6 | Re-open via the sidebar pencil | `PaperImportModal` opens with banner "Edit paper", citekey field visibly disabled, every other field pre-seeded; submit writes via `paperService.updatePaper` and `dateModified` bumps. | | |
| 7 | Open the same paper's underlying `.md` file externally, change `year: 2017` → `year: 2018`, save | Back in Obsidian, the sidebar row's second line updates from "vaswani_2017_attention · 2017" → "vaswani_2017_attention · 2018" within a beat, **without a sidebar reopen**. This is `D23`'s live-sync. | | |
| 8 | **Palette: "Researchvault: Add paper"** → drop zone. Drag a small PDF (e.g. one Markdown-cheatsheet PDF bundled in this repo) onto the modal. *(2.7 behaviour — link-only per `D27`.)* | PDF is copied into `<project>/pdfs/<citekey>.pdf` (`-2 -3 …` on collision); modal info line under the PDF setting reads `Linked PDF: <project>/pdfs/<citekey>.pdf`; Submit writes the paper note at `<project>/papers/<citekey>.md` with a `## Attached PDF` section containing `[[../pdfs/<citekey>.pdf\|View PDF]]`, and yields `ResearchVault: imported "<citekey>" from PDF.` Notice. **No** `### Page 1` block — text extraction is deliberately not attempted. | | |
| 9 | **Palette: "Researchvault: Add paper"** → click "Browse vault…" *(2.7 behaviour — link-only per `D27`.)* | PdfPickerModal lists the vault's PDFs alphabetically; clicking a row sets the modal info line to `Linked PDF: <vault-relative path>`. The note produced on Submit wikilinks to the chosen PDF rather than parsing it. | | |
| 10 | Audit: open DevTools console for the entire flow | **Expected: zero `ResearchVault` warnings, zero unhandled rejections.** Network tab: **expected: zero network requests** during the entire flow (no AI toggle is on; `D15` privacy posture holds; `D27` keeps PDF parsing local — no `pdfjs-dist`). | | |

**Audit (post-click-through — human captures)**
- Number of `ResearchVault` console warnings: **___**
- Number of network requests during the flow: **expected 0**; observed **___**
- Any unhandled rejections: **expected none**; observed **___**

**Artifacts to copy back so this entry can be closed**
- `data.json` post-smoke (overwrites the snapshot, so diff `pre-smoke` vs `post-smoke` will surface any rogue writes).
- A screenshot of the import modal showing the new PDF row + browse button + drop zone.
- A screenshot of the sidebar row after step 7 (showing the year live-updated).
- Output of the DevTools console for the entire flow.
- Any quote that was added, in plain text (so we can spot-check the body section).

**Files touched (this sub-pass — 2026-07-12 first pass; 2026-07-13 re-deploy with 2.7 source changes)**
- 2026-07-12: [`plans/plan.md`](../../plans/plan.md) (this entry). No source files changed — the 2.6 deploy was the source-of-truth.
- 2026-07-13 (2.7 re-deploy): [`plans/plan.md`](../../plans/plan.md) (this entry updated for `D27`); the actual source changes live in the `### Sprint 2 — Sub-pass 2.7` entry immediately below.

---

### Sprint 2 — Sub-pass 2.7 (PDF import re-scoped to link-only per `D27`, shipped 2026-07-13)

**Why this sub-pass exists.** The 2.6 deploy shipped a `PdfService` that calls `pdfjs-dist@4.x`. Phase G click-through in the test vault surfaced four user-visible problems:
1. The picker (browse / drag-drop) wrote the PDF into `<project>/papers/` instead of a dedicated `pdfs/` folder.
2. The paper note ended up **next to** the PDF, with no wikilink between them — even after edit, the PDF attachment was invisible inside the note.
3. The picker's "Linked PDF" hint never updated once a PDF was chosen.
4. Submit threw `ResearchVault: text extraction is not supported in this environment (Obsidian desktop). Add paper metadata manually instead.` — a deliberate `throw` in [`src/services/pdf/loader.ts`](../../src/services/pdf/loader.ts) masking a real crash inside `pdfjs-dist`.
Root cause for (4): `pdfjs-dist@4.x` calls `process.getBuiltinModule(...)` at module-load time and requires Web Worker hosting, neither of which Obsidian's Electron plugin sandbox provides. Putting PDF parsing back on the road map would require a non-trivial worker shim (and is still desktop-only). For this sprint, the requirements are (a) get the PDF under the right folder, (b) make the note actually link to it, (c) provide an honest hint before submit, and (d) stop the misleading extraction message. Hence the link-only re-scope (`D27`).

**What shipped**
- [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — `createFromPdf(pdfPath, projectId)` is now a **link-only importer**:
  - Validates that the source path resolves to a `.pdf` `TFile`; bails with a clear message otherwise.
  - Ensures the project's folder set exists via [`ProjectManager.ensureProjectFolders`](../../src/services/project-manager.ts) (covers `papers/`, `pdfs/`, `notes/`, `literature/`).
  - Generates a citekey via the same [`generateUniqueCitekey`](../../src/utils/citekey.ts) pipeline as `createManual`, anchored on the file basename.
  - Copies the PDF into `<project>/pdfs/<citekey>.pdf` (collision-safe: `-2 -3 …` suffixes) using a new private `copyPdfIntoProject` helper (`vault.readBinary` → `vault.createBinary`).
  - Writes the paper note at `<project>/papers/<citekey>.md` with the same template as `createManual`, **plus** a `## Attached PDF` section injected by a new module-level `upsertAttachedPdfSection(body, pdfPath)` helper. The section is rendered as:
    ```markdown
    ## Attached PDF

    [[../pdfs/<citekey>.pdf|View PDF]]
    ```
  - Updates the in-memory index, emits `paperImported`. Frontmatter is unchanged from the manual flow (`source: 'pdf'` recorded on the paper).
- `updatePaper` now accepts an option `{ refreshAttachedPdf: boolean }` (computed internally as `next.pdfPath !== current.pdfPath`); when set, the note body is rewritten via `refreshAttachedPdfBody` → `upsertAttachedPdfSection` to swap the wikilink to the new path, **or** strip the section if `pdfPath` was cleared. Otherwise the body is preserved bit-for-bit.
- `extractQuotesFromPdf` and `findCitationsInPdf` are stubbed: they throw `Error("PaperService.<method>: PDF text extraction is not available (D27). ...")` pointing the caller at `QuoteCaptureModal` / manual `addQuote` and reminding them of the `D27` deferral.
- [`src/services/project-manager.ts`](../../src/services/project-manager.ts) — added a public `getProjectPdfsFolder(projectId): string` getter parallel to `getProjectPapersFolder` so the picker / drop zone can resolve their folder without re-deriving paths.
- [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts):
  - Replaced the PDF setting description copy to state plainly that the file is copied into `pdfs/` and wikilinked from the paper note.
  - Added a live information line (`refreshPdfInfo()`) under the PDF setting that always shows one of: the linked path after a pick (`Linked PDF: <path>`), the destination folder after a project is selected (`PDFs will be copied to: <project>/pdfs/`), or a hint to pick a project.
  - Re-routed the drag-drop target from `<project>/papers/` to `<project>/pdfs/` (new `copyPdfIntoVault` body). Folder-existence errors are swallowed if the message already contains `exists` / `already`; other failures surface a `ResearchVault: failed to create pdfs folder — <msg>` Notice and abort the drop.
- [`styles.css`](../../styles.css) — added `.researchvault-pdf-path-info` styling (small muted text, monospace-flavoured) for the new information line.
- [`esbuild.config.mjs`](../../esbuild.config.mjs) — dropped the `pdfjs-dist/legacy/build/pdf.mjs` externalization and the post-build worker-copy step.
- [`scripts/deploy-to-obsidian.mjs`](../../scripts/deploy-to-obsidian.mjs) — removed `pdf.worker.min.mjs` from the `OPTIONAL` copy list.
- [`package.json`](../../package.json) — removed `pdfjs-dist` from `dependencies` (and the lockfile entry).

**Architectural decisions added this sub-pass**
- `D27` — **PDF import is link-only for this milestone.** A PDF attached to a paper is copied into `<project>/pdfs/<citekey>.pdf` and the paper note has a `## Attached PDF` wikilink pointing at it. No text extraction is attempted in `PaperService`; `extractQuotesFromPdf` and `findCitationsInPdf` throw with a `D27` reason. Rationale: `pdfjs-dist@4.x` is unusable inside Obsidian's plugin sandbox; future extraction work (Tier 3+) will need a worker shim and a different host. Bundle delta: **−1.4 MB** (worker asset gone), **+2 KB** (link-only helpers) → net **−1.4 MB** on disk and a small net-adder in `main.js`.

**Verification**
- `npm run build` — exit 0; `main.js` regenerated.
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.
- `node scripts/deploy-to-obsidian.mjs` — exit 0; the stale `pdf.worker.min.mjs` from the 2.6 deploy was deleted from the test vault plugin folder before re-deploy.

**Known gaps (carried forward)**
- No PDF text extraction, citation detection, or quote scraping. Manual quote capture (`QuoteCaptureModal`) remains the only path; `D27` is the explicit deferral.
- Bundle install size went **down** vs 2.6 (no worker file). Mobile parity is preserved because no worker is required any more.

**Files touched / added**
- Removed: [`src/services/pdf-service.ts`](../../src/services/pdf-service.ts), [`src/services/pdf/loader.ts`](../../src/services/pdf/loader.ts), [`pdf.worker.min.mjs`](../../pdf.worker.min.mjs) (deleted from repo root and from the test vault).
- Modified: [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (link-only `createFromPdf`, deleted `buildPdfBody` / `renderAttachedPdfSection`, added `upsertAttachedPdfSection` + `refreshAttachedPdfBody`), [`src/services/project-manager.ts`](../../src/services/project-manager.ts) (`getProjectPdfsFolder`), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (info line + drop-zone reroute), [`styles.css`](../../styles.css) (info-line style), [`esbuild.config.mjs`](../../esbuild.config.mjs), [`scripts/deploy-to-obsidian.mjs`](../../scripts/deploy-to-obsidian.mjs), [`package.json`](../../package.json), [`plans/plan.md`](../../plans/plan.md) (this entry + `D27` + §3 lock table + §13 in-progress row + Phase G scorecard steps 8–9).

---

### Sprint 2 — Sub-pass 2.7.1 (PDF attachment priority fix per `D28`, shipped 2026-07-13)

**Why this sub-pass exists.** The 2.7 link-only build was deployed and Phase G click-through on the test vault surfaced a different, sharper bug: when the user filled in the metadata by hand **and** attached a PDF, the modal silently produced an `anon_<pdfbasename>_<random>` paper with no title, no author, no year, and an `anon`-style citekey — because the submit path routed to `createFromPdf` *before* the manual path and `createFromPdf` synthesised a stub record from the PDF basename. The bug only manifested when the user wanted both: typed metadata *and* a PDF attachment. Since we have no reliable way to extract structured metadata from a PDF inside the sandbox (see `D27`), the safest user model is "the PDF is *attached* to a paper — never a source of metadata". Hence `D28` and sub-pass 2.7.1.

**What shipped**
- [`src/services/paper-service.ts`](../../src/services/paper-service.ts):
  - `PaperManualInput` gained `attachPdfFrom?: string` (vault-relative path to a PDF the caller wants attached). The old `pdfPath` field is gone from the manual input.
  - `createManual(input, projectId)`:
    - If `input.attachPdfFrom` resolves to a `.pdf` `TFile`, copies it into `<project>/pdfs/<citekey>.pdf` via the private `copyPdfIntoProject` helper (collision-safe `-2 -3 …` suffixes).
    - Sets `paper.pdfPath = linkedPdfPath` and `paper.source = 'pdf'` only when a PDF is attached; otherwise `source: 'manual'` and `pdfPath: undefined`.
    - Builds the body with `upsertAttachedPdfSection(renderedBody, linkedPdfPath)`, then writes the file. Required-field validation runs first; a missing/blank title or non-numeric year throws with a clear message before any folder work happens.
    - Still emits `paperImported` after a successful write.
  - `createFromPdf` was replaced with a **stub** that throws `PaperService.createFromPdf: removed in 2.7.1 (D28). Use createManual({ ..., attachPdfFrom }).` Keeping a real method around would silently invite the old "synthesise from basename" behaviour back in; the stub makes the regression loud.
- [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts):
  - The `usePdfImport` boolean form field is **gone**. The only state is `form.pdfPath` (vault-relative path of the picked file, or empty).
  - PDF setting relabelled `PDF` → **Attached PDF**. Description copy rewritten so it's obvious the PDF is an attachment and does not pre-fill any metadata field. Button text swapped from `Browse vault…` / `Change PDF` to `Attach PDF…` / `Replace PDF` for consistency with the new framing.
  - Modal intro paragraph updated to make the manual-first contract explicit: "A PDF can be attached (optional) but it won’t pre-fill any field — you do."
  - `submit()` no longer has a `usePdfImport` branch. It always routes to `createManual({ ..., attachPdfFrom: pdfPath })`. Edit mode still uses `updatePaper` (with `pdfPath`) since editing a paper already created with an attached PDF is a different code path and the file is already shaped correctly.
  - Success Notice now reads `ResearchVault: imported "<citekey>" with attached PDF.` when a PDF was attached, and just `… "<citekey>".` when it wasn’t.
- `package.json` — no changes. `esbuild.config.mjs` — no changes. The link-only build shape is unchanged; this is a behaviour/UX sub-pass, not a dependency sub-pass.

**Architectural decisions added this sub-pass**
- `D28` — **PDF is an attachment, never a metadata source.** Manual metadata always wins on submit. The PDF picker in `PaperImportModal` is purely an attachment source; the file is copied into `<project>/pdfs/<citekey>.pdf` and the note gets a `## Attached PDF` wikilink section, but no field is ever synthesised from the PDF. The form field was renamed `pdfPath` → `attachPdfFrom` to make the intent visible at every call site.

**Verification**
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0; the type system enforces the new contract: `PaperManualInput.pdfPath` is a compile error if a caller still tries to set it; `createFromPdf` is untyped for any other caller.
- `npm run build` — exit 0; `main.js` regenerated. Bundle is 84.1 KB, **down 1.3 KB** from the 2.7 build (the `createFromPdf` body and the modal's `usePdfImport` branching are both gone, so the cold path is shorter than the hot one).
- `node scripts/deploy-to-obsidian.mjs` — exit 0; the same plugin folder as 2.7 was overwritten. `data.json.pre-smoke.json` snapshot was preserved; only `main.js` / `manifest.json` / `styles.css` were rewritten.
- Manual click-through against the test vault is still pending human sign-off — this sub-pass fixes a behavioural bug, so re-running the scorecard is the only way to confirm it. The scorecard now has a new step 4 (manual-only + PDF attach) in addition to the existing step 6 (PDF import only) in the 2.manual-smoke dated entry below.

**Known gaps (carried forward)**
- No PDF text extraction, citation detection, or quote scraping (still `D27`). The 2.7.1 changes do not unblock any extraction work; the surface is still strictly "attach a PDF, link to it from the note".
- The modal still lacks a hard "PDF was chosen but title/author/year are blank" check that would surface *before* the modal opens. Today, a user who picks a PDF and clicks Add with no metadata gets a clear throw from `createManual`, but a friendlier pre-flight message in the modal would be nicer. Tracked as a 2.7.x polish follow-up if it keeps coming up.

**Files touched / added**
- Modified: [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (added `attachPdfFrom` to `PaperManualInput`; `createManual` honours it; `createFromPdf` stub-throws), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (removed `usePdfImport`, rewrote PDF setting + intro copy, `submit()` routes through `createManual` only), [`plans/plan.md`](../../plans/plan.md) (this entry + `D28` + §13 in-progress row updates).
- Removed: nothing (the `usePdfImport` field is just a form-state boolean, not a separate file).
- Not touched: `package.json`, `esbuild.config.mjs`, `scripts/deploy-to-obsidian.mjs`, `styles.css`, `manifest.json`. The link-only D27 surface is unchanged.

### Sprint 2 — Sub-pass 2.8 (UI / data-format polish batch — shipped 2026-07-14, manual smoke pending)

**Why this sub-pass exists.** After the 2.7.1 (`D28`) click-through the user filed five small UI/data-format asks plus a sidebar focus bug, all of which belong in the same sub-pass so the modal-width and date/author format changes land together. Full design + open-question round in [`plans/ui-polish-2.8-research.md`](./ui-polish-2.8-research.md). Q&A decisions signed off 2026-07-14 are listed at the bottom of that doc.

**What shipped (source-complete; manual click-through pending as 2.8.smoke)**
- **2.8.A — Modal width (640 px, shared util).** New [`src/ui/modals/modal-width.ts`](../../src/ui/modals/modal-width.ts) exporting `applyStandardModalWidth(modal)` (sets `modal.modalEl.style.width = '640px'` plus `max-width: 90vw` for narrow viewports). All four modals ([`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts), [`QuoteCaptureModal`](../../src/ui/modals/quote-capture-modal.ts), [`CreateProjectModal`](../../src/ui/modals/create-project-modal.ts), [`SwitchProjectModal`](../../src/ui/modals/create-project-modal.ts)) call it at the top of `onOpen()`.
- **2.8.B — Drop-zone copy.** "or drag a PDF file here" → **"Drag and drop PDF here"** in the drop-zone info row of [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts). One-line UI copy change.
- **2.8.Sidebar — Sidebar render split + focus fix + search quality.** [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) split `render()` into `renderHeader()` (mounts the search input once) + `renderList()` (re-renders paper rows on every state change). The search input now lives inside a persistent header div and is never re-created on input events, so focus + caret position survive keystrokes. Fuse config in [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) relaxed: `minMatchCharLength: 1`, `threshold: 0.4` (was `2` and `0.35` — the old config made 1-character queries return nothing and partial-prefix queries like `vaswan` miss `vaswani`).
- **2.8.C — Date format on paper notes.** [`src/utils/format-date.ts`](../../src/utils/format-date.ts) gained [`toLocalDateTime`](../../src/utils/format-date.ts:95) emitting `YYYY-MM-DD | HH:MM` in the user's local timezone. [`src/services/paper-service.ts`](../../src/services/paper-service.ts) `toFrontmatter` now uses the new format. The previous `toIsoDateTime` (UTC with `Z` and ms) is kept for tests as `toIsoDateTimeUtc`. **No migration** — `fromFrontmatterDate` round-trips both old and new formats via `Date.parse`.
- **2.8.D — `dateModified` re-stamp on body edit + Needs-action proxy rewire.** [`src/services/paper-service.ts`](../../src/services/paper-service.ts) gained `onPaperFileModified(file)` (public — `plugin.ts` calls it) and a private `findByPath(filePath)` helper. The handler re-stamps `paper.dateModified` to `Date.now()` when a paper file's body or frontmatter is modified outside the plugin, then re-persists only the frontmatter. A 2-second loop guard (`if (next - paper.dateModified < 2_000) return`) suppresses our own `persistPaper` write from re-stamping a second time. [`src/core/plugin.ts`](../../src/core/plugin.ts) registers the `vault.on('modify', ...)` listener inside the existing `registerVaultSync` method, which also still calls `syncFromFile` for frontmatter re-syncs. Side effect: "Needs action" used `paper.dateModified` as the staleness proxy, so every body edit reset the staleness clock and an actively-annotated paper silently disappeared from "Needs action". [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) `computeNeedsAction` / `sortNeedsAction` / `needsActionReason` now use `paper.dateAdded` (stable creation-age proxy) instead, so the staleness clock measures "how long has this been on the list", not "how long since I last hit save".
- **2.8.E — Authors as YAML list of last-name strings + optional parallel first-names array.** Breaking type change in [`src/types/literature.ts`](../../src/types/literature.ts): `Paper.authors: Author[]` → `string[]` (last names), plus new `Paper.authorFirstNames?: string[]` (parallel first names, optional, written only when at least one is non-empty). YAML emits `- Vaswani` instead of `- {firstName: Ashish, lastName: Vaswani}` — Obsidian's tag search picks up the plain string form, which was the user's main ask. [`src/services/paper-service.ts`](../../src/services/paper-service.ts) `frontmatterToPaper` handles three shapes for backward compat: new last-only, new with parallel firstNames, legacy `{firstName, lastName}` object form. `toFrontmatter` writes both arrays. `templateDataFor` joins `${first} ${last}` per author when `authorFirstNames` exists, else lastNames only. `papersEqual` excludes `authorFirstNames` from equality so a user editing only the first-name array doesn't flip equality. [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) `projectFor` joins plain last names with optional parallel first names. [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) gained a new `firstNames` parallel input in the author rows and a `buildAuthorRows` helper that heuristically splits the last token off a multi-token name when no parallel first name is supplied. Lintfix added a small `coerceFrontmatterScalar(value: unknown): string` helper to replace two flagged `String(s ?? '')` calls.

**Architectural decisions added this sub-pass**
- **No new `D` decision numbers.** 2.8's changes ride on the existing `D22`–`D28` decisions and don't introduce any new locked rules. The focus-fix and the Needs-action proxy rewire are both *behavioural* changes, not schema / architecture changes, so they don't need a new `D`-slot.

**Verification (machine gates — all green)**
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0; `main.js` regenerated at **86.1 KB** (+2.0 KB from 2.7.1's 84.1 KB; delta covers the `coerceFrontmatterScalar` helper, `buildAuthorRows` heuristic, `onPaperFileModified` / `findByPath` helpers, and the search-quality Fuse config switch).
- `node scripts/deploy-to-obsidian.mjs` — exit 0; artifacts copied to the test vault. The 2.8 bundle replaces the 2.7.1 build; `data.json` snapshot is untouched.

**Manual smoke (2.8.smoke — pending human click-through)**
1. Open `PaperImportModal` and `QuoteCaptureModal` side by side — confirm the widths match and the drop zone fits the new copy comfortably.
2. Open the modal, fill in title/author/year, click Add. Open the new paper note, confirm `dateAdded` and `dateModified` are `YYYY-MM-DD | HH:MM` in the user's local time (no `T`, no ms, no `Z`).
3. Type a character in the body of the paper note, save, confirm `dateModified` re-stamps to the wall clock.
4. Edit a paper via the edit modal, type `Ashish Vaswani` as the primary author, save. Open the paper note, confirm the YAML has `authors: - Vaswani` (last-name only) and that the rendered view shows a clean list.
5. Type a one-character query (e.g. `a`) in the sidebar search, confirm the input keeps focus and the list filters. Type a partial-prefix query (e.g. `vaswan`), confirm it matches `vaswani_2023_attention`.
6. Open a paper that has been sitting in `skimming` for more than 14 days, confirm it still appears in the **Needs action** group (the `dateAdded`-based proxy survives body edits).

**Known gaps (carried forward)**
- **No real Obsidian click-through yet** — the bundle is deployed but the manual smoke (steps 1–6 above) is the only thing that can prove the focus fix + the Needs-action rewire work end-to-end. Tracked as **2.8.smoke** in the in-progress table above.
- **Full sidebar filter overhaul is in 2.9** — 2.8 only fixed the focus loss and the Fuse `minMatchCharLength` / `threshold` pain points. The chip-row + author-autocomplete + saved-filter-state work lives in a separate sub-pass; detailed phase plan in §14 below.

**Files touched / added**
- Added: [`src/ui/modals/modal-width.ts`](../../src/ui/modals/modal-width.ts) (`applyStandardModalWidth`).
- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (drop-zone copy, new firstNames input, `buildAuthorRows` heuristic, submit paths for `createManual` + `updatePaper`), [`src/ui/modals/quote-capture-modal.ts`](../../src/ui/modals/quote-capture-modal.ts) (width), [`src/ui/modals/create-project-modal.ts`](../../src/ui/modals/create-project-modal.ts) (width on both `CreateProjectModal` + `SwitchProjectModal`), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (render split, focus fix, Needs-action proxy rewire), [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (date format writer, `onPaperFileModified` / `findByPath`, author shape readers + writers, `coerceFrontmatterScalar`, `papersEqual` excludes `authorFirstNames`), [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) (`projectFor` joins plain last names, Fuse config relaxed), [`src/core/plugin.ts`](../../src/core/plugin.ts) (modify-handler wires `onPaperFileModified`), [`src/utils/format-date.ts`](../../src/utils/format-date.ts) (`toLocalDateTime` added), [`src/types/literature.ts`](../../src/types/literature.ts) (`Paper.authors: string[]` + `Paper.authorFirstNames?: string[]`), [`plans/ui-polish-2.8-research.md`](./ui-polish-2.8-research.md) (decisions + sign-off appended), [`plans/plan.md`](../../plans/plan.md) (this entry + 2.8/2.9 rows in §13 + phase plan in §14).

**Looking ahead**
- **2.8.smoke** — human click-through against the test vault. Closes 2.8 once steps 1–6 pass.
- **2.9** — full sidebar filter overhaul: status / priority / year / hasPdf / hasNotes filter chip row, author autocomplete popover sourced from the project's `paper.authors` set, optional saved filter state per project. Phase plan in §14 below. The author autocomplete is much simpler now that `Paper.authors` is a flat `string[]` (per 2.8.E).
- **4.1** (DOI lookup + free-text search) — unblocks once 2.8.smoke is signed off.

---

### Sprint 2 — Sub-pass 2.8.1 (Attached-PDF row squish fix, shipped 2026-07-21; **the patch was rewired twice** before it landed; manual smoke still bundled with 2.8.smoke)

**Why this sub-pass exists.** A 2026-07-21 eyeball pass against the deployed 2.8 build showed the "Attached PDF" setting row in `PaperImportModal` was squished: the long multi-sentence help text (2.8.B's "Optional. Attach a PDF from the vault …") had been attached to the row via `Setting.setDesc(...)`, which forced it into the narrow right-hand control column next to the "Attach PDF…" button. The help text wrapped to three lines, the button shared the same column, and the drop zone (`Drag and drop PDF here`) had been appended to the same `pdfSetting.controlEl` slot. Visually that reads as "four lines of grey text + a button + a 1-line drop zone crammed into ≈280 px". The fix in 2.8.1 is purely a UI-tree shape change—detach the help text from the Setting row, move the drop zone out of the control column, and mount each piece on **`root`** (the modal content element, which is `display: block`) as a full-width sibling below the Setting row. No schema, type, behavioural, or data-format change. Reuses existing `D22`–`D28` decisions; no new `D`-slot needed.

**Iteration log (preserved so the next person who reaches for `pdfSetting.settingEl` doesn't repeat the mistake).**
1. **First cut (broken, *not* shipped).** Help text + drop zone + path-info mounted on `pdfSetting.settingEl`. Because Obsidian's `.setting-item` is `display: flex; flex-direction: row`, all three new children flowed left-to-right inline alongside the name column and the button. The result was *worse* than the 2.8 squish: name column clipped, drop zone shrunk to a ~120 px sliver, help text wedged into the right-hand column. Caught by an eyeball re-check after deploy.
2. **Second cut (shipped).** Mount each of the three blocks on **`root`** so they stack as full-width siblings vertically below the Setting row. The Setting itself stays a thin name + button row; the children get full modal width. This is what the `rm` listing below describes.

**What shipped (source-complete; manual click-through pending as step 7 of 2.8.smoke)**
- **2.8.1.A — New `.researchvault-pdf-help` CSS rule.** `display: block` (defensive—root is already block) + `max-width: 480px` so the help text never pushes sibling rows + `margin: 6px 0 8px` + `font-size: 0.85em` + `line-height: 1.4` + muted color. Retuned the existing `.researchvault-pdf-drop-zone` to `margin-top: 0` (it no longer sits next to the control column—`.researchvault-pdf-h` is `margin: 8px` below the help block now). `.researchvault-pdf-path-info` keeps its `margin-top: 6px`; no `margin-bottom` (the next default Settings row's top spacing handles separation).
- **2.8.1.B — Modal restructure.** [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) `renderMetadataRows` PDF block: drop the `Setting.setDesc(...)` call entirely; build the row as just `name + button` (the return value is discarded—no `const pdfSetting =` binding because nothing else needs it); mount the long help text as `root.createDiv({ cls: 'researchvault-pdf-help' })` *immediately below* the `new Setting(...)` line; mount the drop zone as `root.createDiv({ cls: 'researchvault-pdf-drop-zone' })`; cache `pdfInfoEl = root.createDiv({ cls: 'researchvault-pdf-path-info' })` and call `this.refreshPdfInfo()` to render the placeholder. Because `root` (`modal.contentEl`) is `display: block`, the three siblings stack vertically at full modal width even though the Setting row above them is a flex row. The drag/drop handler, the click handler, the `attachPdfFrom` wiring in submit(), and the `refreshPdfInfo` cache node are untouched.

**Architectural decisions added this sub-pass**
- **No new `D` decision numbers.** Pure UI-tree repair; no schema / type / event / behaviour delta.

**Verification (machine gates — all green, on the second-cut / `root`-mount patch)**
- `npm run lint` — exit 0; zero errors / zero warnings.
- `npx tsc --noEmit` — exit 0.
- `npm run build` — exit 0; `main.js` is **88,190 B** (86.1 KB; +2,030 bytes from 2.8). Delta covers the new `root.createDiv(...)` calls, the small CSS block, the layout-shape comment block explaining the flex-vs-block trap, and helper-name adjustments. The unused `pdfSetting` binding that the first cut created has been **dropped** in the second cut (lint caught it as `no-unused-vars`), trimming 38 B back off the first cut.
- `node scripts/deploy-to-obsidian.mjs` — exit 0; the 2.8.1 bundle replaces the 2.8 build. `data.json` snapshot is untouched. The `.researchvault-pdf-help` style is now actually applied (2.8 had declared it but never mounted it), so no orphan rules in the shipped CSS.

**Manual smoke (merged into 2.8.smoke — now a 7-step checklist)**
1–6: unchanged from 2.8 — modal widths match, drop-zone copy fits, dates reformat to `YYYY-MM-DD | HH:MM`, `dateModified` re-stamps on body edit, authors compose as `authors: - Vaswani`, sidebar search keeps focus and matches partial prefixes (e.g. `vaswan` → `vaswani_2023_attention`), `dateAdded`-based Needs-action proxy survives body edits.
7. Open `PaperImportModal`, confirm the "Attached PDF" row: a thin Setting row at top with the name on the left and the **"Attach PDF…" button alone** in the narrow control column; long help text wraps as expected in the capped (max-width: 480 px) full-width block just below; **drop zone spans the full modal width** with readable padding; `Linked PDF: …` (or "PDFs will be copied to: …") info line sits cleanly under the drop zone, monospace, muted. **No more squish.** If the name column on the Setting row is clipped on the left OR the drop zone is a thin vertical sliver in the middle OR the help text runs down the right column, the patch has regressed to the first-cut (broken) layout—re-check the mount points.

**Known gaps**
- None new. The fix is cosmetic and does not affect the `attachPdfFrom` field, the copy logic, or the drop zone's accepted file types.
- The flex-vs-block trap is the only thing this sub-pass teaches; **2.9 and beyond should not mount content children off `pdfSetting.settingEl`** (or any other flex `.setting-item`) without treating them as inline siblings first.

**Files touched / added**
- Modified: [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (PDF row tree shape), [`styles.css`](../../styles.css) (`.researchvault-pdf-help` rule + minor spacing retunes), [`plans/ui-polish-2.8-research.md`](./ui-polish-2.8-research.md) (the new `## 2.8.1` section with iteration log + corrected `root`-mount surface), [`plans/plan.md`](../../plans/plan.md) (this entry + `| 2.8.1 |` row + §14 row).
- Not touched: any test, `package.json`, `manifest.json`, `esbuild.config.mjs`, [`src/services/`](../../src/services/), [`src/ui/views/`](../../src/ui/views/), sidebars, settings, or events.

**Looking ahead**
- **2.8.smoke** — combined 7-step human click-through against the 2.8.1 build. Closes both 2.8 and 2.8.1 in one go.
- **2.9** — sidebar filter overhaul — still parked behind 2.8.smoke.
- **4.1** — DOI lookup — still parked behind 2.8.smoke.

### Sprint 4 — Research spike (Citation lookup + Zotero integration scoping, logged 2026-07-14)

**What shipped**
- New design document at [`plans/citation-lookup-research.md`](./citation-lookup-research.md) — full research + provider survey + architectural sketch + open questions for the citation-lookup and Zotero-integration directions.
- Two new architectural decisions appended to §3: [`D29`](#) (citation lookup is opt-in, network-only, no auth) and [`D30`](#) (Zotero integration comes in three independent opt-in layers: web-API read-in, local-API push-back, coexistence with the official community plugins).
- New in-progress rows in §13 for sub-passes 4.1, 5.1, 5.2, 5.3. New detailed phase plans in §14 for each. README "What's coming" updated; "deliberately doesn't promise" block updated to call out the not-yet-shipped lookup and Zotero commitments.
- Honest caveats noted in the design doc: this tool environment has no web access, so the endpoint details, rate limits, and Obsidian plugin landscape are from training knowledge (cutoff Jan 2026) rather than live verification. Re-verification is a 4.1.A and 5.1.A prerequisite when the implementation pass starts.

### Sprint 4 — Sub-pass 4.1.A kickoff (DOI lookup MVP — locked-preferences pass, logged 2026-07-21)

**Status:** **Kicked off; no code yet.** Architect-mode deliverable. No-UI scope per D29.

**What this sub-pass produces (when the three blocking questions are answered)**
- A new `src/services/citation/` directory with a hand-typed `CslJsonRecord` subset, a `CitationService` class skeleton, two provider stubs (CrossRef + OpenAlex), and a fully-implemented pure `csl-to-paper.ts` mapper.
- `src/types/literature.ts:21` already declares `url?: string`, so the only new optional `Paper` field is `oaUrl?: string`. `PaperSource` already includes `'doi'` ([`src/types/literature.ts:129`](../src/types/literature.ts)) so no new union member.
- `src/settings.ts` gets a new `citation: CitationSettings` block. Because the current `migrateSettings` ([`src/settings.ts:95`](../src/settings.ts)) is a spread-merge and `CURRENT_SETTINGS_VERSION` is still `'1'`, this is a default-fill — not a versioned migration. Save `'2'` for a real breaking shape change.
- `src/core/events.ts` gets two new events for telemetry: `citationLookupSucceeded` and `citationLookupFailed` (mirror the existing `aiRequestStarted` / `aiRequestCompleted` pair).
- `src/core/plugin.ts` gets a lazy-instantiation getter for `citationService` — keeps `onload` cheap per AGENTS.md "Keep startup light" and means the LRU cache + rate limiter don't spin up for users who never enable the feature.
- **No new dependencies.** Expected bundle impact: +1.0 to 1.4 KB. `pdfjs-dist` stays out per D27; `citeproc` stays deferred per D11.

**Locked preferences (no user input needed)** — 11 decisions in [`plans/citation-lookup-research.md`](./citation-lookup-research.md) §7.2:
- L1: only `Paper.oaUrl?` is added; `Paper.url?` already exists.
- L2: `PaperSource` already has `'doi'`.
- L3: do **not** bump `settings.version`; default-fill in the existing spread-merge.
- L4: `CitationService` is constructed lazily on first use, not in `onload`.
- L5: two new events for telemetry.
- L6: citekey recompute on autofill goes through the existing `refreshPreview()` in `paper-import-modal.ts:419`.
- L7: modal hint is in-modal, not event-driven.
- L8: `citeproc` stays out.
- L9: reuse `composeCitekey` from `src/utils/citekey.ts:35`.
- L10: `CslJsonRecord` is a hand-typed subset, not `npm install @types/csl-json`.
- L11: `CitationProvider` is a string-literal union, not a TS `enum`.

**Rate-limit re-verification (deferred to 4.1.B)** — the `5 req/s, capacity 10` and `30-day TTL, 500-entry cap` numbers are order-of-magnitude right but not re-verified against the live CrossRef / OpenAlex docs at spike time (spike §6, design doc §7.3). The 4.1.A code writes them as `static readonly` constants inside `CitationService`; 4.1.B re-verifies and may tune them. Impact is contained: no call-site changes; no setting default changes; no UI changes.

**Three user-locked preferences (all confirmed 2026-07-22)** — see the design doc §7.4 for full context:
1. **Provider default.** **CrossRef primary; OpenAlex for free-text search fallback.** (`CitationSettings.preferredProvider` defaults to `'crossref'`.)
2. **Polite-pool `mailto:` default.** **OFF by default.** No identifier leaves the device unless the user opts in via the Citations settings tab (lands in 4.1.D). (`CitationSettings.politeContact` defaults to `''`.)
3. **Auto-fill extras.** **DOI + title + query only in 4.1.A; arXiv / ISBN / PMID deferred to 4.1.1.** The 4.1.A skeleton ships `lookupByDoi` + `searchByTitle` + the new `searchByQuery` (CrossRef's `?query.bibliographic=…` + OpenAlex's `?search=…` for journal-name and partial-citation strings). 4.1.1 grows correspondingly larger; recorded for traceability.

3a. **Abstract autofill on DOI lookup.** Already in the §3.4.1.C autofill list. Both providers return the abstract for the majority of DOIs they know about (CrossRef ~80%, OpenAlex ~85% for journal articles; lower for preprints and book chapters). No plan change needed. Added as an explicit assertion to the 4.1.E click-through checklist so the auto-fill is verified against a known DOI.

The two Zotero questions from the spike (5.1 vs 5.2 priority; coexistence with the official plugins) are **out of scope for 4.1.A** and will be revisited when 5.1 is the next-active sprint.

**Hand-off contract for 4.1.B** — once 4.1.A is done, 4.1.B can start without further questions by implementing the two `fetch` calls in `providers/crossref.ts` + `openalex.ts` with the cached + rate-limited plumbing in `citation-service.ts`, the LRU cache (`Map<doi, { record, fetchedAt }>`, TTL 30 d, cap 500), and the token-bucket rate limiter (`5 req/s, capacity 10`). 4.1.B is the sub-pass that re-verifies the rate-limit numbers (spike §6, design doc §7.3) against the live docs.

**What 4.1.A does NOT do** — no UI changes, no settings tab, no modal buttons, no tests (vitest is 5.x), no README changes (those land in 4.1.G after 4.1.B–D ship).
**Verification**
- None. This is a research spike — no code changed, no verification gates run.
- All edits to `plan.md` were made to lock the direction; no service / modal / settings code is touched.

**Known gaps**
- The exact CrossRef / OpenAlex rate-limit numbers should be re-checked against the live docs during 4.1.A. Order of magnitude is right (low double digits req/s for the polite pool), but the rate limiter's token-bucket parameters will be tuned at that point.
- The exact `obsidian-zotero-desktop-connector` plugin's current API surface is not verified. The 127.0.0.1:23119 endpoint itself is stable in Zotero; the plugin is the more volatile piece. Re-check during 5.1.A.
- The Zotero web API v3 endpoints and the auth model are stable; confidence in the high-level 5.1 design is high.

**Files touched / added**
- Added: [`plans/citation-lookup-research.md`](./citation-lookup-research.md) — design doc.
- Modified: [`plans/plan.md`](../../plans/plan.md) (this entry + `D29` + `D30` + §13 in-progress rows for 4.1, 5.1, 5.2, 5.3 + §14 detailed phase plans + §15 README "What's coming" / Privacy / "deliberately doesn't promise" updates).
- Not touched: anything under `src/`. No code; no `package.json`; no `manifest.json`.

---

### Sprint 4 — Sub-pass 4.1.A implementation (DOI lookup MVP — types + settings + service skeleton, shipped 2026-07-22)

**Status:** **Shipped.** Types, settings, events, and the `CitationService` skeleton are live in `src/`. Network calls still stub — 4.1.B is next.

**Per-file decisions**
- **`Paper.oaUrl?: string` added at [`src/types/literature.ts:21`](../../src/types/literature.ts)** — the only new `Paper` field (L1). `Paper.url?` already existed.
- **`PaperManualInput.source?: PaperSource` added at [`src/services/paper-service.ts:58`](../../src/services/paper-service.ts)** with a comment explaining the 4.1.C DOI mode will pass `source: 'doi'`. `createManual` widens its internal `sourceTag` to `PaperSource` and honours an explicit override.
- **`Source-stamping in `cslToManualInput`** is caller-driven: `cslToManualInput(record, existing)` copies `existing?.source` onto the result only if it was set on the caller side. No implicit `source: 'doi'` default.
- **`CitationService`** is constructed lazily via `plugin.ensureCitationService()` (see [`src/core/plugin.ts:277`](../../src/core/plugin.ts)), per L4 — `onload` does NOT instantiate it. The resolved `fetchImpl` uses `window.fetch?.bind(window)` (the popout-window `activeWindow` concern applies to DOM listeners, not network calls).
- **`CitationEventBus = Pick<EventBus, 'emit'>`** — a `Pick` type alias rather than a hand-rolled interface so structural variance is preserved and the plugin's wider `<K extends keyof ResearchVaultEvents>` signature satisfies the orchestrator's narrower `'citationLookupSucceeded' | 'citationLookupFailed'` constraint cleanly.
- **`searchByQuery(query, limit)` added to the public API** — CrossRef's `?query.bibliographic=…` + OpenAlex's `?search=…`. The user-flagged journal/bibliographic lookup requirement from 2026-07-22 is satisfied at the type level; the network call is still stubbed. 4.1.B swaps the stubs for real fetches.

**What shipped**
- New directory `src/services/citation/` containing:
  - [`src/services/citation/types.ts`](../../src/services/citation/types.ts) — hand-typed 14-field `CslJsonRecord` subset (L10), `CitationProvider` string-literal union (L11), `CitationSettings`, `CitationProviderClient`, `CslAuthor`, `CslDate`, `FetchImpl`, `ProviderFetchOpts`, `CitationLookupSucceeded`, `CitationLookupFailed`, `CitationLookupFailureReason`. (`DEFAULT_CITATION_SETTINGS` enables `enableCitationLookup: false` by default; `preferredProvider: 'crossref'`; `politeContact: ''`.)
  - [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts) — orchestrator class with `static readonly` cache + rate-limit constants (`CACHE_TTL_DAYS = 30`, `CACHE_MAX_ENTRIES = 500`, `RATE_LIMIT_RPS = 5`, `RATE_LIMIT_BURST = 10`); public API `lookupByDoi` / `searchByTitle` / `searchByQuery` (all dispatch to the configured provider stub and surface `citationLookupFailed` when `enableCitationLookup` is false); `importCslJson` is **fully implemented** (delegates to `csl-to-paper` and accepts both a single CSL record and an array literal).
  - [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) — `CrossrefClient implements CitationProviderClient` with stubs that throw `Error('CrossrefClient.X: not implemented (4.1.B).')`. Also exports `buildUserAgent(defaultUA, politeContact)` and `CROSSREF_DEFAULT_USER_AGENT`.
  - [`src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts) — `OpenAlexClient implements CitationProviderClient` with the same stub pattern. Also exports `buildOpenAlexUrl(path, politeContact)` for the `mailto=` query param.
  - [`src/services/citation/csl-to-paper.ts`](../../src/services/citation/csl-to-paper.ts) — pure mapper. `cslToManualInput(record, existing)` covers `title`, `authors` (last + first), `year`, `venue` (from `container-title`), `DOI`, `URL` (from `DOI` URL on CrossRef / `primary_location.source.url` on OpenAlex), `abstract` (de-`typeset`-ed of CSL MathML markup), and `keywords` (from `keyword` or `subject`). Caller-driven `source` propagation.
- [`src/types/literature.ts:21`](../../src/types/literature.ts) — adds `oaUrl?: string` to `Paper`, with JSDoc noting the 4.1.A wiring is type-only and providers do not yet return this.
- [`src/services/paper-service.ts`](../../src/services/paper-service.ts) — adds `oaUrl?: string` to both `PaperFrontmatter` and `PaperManualInput`; widens `createManual.sourceTag` to `PaperSource`; pipes `oaUrl` through `toFrontmatter` / `frontmatterToPaper`; honours the new `input.source` override.
- [`src/settings.ts`](../../src/settings.ts) — adds `citation: CitationSettings` to `ResearchVaultSettings`, populates `DEFAULT_SETTINGS.citation`, and default-fills in `migrateSettings` (L3 patterns; no version bump).
- [`src/core/events.ts`](../../src/core/events.ts) — imports the citation event types and adds `citationLookupSucceeded` + `citationLookupFailed` to `ResearchVaultEvents` (L5).
- [`src/core/plugin.ts`](../../src/core/plugin.ts) — adds `private citationService: CitationService \| null = null` and `ensureCitationService()` lazy getter (L4). `onload` does NOT construct the service.
- [`src/types/index.ts`](../../src/types/index.ts) — citation barrel re-exports (`CitationProvider`, `CitationSettings`, `CitationProviderClient`, `CslJsonRecord`, `CitationLookupSucceeded`, `CitationLookupFailed`, `CitationLookupFailureReason`, `DEFAULT_CITATION_SETTINGS`).

**Verification (all green)**
- `npx tsc --noEmit` — **exit 0**. Imports type-check; the `Pick<EventBus, 'emit'>` variance fix holds; `noUncheckedIndexedAccess` narrowing in `csl-to-paper.ts` (year / DOI regex captures) is sound.
- `npm run lint` — **0 errors, 0 warnings** across `eslint.config.mts`.
- `npm run build` (which runs `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`) — **exit 0**. Bundle delta measured against the 2.8.1 baseline of 88,190 bytes: **+4,157 bytes (+4.7%)** — main.js is now 92,347 bytes. The earlier design-doc estimate of "+1.0 to 1.4 KB" was for the orchestrator alone; the actual delta includes the 240-line `citation-service.ts`, two 60-line provider stubs, the 160-line `csl-to-paper.ts` mapper, the JSDoc-dense 170-line `types.ts`, and a handful of edits in `paper-service.ts` / `settings.ts` / `events.ts` / `plugin.ts` / `types/index.ts`. Still well within the 4.1.F budget; the final delta will be re-measured when 4.1.D + 4.1.G land.

**Known gaps (carried forward)**
- No UI bump yet. The modal's `Lookup` and `Search` buttons (planned for 4.1.C) do not yet exist.
- No `Citations` section in the settings tab yet (4.1.D). `enableCitationLookup` is `false` by default so the network path is gated off in the meantime.
- The rate-limit constants (`5 req/s, capacity 10`) and the cache dimensions (`30 d, 500 entries`) are still order-of-magnitude right and are subject to 4.1.B's re-verification against the live CrossRef / OpenAlex docs (kickoff §7.3).
- The `obsidianmd/no-global-this` rule flagged `globalThis.fetch?.bind(globalThis)` in the `fetchImpl` resolver. Fixed by switching to `window.fetch?.bind(window)` \u2014 the rule's `activeWindow` concern applies to DOM listeners, not network calls.

**Flagged for follow-up (not in 4.1.A scope)**
- `tsconfig.json:11` emits `Option 'moduleResolution=node10' is deprecated...` since before 4.1.A. This is a pre-existing warning, not introduced by 4.1.A. `node10` is the only value that pairs with `"module": "esnext"` in the current config; switching to `bundler` or `node16` requires touching `package.json`'s `"type": "module"` story and the Observian build, so it gets a 5.x pass.

**Files touched / added**
- Added: `src/services/citation/types.ts`, `src/services/citation/citation-service.ts`, `src/services/citation/csl-to-paper.ts`, `src/services/citation/providers/crossref.ts`, `src/services/citation/providers/openalex.ts`.
- Modified: `src/types/literature.ts`, `src/types/index.ts`, `src/services/paper-service.ts`, `src/settings.ts`, `src/core/events.ts`, `src/core/plugin.ts`, `plans/plan.md`.
- Untouched: `package.json`, `manifest.json`, `styles.css`, `versions.json`, anything under `src/ui/`.

**Hand-off contract for 4.1.B** — already documented in the kickoff entry above and re-stated here for traceability: replace the four provider stubs (`lookupByDoi`, `searchByTitle`, `searchByQuery` × 2 providers) with real `fetch` calls; add the LRU cache (`Map<doi, { record, fetchedAt }>`, TTL 30 d, cap 500); add the token-bucket rate limiter (`5 req/s, capacity 10`) wrapping `fetchImpl`. **4.1.B is the pass that re-verifies the rate-limit numbers against live CrossRef / OpenAlex docs** and may tune the constants. No call-site changes are expected; the modal (4.1.C) compiles against this skeleton unchanged.

---

### Sprint 4 — Sub-pass 4.1.B kickoff (real `fetch` + LRU + token-bucket + OpenAlex→CSL mapper — locked-preferences pass, logged 2026-07-22)

**Status:** **Kicked off; no code yet (this architect pass).** Mirrors the 4.1.A kickoff pattern. No UI yet (4.1.C's job). No settings tab yet (4.1.D's job).

**Honest re-verification stance.** The 4.1.A working hypothesis — `5 req/s, capacity 10, 30 d TTL, 500 cap` — **remains the working hypothesis** going into 4.1.B's implementation. The live CrossRef / OpenAlex docs cannot be reached from this tool environment (no web access at kickoff time; see the spike §6 honest caveat + the design doc §7.3). The final tuning moves to **4.1.E's manual smoke** (per the kickoff §7.3). If 4.1.E discovers the real numbers differ materially, the impact is contained: only the four `static readonly` constants in `citation-service.ts` move.

**Locked 4.1.B decisions (12 new, no user input required)** — full text in [`plans/citation-lookup-research.md`](./citation-lookup-research.md) §8.2:

- **B1.** Built-in `fetch`, not `axios` / `node-fetch`. Already plumbed through the 4.1.A `FetchImpl` dep. 0 KB cost.
- **B2.** CSL-JSON is the canonical on-wire shape. CrossRef serves it natively via `?transform=application/vnd.citationstyles.csl+json`; OpenAlex needs a hand mapper (B7). Single downstream CSL path keeps `csl-to-paper.ts` unchanged in 4.1.B.
- **B3.** LRU cache: single shared `Map<K, { value, fetchedAt }>`, TTL 30 d, cap 500, evict-oldest. `null` results cached too so 404s don't re-fire. Cache hits don't spend a token (B5).
- **B4.** Token-bucket: 5 tokens/s, capacity 10, single shared bucket across both providers. Per-provider isolation is a 4.1.1 follow-up if 4.1.E surfaces contention.
- **B5.** Order: `cache.get` first → `bucket.take` → `fetch`. Cache check is sync + free; a cache hit doesn't spend a token (modal re-click stays cheap).
- **B6.** Polite-pool contact surfaces as `User-Agent` header for CrossRef, `?mailto=` query param for OpenAlex. Both already plumbed through 4.1.A's `buildUserAgent` + `buildOpenAlexUrl` helpers.
- **B7.** OpenAlex native→CSL mapper is hand-rolled, ~80 LoC, no `@citation-js/core`. If 4.1.E surfaces edge cases that don't map cleanly, 4.1.1 may add the package (with an explicit bundle cost re-measure).
- **B8.** HTTP error mapping rules: 200 → success; 401/403 → `network`; 404 → `not-found` (lookupByDoi) / success-with-empty (search); 429 → one retry then `rate-limited`; other 4xx → `invalid-doi`; 5xx + fetch throws → `network`. Fills the 4.1.A-locked `CitationLookupFailureReason` union.
- **B9.** One retry budget. Only on 429, once. Other failures fail fast. Polite pool that returns 429 usually fixes itself with `Retry-After`; one retry captures that without spending a second token if `Retry-After` is large.
- **B10.** Telemetry payload is `provider`, `durationMs`, `cacheHit`, `doi?`, `query?` — exactly the fields already typed in 4.1.A's `CitationLookupSucceeded` / `CitationLookupFailed`. 4.1.B just fills them in.
- **B11.** Provider fallback for `searchByQuery` only: when CrossRef returns 0 hits, automatically try OpenAlex once. `searchByTitle` stays on the user's preferred provider (Q1) — swapping providers mid-title produces a confusing UI. Fallback is silent from the modal's perspective; the 4.1.C "Filled from …" line names whichever provider returned the record.
- **B12.** No new dependencies. Expected `main.js` delta over 4.1.A's 92,347 B baseline: +2.5–4.0 KB (→ ~94,500–96,500 B post-4.1.B). 4.1.B adds ~340 LoC across the LRU + token-bucket + mapper + provider rewrites. Final delta re-measured by 4.1.F.

**File surface (4.1.B)**

- New: [`src/services/citation/lru-cache.ts`](../../src/services/citation/lru-cache.ts) (generic, ~80 LoC, takes a `clock: () => number` for 5.x tests).
- New: [`src/services/citation/token-bucket.ts`](../../src/services/citation/token-bucket.ts) (~60 LoC, `async take()` interface, no busy-loop).
- New: [`src/services/citation/openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts) (~80 LoC, hand-rolled; reconstructs `abstract` from `abstract_inverted_index`).
- Rewrite: [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) — real `fetch`, `?transform=…` for lookup, `?query.bibliographic=…` and `?query.title=…` for search.
- Rewrite: [`src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts) — real `fetch`, `/works/doi:<doi>` and `/works?search=…` + `?mailto=…`.
- Wire: [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts) — the three public methods become `cache.get` → `bucket.take` → `provider.X(...)` → `cache.put` → `eventBus.emit(...)`. 4.1.A's `static readonly` constants move from "declared" to "enforced".
- 0 new dependencies. 0 UI changes. 0 settings-tab changes. 0 modal changes.

**Verification (4.1.B)**
- `npx tsc --noEmit` exit 0
- `npm run lint` exit 0
- `npm run build` exit 0; `main.js` size recorded
- 4.1.E's manual smoke handles the network correctness + rate-limit tuning (per B12's re-measure expectation)

**Hand-off contract for 4.1.C** — once 4.1.B ships, 4.1.C can start without further questions by:
- Adding three new buttons in [`paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts): `🔍 Lookup` next to the `doi` field, `🔍 Search by title…` next to the `title` field, `🔍 Query journals…` for the new `searchByQuery` bibliographic search.
- Each calls `plugin.ensureCitationService()` (4.1.A's L4) and uses the 4.1.B-wired orchestrator. The citekey preview re-runs after every successful fill via `refreshPreview()` (4.1.A's L6).
- The `autofilledFields: Set<keyof PaperImportForm>` pattern carries over from the §4.1.C plan unchanged.
- Error-reason copy is 4.1.C's: `disabled` → hide buttons; `not-found` → "No match for that DOI."; `rate-limited` → "CrossRef asked us to slow down. Try again in 30 s."; `network` → "Lookup failed (network or 5xx). Try again?"; `invalid-doi` → "Lookup refused by the provider. Check the DOI shape.".

**What 4.1.B does NOT do** — no UI changes, no settings tab, no modal buttons, no vitest fixtures (those land with 5.x setup), no README changes (those land in 4.1.G after 4.1.D–G ship).

**Files touched (in this architect-mode kickoff)** — only documentation. No `src/` changes yet.
- Modified: [`plans/citation-lookup-research.md`](./citation-lookup-research.md) (added §8), [`plans/plan.md`](../../plans/plan.md) (this entry + §13 table row update + the §14 detailed-phase row added in code mode).

### Sprint 4 — Sub-pass 4.1.B implementation (real `fetch` + LRU + token-bucket + OpenAlex→CSL mapper, shipped 2026-07-22)

**What shipped**

The four provider stubs that 4.1.A left behind are gone; `CitationService` now makes real HTTPS calls to CrossRef and OpenAlex, behind the same single public API the modal will call in 4.1.C. **No UI changes** — the modal still doesn't get Lookup / Search buttons until 4.1.C. Network calls are gated by `settings.citation.enableCitationLookup` (default `false`) so the path is off until 4.1.D lands the settings tab disclosure.

- **New modules (3)** in [`src/services/citation/`](../../src/services/citation/):
  - [`lru-cache.ts`](../../src/services/citation/lru-cache.ts) — generic `LruCache<K, V>` with `get` / `set` / `has` / `delete` / `clear` / `size`, TTL checked in `get` (expired entries deleted on read), cap-eviction in `set` (oldest-by-insertion dropped when over `maxEntries`). Negative caching supported (cache `null` and `[]` the same way as positive values). Injectable `clock: () => number` so 5.x vitest fixtures can fast-forward time. Public surface is `LruCacheOptions` + `class LruCache<K, V>`; ~80 LoC.
  - [`token-bucket.ts`](../../src/services/citation/token-bucket.ts) — `TokenBucket` with `tryTake()` (non-blocking), `take()` (Promise + `window.setTimeout` backoff — not a busy-loop), `available()` / `pendingCount()` / `drain()` for tests. `rps: number`, `capacity: number`, single shared instance across both providers per B3. Default fallbacks use `window.setTimeout` / `window.clearTimeout` to satisfy `obsidianmd/prefer-window-timers`; `setTimeoutImpl` and `clearTimeoutImpl` are injectable for tests. ~70 LoC.
  - [`openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts) — hand-rolled `openAlexWorkToCsl(work: OpenAlexWork): CslJsonRecord` mapper. Reconstructs `abstract` from `abstract_inverted_index` (position-keyed reverse-join per B5). Maps OpenAlex's `type` vocabulary to CSL's `type` vocabulary per B6. Pulls the OA PDF URL from `best_oa_location?.pdf_url` and stashes it on `Paper.oaUrl` via the existing `csl-to-paper.ts` bridge per B7. Helpers: `pickString`, `doiFromOpenAlexDoi`, `reconstructAbstract`, `buildIssuedDate`, `displayNameToCslAuthor`, `mapOpenAlexTypeToCsl`. ~210 LoC.
- **Provider rewrites (2)**:
  - [`providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) — real `fetch` against `api.crossref.org/works/<doi>?transform=application/vnd.citationstyles.csl+json` for lookup, `?query.title=…` for `searchByTitle`, `?query.bibliographic=…` for `searchByQuery`. Polite-pool `mailto` lives in the `User-Agent` header per B8: `ResearchVaultObsidianPlugin/0.0 (+https://github.com/researchvault) (mailto:<politeContact>)`. 50-row cap on search via `encodeLimit`. Throws `CitationLookupError` on non-2xx; orchestrator maps to `reason`. Public URL helper `buildCrossrefUrl(path, politeContact)` exported for testability.
  - [`providers/openalex.ts`](../../src/services/citation/providers/openalex.ts) — real `fetch` against `api.openalex.org/works/doi:<doi>` for lookup and `api.openalex.org/works?search=…` for `searchByTitle`. Polite-pool `mailto` lives in the `?mailto=…` query param per B8. Native → CSL via `openAlexWorkToCsl()` per record. Same `CitationLookupError` shape. Public URL helper `buildOpenAlexUrl(path, politeContact)` exported.
  - **Provider-shared helper:** [`providers/_fetch-helper.ts`](../../src/services/citation/providers/_fetch-helper.ts) — `applyObsidianFetch(injected): FetchImpl` resolves injected → `window.fetch?.bind(window)`, satisfying `obsidianmd/no-global-this` (no `globalThis.fetch` references anywhere in the citation module).
- **Orchestrator wiring** ([`citation-service.ts`](../../src/services/citation/citation-service.ts)) — 3 LRU caches (`lookupCache` keyed `doi:<lower>`, `titleSearchCache` keyed `q:title:<provider>:<lower>:<n>`, `querySearchCache` keyed `q:query:<provider>:<lower>:<n>`), 1 shared `TokenBucket`. Each public method: read settings → `cache.get` (B2: cache hits skip the bucket) → `bucket.take()` → `provider.X(...)` → `cache.put` (B10: negative `null` / `[]` results cached with the same TTL) → `eventBus.emit(citationLookupSucceeded | citationLookupFailed)`. `gatedCall<T>` helper does the 429 retry-with-jitter (`RATE_LIMIT_RETRY_BASE_MS = 250` + `RATE_LIMIT_RETRY_JITTER_MS = 100`). `mapError` translates `CitationLookupError` to the `CitationLookupFailed` reason enum from 4.1.A. **Provider fallback (B11):** `searchByQuery` CrossRef primary, auto-fallback to OpenAlex on 0 hits OR CrossRef 404. Public `clearCaches()` exposed for the 4.1.C "clear citation cache" button (and 4.1.D's settings-tab button).
- **Types** ([`types.ts`](../../src/services/citation/types.ts)) — added `CitationLookupErrorKind` and `class CitationLookupError extends Error` with `kind: 'not-found' | 'rate-limited' | 'network' | 'invalid-doi'` and optional `status`. The 4.1.A-defined `CitationLookupFailed['reason']` is unchanged; `mapError` translates between the two.

**Architectural decisions enforced (per the kickoff §8.2)**

- **B1.** Built-in `fetch` only — no `axios`, no `node-fetch`, no `p-queue`. The token-bucket is ~70 LoC and is exactly the surface we need.
- **B2.** CSL-JSON is the canonical on-wire shape. CrossRef serves it natively; OpenAlex maps via `openAlexWorkToCsl()`. Single downstream CSL path keeps `csl-to-paper.ts` **unchanged** in 4.1.B.
- **B3.** Single shared `TokenBucket` across both providers. CrossRef / OpenAlex polite pools don't talk to each other, but our outbound budget does.
- **B5.** OpenAlex abstract reconstructed from `abstract_inverted_index` (position-keyed reverse-join, `Array<string | undefined>(maxPos + 1)` to seed empty slots, then `slots.filter(Boolean).join(' ')`).
- **B6.** OpenAlex `type` vocabulary mapped to CSL's; unknown values pass through unchanged so the modal can still display the raw label.
- **B7.** OA PDF URL from `best_oa_location?.pdf_url` → `Paper.oaUrl` via the existing `cslToManualInput` bridge.
- **B8.** Polite-pool `mailto` — CrossRef: `User-Agent` header; OpenAlex: `?mailto=` query param. Both are no-ops when `politeContact` is empty.
- **B9.** Error mapping: 200 → success; 401/403 → `network`; 404 → `not-found` for `lookupByDoi` / success-with-empty for `searchByTitle` and `searchByQuery` (the orchestrator does the empty-list translation, not the provider); 429 → one retry with backoff (250 ms ± jitter) → `rate-limited` if still 429; other 4xx → `invalid-doi` for `lookupByDoi` / success-with-empty for search; 5xx + fetch throws → `network`.
- **B10.** Negative results cached (`null` for known-bad DOIs, `[]` for no-hit searches) with the same TTL.
- **B11.** Provider fallback for `searchByQuery` only — CrossRef primary, auto-fallback to OpenAlex on 0 hits OR CrossRef 404. `searchByTitle` stays on the user's preferred provider (Q1) to keep the modal UI coherent.
- **B12.** Test seams: `clock` injectable on `LruCache` and `TokenBucket`; `FetchImpl` injectable on `CitationServiceDeps` and on `ProviderFetchOpts`.

**Honest re-verification stance (carried forward from kickoff §7.3)**

The `5 req/s, capacity 10, 30 d TTL, 500 cap` numbers remain the working hypothesis. Live CrossRef / OpenAlex docs cannot be reached from this tool environment (no web access; design doc §7.3 + spike §6 honest caveat). The final tuning moves to **4.1.E's manual smoke**. The constants live as `static readonly` inside `CitationService` so a 4.1.E tuning pass is a one-line edit each.

**Verification (4.1.B)** — all green
- `npx tsc --noEmit` — exit 0
- `npm run lint` — exit 0, **0 errors, 0 warnings** (one round of fixes during impl: `new Array(n)` → `new Array<string>(n)` for `lib.dom`'s `any[]` typing; `setTimeout` / `clearTimeout` → `window.setTimeout` / `window.clearTimeout` for the `obsidianmd/prefer-window-timers` rule; two `as unknown as T` casts dropped entirely once we confirmed `object` is structurally assignable to all-optional `CslJsonRecord` and `OpenAlexWork`).
- `npm run build` — exit 0
- `main.js` byte delta: **+13,493 B** over the 4.1.A baseline (92,347 B → **105,840 B**). **Note:** 4.1.A's design doc estimated +1.0–1.4 KB and shipped +4,157 B (3x). 4.1.B's design doc estimated +2.5–4.0 KB and shipped +13,493 B (3.4–5.4x). The LRU + token-bucket + 3rd provider file + the OpenAlex mapper's defensive helpers (B5/B6/B7) added more esbuild output than the LoC count predicted. 4.1.F (final bundle-cost gate) re-measures and decides whether 4.1.1 / 5.x need a slim-down pass.

**Files touched (4.1.B)**
- **Added** (3 modules + 1 helper): [`src/services/citation/lru-cache.ts`](../../src/services/citation/lru-cache.ts), [`src/services/citation/token-bucket.ts`](../../src/services/citation/token-bucket.ts), [`src/services/citation/openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts), [`src/services/citation/providers/_fetch-helper.ts`](../../src/services/citation/providers/_fetch-helper.ts).
- **Rewritten** (3): [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts), [`src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts), [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts).
- **Modified** (1): [`src/services/citation/types.ts`](../../src/services/citation/types.ts) — added `CitationLookupErrorKind` and `class CitationLookupError`.
- **Unchanged** (4.1.A's surface, as designed): [`src/settings.ts`](../../src/settings.ts), [`src/core/plugin.ts`](../../src/core/plugin.ts), [`src/core/events.ts`](../../src/core/events.ts), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts), [`src/services/paper-service.ts`](../../src/services/paper-service.ts), [`src/services/csl-to-paper.ts`](../../src/services/csl-to-paper.ts). The `Paper.oaUrl?` field added in 4.1.A is the only new field; `PaperService.createManual` already accepts it.

**Hand-off contract for 4.1.C** — already documented in the kickoff entry above and re-stated for traceability. After 4.1.B lands, 4.1.C can assume:
- (a) `plugin.citationService.lookupByDoi(doi)` returns `CslJsonRecord | null`; emits `citationLookupSucceeded` with `cacheHit` + `durationMs` on success, `citationLookupFailed` with one of the 5 reasons on failure; **never throws** for known-mapped errors (5xx / network throws are caught + mapped to `network`).
- (b) `plugin.citationService.searchByTitle(query, limit)` returns `CslJsonRecord[]`; same event-emission contract; **never throws** for known-mapped errors.
- (c) `plugin.citationService.searchByQuery(query, limit)` returns `CslJsonRecord[]` with CrossRef-primary / OpenAlex-fallback per B11; same event-emission contract.
- (d) `plugin.citationService.clearCaches()` wipes all 3 LRU caches (4.1.C wires a "Clear cache" affordance if useful; 4.1.D wires the same to a settings-tab button).
- (e) `plugin.citationService.importCslJson(text)` — already fully implemented in 4.1.A, **unchanged** in 4.1.B; the modal can call it for the 4.1.1 generic CSL-JSON paste affordance (when 4.1.1 lands).

**What 4.1.B does NOT do** — no UI changes, no settings tab, no modal buttons (4.1.C), no vitest fixtures (5.x), no live network test (4.1.E), no final bundle-cost gate (4.1.F), no README privacy disclosure (4.1.G).

**Modified** (this entry only): [`plans/plan.md`](../../plans/plan.md) (this entry + §13 table row update + the §14 row flip from `[ ]` to `[x]`).

---

### Sprint 4 — Sub-pass 4.1.C+D (DOI Lookup + Search-by-title buttons wired into PaperImportModal; Citations settings tab visible; drift-audit caught 3 spec drifts and shipped corrections; landed 2026-07-25)

**Goal.** 4.1.C wires the `Lookup DOI` and `Search by title...` buttons into [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts); 4.1.D lands the Citations settings section in [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) between Projects and AI. Both sub-passes shipped on 2026-07-22, but a drift audit against [`plans/citation-lookup-research.md` §3](./citation-lookup-research.md#3-sprint-4-sub-pass-41-doi-lookup--proposed-phase-plan) and the design-doc §1.3 privacy contract on 2026-07-25 found **3 spec drifts** that had to be fixed.

**Drifts found and fixed.**

1. **Notice → inline modal status.** `performDoiLookup` used a global `new Notice()` for every state. Spec calls for a *modal-internal* status line so the user sees the message in context. Replaced with a `statusEl: HTMLElement | null` field plus a `setStatus(message, kind)` helper. Modal `contentEl` carries a `researchvault-import-status` class; status is reset on each new click and on `onClose`.

2. **Feature description → privacy disclosure.** Citations settings-tab `<p>` described the feature instead of the **privacy** contract. Replaced with verbatim design-doc §1.3 wording: *"Lookups send only the doi or search string you typed; no vault content is sent; responses cached locally for 30 days; `mailto:` is opt-in and only sent to your chosen provider's polite pool."*

3. **Hardcoded `'crossref'` → `preferredProvider()`.** [`src/ui/modals/citation-search-modal.ts`](../../src/ui/modals/citation-search-modal.ts) stamped each row with the literal `'crossref'` even when OpenAlex was preferred, producing false provenance. Added a `preferredProvider(): string` getter on `CitationService` (read-only access to `this.settings.citation.preferredProvider`) and parameterised the row template.

**Drift #4 deferred.** No Privacy section exists in the README yet (it is the 4.1.G item). Skipping this sub-pass; flagged for 4.1.G.

**Track-on-edit semantics** (locked in 4.1.C): `autofilledFields: Set<keyof PaperImportForm>` on the modal. `onChange` removes the corresponding field from the set (user edit wins). `applyAutofill` checks membership before overwriting, so the *"fix the year but keep my title"* case lands cleanly.

**Files modified.** [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (`statusEl`, `setStatus`, `autofilledFields`, `performDoiLookup` rewrite, `openSearchByTitle` rewrite); [`src/ui/modals/citation-search-modal.ts`](../../src/ui/modals/citation-search-modal.ts) (hardcoded `'crossref'` → `this.citationService.preferredProvider()`); [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) (Citations section already in place from 2026-07-22; drift-audit repaint of privacy disclosure paragraph on 2026-07-25); [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts) (single additive edit: `preferredProvider(): string` getter immediately after `clearCaches()`).

**Files NOT touched.** Providers/*, src/settings.ts, src/types/*, manifest.json, package.json, esbuild.config.mjs all unchanged for this drift-audit repaint.

**Bundle cost.** main.js delta **+715 B** over the 4.1.B baseline of **+13,493 B**. Cumulative citation-feature overhead since the 4.1.A start is **~+14,200 B total** (vs the 7 KB budget per design-doc §1.3). §14 row 4.1 is on track to overshoot — decision (accept / trim / defer 4.1.G) deferred to 4.1.F per the dated §8 caveat.

**Verification gates.** `npx tsc --noEmit` exit 0; `npm run lint` exit 0 with 0 errors / 0 warnings (`obsidianmd/ui/sentence-case` flagged original `Api` → corrected to `API`); `npm run build` exit 0.

**Why combined 4.1.C+D in one sub-pass.** All three drifts were caught in the same audit pass and the `setStatus` helper + `preferredProvider()` getter cross-reference each other (the provider getter is consumed by the privacy disclosure text). Splitting into two dated entries would leave a stale *"#2 found, #3 not yet"* reading. Combined pass is cleaner.

**Cosmetic note.** The §14→§15 heading order in the recovered rTGX.md source has §15 appearing (a few lines) *before* §14. Pre-wipe worktree state, preserved through the restore. Purely cosmetic; does not affect §13 history, §14 row content, or §15 prose draft. 5.x polish can swap the order if it ever matters.

### Sprint 4 — Sub-pass 4.1.F (bundle-cost gate measurement + 4.1.F.1 trim pass — measured, trimmed, landed 2026-09-27)

**Goal.** 4.1.F is the design-doc §1.3 gate: measure the citation feature's real bundle cost against the **7 KB budget** and decide accept / trim / defer. Measurement was done first; the user then chose **option (b) — trim code in a 4.1.F.1 pass** over accepting the overshoot or deferring.

**Measurement (4.1.F proper).** First attempt at a historical baseline — building the pre-citation commit `68ee65d` in a detached worktree — produced **444,433 B**, an apples-to-oranges number: the old `esbuild.config.mjs` still bundled `pdfjs-dist` (removed in the D27 link-only re-scope), so the delta is meaningless. Pivoted to the definitive method: `--metafile` per-module `bytesInOutput` analysis of the current bundle. Result: citation modules **19,736 B minified of 114,552 B total (17.2%)** vs the 7 KB budget = **2.8× overshoot**. Largest single dependency in the whole bundle is `fuse.js` at 26,371 B (pre-existing, not citation).

**Usage scan before trimming.** Two search passes established the live/dead map: `openalex-to-csl.ts`'s **only** consumer was `providers/openalex.ts` (not `citation-service.ts` as originally assumed — folding into the sole consumer is the cleaner cut); `clearCaches()` had **zero callers** anywhere in `src/`; `importCslJson` had no external callers but `cslToManualInput` is live in two places.

**Key insight.** esbuild inlines everything into one IIFE, so *moving* code between files saves ~0 minified bytes — **deleting dead code is what saves bytes**. This reshaped the trim plan from "reorganize" to "delete + simplify".

**Trims executed (4.1.F.1).**

1. **Folded `openalex-to-csl.ts` into `providers/openalex.ts`** and deleted the standalone file. During the fold: `reconstructAbstract` rewritten from the slot-array approach to a stable sort of `(position, word)` pairs (ES2019+ sort is stable, so tie order is preserved); `mapOpenAlexTypeToCsl` rewritten from a 12-case `switch` to a lookup table; `doiFromOpenAlexDoi` collapsed to a prefix loop; `OpenAlexWork`, `openAlexWorkToCsl`, and `buildOpenAlexUrl` un-exported (no external consumers).
2. **Deleted `clearCaches()`** from `CitationService` (dead since 4.1.B — no caller ever wired up; 4.1.D did not ship a Clear-cache button). If a Clear-cache button ever ships, the method is a 3-line re-add.
3. **Kept `importCslJson()`** despite having no callers today — it is the exact entry point 4.1.1 (generic CSL-JSON paste) and 5.1 (Zotero web API read-in) will call, and it is part of the 4.1.A public-API contract. Deleting it to re-add next sub-pass is churn for ~200 B. Documented here as a deliberate keep.
4. **Modal wiring squeeze: no safe cuts found.** Every block examined in `applyAutofill` / `performDoiLookup` / `setStatus` / `updateLookupButton` is wired to a live UI path (track-on-edit semantics, inline status, button state). The ~15 KB the modal contributes is feature surface, not scaffolding.

**Result.** Apples-to-apples CLI build of HEAD vs post-trim (same flags, same metafile method, citation subtotal including `citation-search-modal`): **20,893 → 20,400 B minified = −493 B**; wire size 114,685 → 114,192 B (main.js SHA-256 `d1134729…`). Citation feature now **20,400 B ≈ 2.9× the 7 KB budget** — the trim was honest but modest, because esbuild was already deduplicating across the module boundary and the remaining bytes are almost all live feature code. Closing the overshoot further means cutting *features* (e.g. the CrossRef↔OpenAlex B11 fallback, or provider choice), which is a user decision, not a refactor.

**Files touched.** `src/services/citation/providers/openalex.ts` (fold + simplifications); `src/services/citation/citation-service.ts` (`clearCaches()` deleted); `src/services/citation/openalex-to-csl.ts` (**deleted**).

**Files NOT touched.** `crossref.ts`, `csl-to-paper.ts`, `token-bucket.ts`, `lru-cache.ts`, `types.ts`, `_fetch-helper.ts`, `citation-search-modal.ts`, `paper-import-modal.ts`, `settings-tab.ts`, `src/types/*`, `esbuild.config.mjs`, `manifest.json`.

**Verification gates.** `npx tsc --noEmit --skipLibCheck` exit 0; `npm run lint` exit 0; production build exit 0.

**Honest caveats.** (a) The two metafiles came from different build invocations of the same source — the apples-to-apples −493 B figure supersedes the earlier 19,736 B subtotal, which under-counted by excluding `citation-search-modal.ts`. (b) The 2.8× → 2.9× shift in the ratio is arithmetic (recomputed denominator), not new cost. (c) `importCslJson` (~230 B minified) is dead weight carried deliberately; it becomes live the moment 4.1.1 ships. (d) Baseline worktrees (`/tmp/rv-pre-4p1`, `/tmp/rv-4p1f-base`) were created for measurement and removed after; stale `main.js` backups remain in `wip/`.

---

### Sprint 4 — Sub-pass 4.1.E (manual smoke — 4 findings fixed, 2 UX polish passes shipped 2026-09-27)

**Goal.** Click through Lookup DOI + Search by title in the real test vault, per the §14 4.1.E row. The smoke was run by the user in `ResearchVault-Test` against a freshly deployed build.

**Findings fixed (4).**

1. **CrossRef dropped the `transform` query param → all lookups got HTTP 400** (commit `1f00cc3`). CrossRef retired the `?transform=application/vnd.citationstyles.csl+json` flag; the provider now parses the native response's nested `message` object instead.
2. **CSL text fields arrive as `string | string[]` → `.trim is not a function`** (commit `67e043e`). CrossRef wraps some fields in arrays post-transform-removal; `asText`-style normalization applied at the mapping boundary.
3. **Autofill left the visible inputs empty** (commit `a4adc94`). `applyAutofill` mutated only `this.form` state while Obsidian's `TextComponent`s kept their own DOM value. Fix: the modal caches component refs (`inputRefs`) and ends autofill with a `syncInputs()` pass; `setValue()` does not fire `onChange`, so track-on-edit semantics are undisturbed. +607 B.
4. **README privacy disclosure missing** (the drift #4 from 4.1.C+D, shipped separately as 4.1.G — see its dated entry).

**UX polish (2, both user-requested during the smoke).**

1. **Search-results column grid** (commit `1196072`): result rows restructured into a Title | Authors | Year grid with a muted column-header row; em-dash placeholders keep columns aligned; ellipsis truncation on title/authors; tabular-nums year. The search modal had *zero* CSS before this pass. +282 B.
2. **Auto-run pre-filled search** (commit `3ee9a48`): opening the search modal from Search-by-title now executes the query immediately instead of requiring a second Search press; input keeps focus for editing. +72 B.

**Smoke verdict.** User-confirmed: DOI lookup autofills the form visibly, search + selection work, auto-search on open confirmed "works perfect". **4.1.E PASSED 2026-09-27.**

**Bundle cost.** main.js 114,192 → 115,153 B (+961 B across fixes #3 and both polish passes). Cumulative citation-feature cost: ~21,361 B minified.

**Verification gates.** Every fix individually green: tsc 0 / lint 0 / build 0 / deployed.

**Honest caveats.** (a) Fixes #1 and #2 landed in a parallel session — this entry consolidates them for §13 completeness. (b) The 429/rate-limit path was not deliberately exercised (no easy way to trigger CrossRef throttling by hand); it remains covered by the token-bucket unit contract only. (c) Rate-limit tuning (B4/B9 constants) was "deferred to 4.1.E" per §8.3 — the smoke found no need to retune, so the locked numbers stand.

---

### Sprint 4 — Sub-pass 4.1.G (README privacy disclosure for `D29` — shipped 2026-09-27)

**Goal.** `D29` citation lookup is the first network feature outside `AIClient`, so the plugin-guideline rule applies: every external endpoint must be disclosed in the README. This was also drift #4 deferred from the 4.1.C+D audit.

**Change.** Endpoint-level disclosure paragraph added to **both** the shipped `README.md` "Privacy & external services" section and the §15 canonical draft (lift-and-paste rule: §15 is the prose source of record). The paragraph names the two endpoints (`api.crossref.org`, `api.openalex.org`), states what leaves the device (only the DOI or search string typed by the user — never vault content), discloses the 30-day local response cache, and documents the polite-pool `mailto:` contact as opt-in and scoped to the chosen provider. Wording mirrors the settings-tab disclosure repainted in the 4.1.C+D drift audit.

**No code changes.** Docs-only sub-pass; no build, no bundle delta.

**Verification.** Text-only review — both locations carry the same contract: opt-in, endpoint-named, no vault content, cache disclosed, mailto scoped.

## 15. README Source — GitHub README Prose Draft

## 14. Upcoming Implementation Passes — Detailed Phase Plans

> **How to read.** Every pass here corresponds to a row in §13's "in-progress / queued" table. When a pass finishes, strike it through **here** and append a dated entry in §13 (per maintenance rule 2 in the hub header). This stays as granular as possible so scope creep is obvious before code lands.

### 2.2 `PaperImportModal` — manual-only metadata form  `[x]` (shipped in sub-pass 2.2+2.5)
- **Surface.** Modal opened by the `add-paper` command.
  - **Active project dropdown** at top — defaults to the project that owns `app.workspace.getActiveFile()` if applicable.
  - **Form fields:** `title*`, `authors*` (comma-separated), `year`, `journal`, `doi`, `abstract` (textarea), `tags`, `pdfPath` (string, optional, free-form only — no upload, no extraction yet).
  - **Live citekey preview** rendered next to the form via `composeCitekey({author, year, title})`.
  - **Buttons:** "Cancel" (closes without committing) and "Add paper…" (primary; disabled while required fields are blank or no active project is set).
- **Validation.** Empty required → inline red message + focus first offender. Bad year (non-numeric, < 1000, > `currentYear + 5`) → same treatment. Citekey collision → call `generateUniqueCitekey(parts, isTaken)` against the in-memory index and show the new key before commit.
- **Submit path.** `await paperService.createManual(input, activeProjectId)` → modal closes → `Notice: Imported [citekey]` + emission of `paperImported`. File is freshly minted at `<project>/papers/<citekey>.md`.
- **Files (new).** [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts).
- **Files (modified).** none in 2.2; wiring lands in 2.5.
- **Pre-reqs.** `PaperService.createManual` (done in 2.1), `composeCitekey`, `generateUniqueCitekey`, `ProjectManager.listProjects`.
- **Verification gates.** `npm run build`, `npm run lint`, `npx tsc --noEmit` all `exit 0`. Manual click-through at 2.manual-smoke.
- **Deferred.** DOI lookup, PDF upload + extraction, BibTeX import — all `notImplemented` until later passes.

### 2.3 `ProjectsSidebarView` — ItemView paper list  `[x]` (shipped in sub-pass 2.2+2.5)
- **Surface.** Right-sidebar ItemView registered as `VIEW_TYPE_RESEARCHVAULT_SIDEBAR`.
  - **Header.** Active project name + small "switch project" combo bound to `ProjectManager.setActiveProject`.
  - **Body.** Papers grouped by status (Reading, Backlog, Read, Archived) — each row: title, short citekey, status badge, click-to-open (`workspace.openLinkText`).
  - **Inline status dropdown** per row → `paperService.updateStatus(id, status)`; sidebar re-renders the affected row on `paperStatusChanged`.
- **Reactivity.** Subscribes to `paperImported` / `paperStatusChanged` / `projectSwitched` through the plugin's typed emitter.
- **Files (new).** [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts). Adds a new subfolder `src/ui/views/` to the layout in §4.2.
- **Files (modified).** none in 2.3.
- **Pre-reqs.** Events exist in [`core/events.ts`](../../src/core/events.ts) (done in 2.1), `PaperService.getInProject`, `ProjectManager.getProject`.
- **Verification gates.** CI clean. Manual: open sidebar, click a paper, flip status, confirm frontmatter mutated end-to-end.
- **Deferred.** Filter / search input — depends on `VaultIndexer` (3.x).

### 2.4 `QuoteCaptureModal` — selection → quote  `[x]` (shipped in sub-pass 2.4+2.recon)
- **Surface.** Invoked via the `capture-quote` command using the `editorCallback` signature — only meaningful with an `Editor`, an active selection, and an active project context. Outside that, it falls back to a `Notice` listing the missing precondition.
- **Form fields.** "Attach to paper" picker (`PaperService.getInProject`; default = most-recent import), optional `locator` (string), optional `commentary` textarea.
- **Submit path.** `await paperService.addQuote(paperId, { text: selection, locator, commentary, source: 'editor' })` → modal closes → `Notice` + emission of new `quoteAdded` event.
- **Files (new).** [`src/ui/modals/quote-capture-modal.ts`](../../src/ui/modals/quote-capture-modal.ts).
- **Files (modified).** [`core/events.ts`](../../src/core/events.ts) — add `quoteAdded` to the event union.
- **Pre-reqs.** `PaperService.addQuote` (done in 2.1), `Editor`, `MarkdownView` from the Obsidian API.
- **Verification gates.** CI clean. Manual: select text inside a paper note, capture, confirm `## Quotes` heading gains the new line(s) with `source: editor`.
- **Deferred.** PDF highlight extraction — 2.6.

### 2.5 Commands + ribbon  `[x]` (shipped in sub-pass 2.2+2.5)
- **Commands.**
  - `researchvault:add-paper` → [`PaperImportModal.open(this)`](../../src/ui/modals/paper-import-modal.ts).
  - `researchvault:capture-quote` → `editorCallback`; NoOp outside editor + selection + active project context; emits a `Notice` describing the missing piece.
  - `researchvault:open-sidebar` → `app.workspace.getRightLeaf(false)?.setViewState({type: VIEW_TYPE_RESEARCHVAULT_SIDEBAR})`.
- **Ribbon.** Document icon in the left rail → `open-sidebar`.
- **Files (new).** [`src/core/commands.ts`](../../src/core/commands.ts) — keeps the handlers tiny; real work is in the modals.
- **Files (modified).** [`core/plugin.ts`](../../src/core/plugin.ts) — `onload` calls `registerCommands(this)` and holds the view-type constant.
- **Verification gates.** Commands visible in **Command Palette**, `exit 0` for build / lint / tsc.

### 2.6 PDF import (browse / drag-drop + wikilink into paper note)  `[x]` (shipped three times — 2026-07-12 as PdfService + pdfjs-dist, then re-scoped 2026-07-13 to link-only per `D27`, then priority-fixed 2026-07-13 per `D28`)
- **Goal.** `PaperService` learns to attach a PDF to a paper note. Allow users to drop a PDF (or pick one from the vault) and have it *linked* from the paper note, with the PDF stored under the project's own `pdfs/` folder.
- **History of the shape.**
  - **2026-07-12 — `PdfService` + `pdfjs-dist`.** First cut tried to extract text and synthesise a paper from the PDF. Unusable in Obsidian's plugin sandbox (`pdfjs-dist@4.x` calls `process.getBuiltinModule(...)` at module-load time and needs a Web Worker host). Phase G surfaced four user-visible problems that the rewrite fixes (see `D27` in §3 and the `### Sprint 2 — Sub-pass 2.7` dated entry in §13).
  - **2026-07-13 — link-only re-scope (`D27`).** `createFromPdf(pdfPath, projectId)` is now a **link-only** importer: copy the PDF into `<project>/pdfs/<citekey>.pdf` (collision-safe `-2 -3 …` suffixes), write the paper note at `<project>/papers/<citekey>.md` with the same template as `createManual`, and inject a `## Attached PDF` section containing `[[../pdfs/<citekey>.pdf|View PDF]]`. The modal info line under the PDF setting always shows the linked destination (`Linked PDF: …` when picked, `PDFs will be copied to: …/pdfs/` when a project is selected). Drag-drop and the vault picker both route into `pdfs/` instead of `papers/`.
  - **2026-07-13 — priority fix (`D28`).** Phase G on the link-only build surfaced a sharper bug: filling in `title` / `authors` / `year` *and* attaching a PDF still produced an `anon_<basename>_<uuid>` paper because the modal routed to `createFromPdf` first, which then synthesised a stub record from the PDF basename. The PDF is now an *attachment only*: `createManual` accepts an optional `attachPdfFrom` and copies the file itself; the public `createFromPdf` is a private stub that `throw`s; submit always goes through `createManual` so the typed metadata is preserved verbatim. The PDF setting in the modal was relabelled `Attached PDF` and the intro copy makes the manual-first contract explicit.
- **Final surface (2.7.1).** One submission path. One copy step (lives in `createManual` so it works the same for hand-typed and PDF-attached papers). No silent metadata fallback. No public `createFromPdf` to misuse.
- **Deferred to a future pass.** PDF text extraction (`extractQuotesFromPdf`, `findCitationsInPdf`) — these still throw `notImplemented` with a `D27` reason pointing the caller at `QuoteCaptureModal` / manual `addQuote`. Re-enabling extraction will need a worker shim that's sandbox-safe.
- **Bundle cost (post-2.7.1).** `pdfjs-dist` removed (none). Worker asset removed (none). `main.js` 84.1 KB — ~0.9 KB net vs the 2.7 build (the `createFromPdf` body and the modal's `usePdfImport` branching are both gone, so the cold path is shorter than the hot one). Overall release size **decreased** by ~1.4 MB once the worker file is gone from the bundle.
- **Mobile.** No special wiring required any more — link-only reading is uniform desktop + mobile; `D27` supersedes the previous `D26` desktop-only caveat.
- **Files (modified since 2026-07-12).** [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (link-only `createFromPdf` → `attachPdfFrom` on `createManual` → stub `throw`; deleted `buildPdfBody` / `renderAttachedPdfSection`; added `upsertAttachedPdfSection` + `refreshAttachedPdfBody`), [`src/services/project-manager.ts`](../../src/services/project-manager.ts) (`getProjectPdfsFolder`), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (info line + drop-zone reroute + `D28` copy + `usePdfImport` removed + `submit()` always goes through `createManual`), [`styles.css`](../../styles.css) (info-line style), [`esbuild.config.mjs`](../../esbuild.config.mjs) (externalization removed), [`scripts/deploy-to-obsidian.mjs`](../../scripts/deploy-to-obsidian.mjs) (`pdf.worker.min.mjs` removed from `OPTIONAL`), [`package.json`](../../package.json) (dep removed), [`plans/plan.md`](../../plans/plan.md) (`D27` + `D28` added; this entry rewritten; §13 2.7 + 2.7.1 dated entries appended).
- **Files removed since 2026-07-12.** [`src/services/pdf-service.ts`](../../src/services/pdf-service.ts), [`src/services/pdf/loader.ts`](../../src/services/pdf/loader.ts), top-level [`pdf.worker.min.mjs`](../../pdf.worker.min.mjs).
- **Verification gates.** `npm run lint` / `npm run build` / `npx tsc --noEmit` all `exit 0`; `node scripts/deploy-to-obsidian.mjs` clean. Manual click-through at 2.manual-smoke now covers three sub-checks: (a) PDF-only drop still lands in `pdfs/` with a wikilink inside the note; (b) **manual metadata + PDF attach** is the bug-fix case — typed values must appear verbatim in frontmatter and the citekey must be derived from the typed author/year/title, not the basename; (c) edit mode preserves an existing PDF attachment when no replacement is picked.

### 2.8 UI / data-format polish batch (modal width, drop-zone copy, `YYYY-MM-DD | HH:MM` dates, `dateModified` re-stamp, authors as YAML list)  `~~[ ]~~` → **Shipped 2026-07-14 in sub-pass 2.8.** Manual click-through still pending (2.8.smoke). Absorbed into the 2.8 dated entry in §13; see §13 for full details.

### 2.8.1 Attached-PDF row squish fix (mount help text + drop zone + path-info on **`root`** as full-width siblings below the Setting row)  `~~[ ]~~` → **Shipped 2026-07-21 in sub-pass 2.8.1** (second-cut patch; the first-cut `pdfSetting.settingEl.createDiv` attempt was rolled back after an eyeball pass found it made the row worse — flex row, name column clipped, drop zone a sliver). Pure UI-tree repair; no schema / type / event / behaviour change; reuses `D22`–`D28`. Absorbed into the 2.8 dated entry in §13 alongside the new 2.8.1 dated entry above.
### 2.9 Sidebar filter chip row + author autocomplete + saved filter state  `[ ]` (planned, not started)

**Goal.** Turn the sidebar search bar from a single fuzzy text input into a *structured filter*: a chip row above the list (status / priority / year / hasPdf / hasNotes) + a typeahead author picker (autocomplete sourced from the project's `paper.authors` set, much simpler after 2.8.E since `authors` is now a flat `string[]`) + optional saved filter state per project. The goal is the same as a Gmail "filter chips" or Notion "filtered view" — the user can drill in fast without leaving the sidebar.

**Why deferred from 2.8.** 2.8 only fixed the focus-loss bug + relaxed Fuse `minMatchCharLength` / `threshold`. The full filter overhaul touches the sidebar view, the vault indexer, the settings tab (saved-filter-state is a per-project preference), and at least one new modal (the author typeahead picker). Worth its own sub-pass to keep 2.8 small and reviewable.

**Surface (new files).**
- [`src/ui/views/sidebar-filters.ts`](../../src/ui/views/sidebar-filters.ts) — `SidebarFilterState` type (`{ status: ReadingStatus[]; priority: Priority[]; year?: { from?: number; to?: number }; hasPdf?: boolean; hasNotes?: boolean; authorQuery?: string }`), the `applyFilters(items, state, fuse)` helper, the `serializeFilter(state)` / `deserializeFilter(json)` pair, and a `defaultFilter()` factory.
- [`src/ui/modals/author-picker-modal.ts`](../../src/ui/modals/author-picker-modal.ts) — small typeahead modal listing the project's distinct `paper.authors` (and `paper.authorFirstNames?` paired display) sorted by descending paper count. Picking an author emits a `filterSet` bus event so the sidebar updates without re-rendering the whole view.

**Surface (modified files).**
- [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) — render a chip row above the existing paper list. Each chip is a small toggle (status: one of `unread`/`queued`/`skimming`/`reading`/`annotating`/`summarized`/`synthesized`/`archived`/`excluded`; priority: one of `low`/`medium`/`high`/`critical`; year: optional from/to fields; hasPdf / hasNotes: boolean toggles). Chips are hidden when the project has no papers in that category. A small "Filters: 2" badge in the header (parallel to the existing search input) shows the active filter count. The author picker button lives next to the search input and opens `AuthorPickerModal`.
- [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts) — `searchPapers` already accepts a `SearchFilters` shape; extend it with the new filter fields (status multi-select, priority multi-select, year range, hasPdf, hasNotes, authorQuery). The `applyFilters` helper inside this file already does most of the work — just thread the new fields through. Re-tune Fuse weights if status/priority text matching becomes confused with title/author matching (status is a categorical enum, so it should be an exact-match check, not a fuzzy match — `IndexedPaper.status === filter.status[i]`).
- [`src/types/project.ts`](../../src/types/project.ts) — optional `Project.sidebarFilter?: SidebarFilterState` field. `migrateSettings` 0.4.0 → 0.5.0 step backfills `undefined` for old projects (no migration prompt — empty filter state is the natural default).
- [`src/settings.ts`](../../src/settings.ts) — bump `version` to `0.5.0`; add the migration step.
- [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) — new per-project section: "Sidebar default filter" with a `Reset to default` button + a description of where the filter state is stored (under the project record, not the plugin settings).
- [`src/core/events.ts`](../../src/core/events.ts) — new `filterChanged: { projectId: string; state: SidebarFilterState }` bus event so the sidebar list re-renders without re-running Fuse on the project change.

**Filter semantics (locked).**
- **Within a chip category** (e.g. status), chips OR together. Selecting `reading` + `skimming` means "status is `reading` OR `skimming`".
- **Across chip categories** (status vs priority vs year vs hasPdf vs hasNotes vs author), categories AND together. Selecting `status:reading` + `priority:high` means "status is reading AND priority is high".
- **Author query** is a Fuse substring search against the project's `IndexedPaper.authorsText` field (already populated by 2.8.E's `projectFor`). When the user picks from the typeahead, the chip becomes a tagged pill displaying the full name (`Vaswani, Ashish` when the parallel `authorFirstNames` is present, `Vaswani` when not).
- **Free-text search** continues to AND with the chip filters. The existing Fuse query handles title / citekey / author fuzzy matching; chips handle the structured predicates.
- **Empty chip selection = no filter on that category.** A `[]` status array means "any status", same as not selecting any status chips.

**Saved filter state (per project).** When the user closes and reopens Obsidian, the chip row reconstructs from `Project.sidebarFilter` (persisted via `ProjectManager.updateProject`). The sidebar's `projectChanged` listener re-hydrates the filter state on active project switch. A `Reset to default` action in the project settings tab clears it back to the empty default.

**Out of scope (deferred beyond 2.9).**
- **Structured query syntax** (e.g. `status:reading author:Vaswani`) in the search input — would require a small parser. The chip row covers the common cases; structured query is a power-user follow-on if it earns its keep.
- **Cross-project filter** — the chip row filters within the active project only. A future "All projects" toggle would need a different sidebar view.
- **Saved filter presets** — the user can manually replicate a saved filter by hand for now. Presets (named + shareable) is a 5.x polish item.

**Bundle cost.** Roughly 400 LoC pre-bundling (most of it the chip row UI + the author picker modal). No new dependencies (fuse.js already shipped in 3.1). Expected `main.js` delta: +3 to +4 KB.

**Architectural decision to add.** Likely `D31` — "Sidebar filter state is a per-project preference, persisted in `Project.sidebarFilter`; the chip row is a derived view of that state plus the live EventBus. The free-text search and the chip filters are AND-composed at search time; chip categories OR within themselves." Will be locked at the start of 2.9.A.

**Verification gates.** `npm run build` / `lint` / `tsc --noEmit` all `exit 0`. Manual smoke (2.9.smoke): pick three status chips, confirm the list filters to those three groups; pick an author from the typeahead, confirm the chip appears with the right name; close + reopen Obsidian, confirm the chip row reconstructs; reset to default, confirm the chip row empties. Vitest fixtures for `applyFilters` (in particular: OR-within-category, AND-across-categories, year range edge cases including missing-year papers) land with 5.x.

**Files touched (planned).** Added: [`src/ui/views/sidebar-filters.ts`](../../src/ui/views/sidebar-filters.ts), [`src/ui/modals/author-picker-modal.ts`](../../src/ui/modals/author-picker-modal.ts). Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`src/services/vault-indexer.ts`](../../src/services/vault-indexer.ts), [`src/types/project.ts`](../../src/types/project.ts), [`src/settings.ts`](../../src/settings.ts), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts), [`src/core/events.ts`](../../src/core/events.ts), [`plans/plan.md`](../../plans/plan.md).

### 2.manual-smoke — Phase G  `~~[ ]~~ [x]` **(passed 2026-07-21 against the 2.8 + 2.8.1 combined 7-step checklist; see the §13 2.manual-smoke row note for the per-step scorecard)**
- **Goal.** A single end-to-end check in this sprint, against a fresh test vault.
- **Status.** First-pass deploy (2026-07-12) installed the pdfjs-dist build; Phase G scorecard revealed the four bugs that drove `D27`. Re-deploy (2026-07-13) shipped the link-only build, and a Phase G re-run on the same build surfaced a sharper bug that drove `D28` — the third deploy on 2026-07-13 ships the priority fix. Click-through for steps 4 and 6 of the new scorecard is still pending human sign-off; until then, this row stays `[ ]`.
- **Checklist (results recorded in §13):**
  1. Drop `main.js` / `manifest.json` / `styles.css` into a fresh vault's `.obsidian/plugins/researchvault/` directory (no `pdf.worker.min.mjs` any more).
  2. Settings tab opens; create + rename + delete round-trip.
  3. `add-paper` command creates a paper file with correct frontmatter + body. Open it; template rendered correctly.
  4. **Manual + PDF attach (D28 bug-fix case).** Open the modal, fill in `title` / `primary author` / `year`, then pick a PDF (browse vault or drag-drop). Submit. Verify: (a) the created note's frontmatter has the typed title/author/year, (b) the citekey is derived from the typed values (e.g. `vaswani2023attention`), **not** `anon_<basename>_<uuid>`, (c) the note's `## Attached PDF` section points at `<project>/pdfs/<citekey>.pdf` and the file exists there, (d) the success Notice reads `with attached PDF`.
  5. Sidebar shows the new paper; status flip edits the file's frontmatter.
  6. Select text inside the paper note; `capture-quote` lands under `## Quotes` in the chosen paper.
  7. **PDF import (link-only).** Open the modal, pick a PDF, submit (manual fields blank is allowed only to verify the disabled-submit path). Confirm: PDF lands under `<project>/pdfs/`, modal info line reads `Linked PDF: <path>`, paper note has a `## Attached PDF` wikilink, no console error. (This is the `D27` regression check; steps 4 and 7 together cover both halves of the new D28 contract.)
  8. Audit: count of console warnings during the entire flow; log of network calls (`expected: none` outside an AI session).
- **Output.** PR with screenshots and a copy of the checklist scored; closes both the §12 box and this row.

### 4.1 `CitationService` + `D29` DOI lookup MVP  `[ ]` (sub-passes 4.1.A ship 2026-07-22 (+4,157 B); 4.1.B ship 2026-07-22 (+13,493 B); 4.1.C+D ship 2026-07-25 (+715 B) - drift audit caught 3 spec drifts and shipped corrections; 4.1.F gate passed (2.9x budget, trimmed -493 B) + 4.1.G README disclosure shipped 2026-09-27; 4.1.E manual smoke + 4.1.1 CSL-JSON paste still pending)
- **Goal.** Turn the import modal into a "paste a DOI, the form fills itself" experience. Pure read; no auth; no Zotero; works on every platform. This is the highest-value follow-up to 2.7.1 per the user's bug-report follow-up message ("the most helpful if we can…" → DOI-driven metadata).
- **Architecture (per `D29`).** A new pure service in [`src/services/citation/`](../../src/services/citation/) — `CitationService` with two providers (CrossRef primary, OpenAlex fallback for free-text) — behind a single `lookupByDoi(doi)` / `searchByTitle(query)` API. Lookup is a *modal affordance* that fills form fields; submit still goes through `PaperService.createManual` so `D28`'s "manual always wins" contract holds.
- **Settings (opt-in, off by default).** New `citation: { enableCitationLookup, preferredProvider, politeContact? }` block on [`ResearchVaultSettings`](../../src/settings.ts); follows the `D12`/`D13` opt-in + disclosure pattern. New "Citations" section in [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) with toggle, provider dropdown, polite-pool `mailto:` field, and a disclosure paragraph that names the third-party endpoints and the payload.
- **Modal wiring (the visible feature).** A new `🔍 Lookup` button next to the existing `doi` field in [`PaperImportModal`](../../src/ui/modals/paper-import-modal.ts) and a `🔍 Search by title…` affordance near the `title` field that opens a small `CitationSearchModal`. Pre-fill preserves user edits via an `autofilledFields: Set<keyof PaperImportForm>` set (the "fix the year but keep my title" case). The citekey preview re-runs after every successful fill via `refreshPreview()`.
- **Cache + rate limit.** 30-day in-memory LRU cache keyed by DOI (or normalised query string for search), bounded to 500 entries. Token-bucket rate limiter at 5 req/s, capacity 10. Cache hits are silent; misses surface a small "Filled from CrossRef" / "Filled from OpenAlex" line inside the modal so the user knows where the data came from.
- **Two new optional `Paper` fields.** `Paper.oaUrl?: string` and `Paper.url?: string` — one line each in [`src/types/literature.ts`](../../src/types/literature.ts) — so we can persist the OA URL (for "attach this OA PDF" affordance) and the publisher landing page URL (for the future in-text citation UX). **(2026-07-21 correction per 4.1.A kickoff §7.2 L1: `Paper.url?: string` already exists at [`src/types/literature.ts:21`](../../src/types/literature.ts). Only `Paper.oaUrl?: string` is new. `PaperSource` already includes `'doi'` at [`src/types/literature.ts:129`](../../src/types/literature.ts) — no new union member.)**
- **Settings migration.** (2026-07-21 correction per 4.1.A kickoff §7.2 L3: the current `migrateSettings` at [`src/settings.ts:95`](../../src/settings.ts) is a spread-merge, not a `switch`. Adding the `citation` block is a default-fill, not a `0.2.0 → 0.3.0` step. The row above is left as-is for traceability; the **real implementation pattern is `citation: { ...DEFAULT_SETTINGS.citation, ...(candidate.citation ?? {}) }` inside the existing `migrateSettings` return**, with `CURRENT_SETTINGS_VERSION` staying at `'1'`.)**
- **Privacy posture.** This is the *first* network feature outside `AIClient`. Defaults are off; the modal affordance is hidden when off; no vault content is ever sent (only the DOI or the search string the user typed); no analytics; responses cached locally for 30 days; `mailto:` is opt-in and only sent to providers' polite pools. All of this is disclosed in the settings tab and the README.
- **Surface (new files).** [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts), [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts), [`src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts), [`src/services/citation/csl-to-paper.ts`](../../src/services/citation/csl-to-paper.ts), [`src/services/citation/types.ts`](../../src/services/citation/types.ts), [`src/ui/modals/citation-search-modal.ts`](../../src/ui/modals/citation-search-modal.ts).
- **Surface (modified files).** [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (none — `createManual` stays the single import path), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) (Lookup + Search buttons + autofill tracking), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) (Citations section), [`src/settings.ts`](../../src/settings.ts) (`citation` block + `migrateSettings` 0.2.0 → 0.3.0 step), [`src/types/literature.ts`](../../src/types/literature.ts) (`oaUrl?`, `url?`), [`src/types/index.ts`](../../src/types/index.ts) (re-export), [`src/core/plugin.ts`](../../src/core/plugin.ts) (instantiate `CitationService` post-`PaperService`), [`plans/plan.md`](../../plans/plan.md) (this entry), [`README.md`](../../README.md) (Privacy + What works today disclosures).
- **Bundle cost.** Roughly 270 LoC pre-bundling, no new dependencies (`fetch` and `URL` are built into Electron). Expected main.js delta is plus 1.5 to 2 KB. `pdfjs-dist` stays out.
- **Verification gates.** `npm run build` / `lint` / `tsc --noEmit` all `exit 0`. Manual smoke (4.1.smoke): paste `10.1109/CVPR.2016.90` → confirm `title` / `author[]` / `year` / `venue` fill; edit `year` then re-click Lookup → confirm `title` re-fills but `year` is preserved; toggle `enableCitationLookup` off → confirm the Lookup button hides; free-text search → pick a candidate → confirm full form fills. Vitest fixtures for `csl-to-paper.ts` land with 5.x.
- **Deferred.** CSL-JSON import (paste or drag a `csljson` file) is a tiny follow-on (around one day) and is a natural 4.1.1 sub-pass. Zotero web API read-in lives in 5.1 and depends on a stable `CitationService` for the CSL→Paper conversion. Zotero local API push-back lives in 5.2 (desktop only). Bidirectional Zotero sync is deferred to a later sub-pass.
- **Design doc.** Full research + provider survey + phasing rationale + open questions in [`plans/citation-lookup-research.md`](./citation-lookup-research.md).

### 4.1.B `CitationService` — wire the real `fetch` calls (LRU cache + token-bucket + OpenAlex→CSL mapper)  `[x]` (shipped 2026-07-22; architect kickoff logged 2026-07-22; full dated entry in §13; main.js +13,493 B)
- **Goal.** Replace the 4 provider stubs that 4.1.A left behind (`lookupByDoi` × 2, `searchByTitle` × 2, `searchByQuery` × 0 — note `searchByQuery` is only on CrossRef) with real `fetch` calls against the CrossRef and OpenAlex public APIs, behind the same single public API the modal will call in 4.1.C. **No UI changes.** This is the pure-service phase; the modal still doesn't get the Lookup/Search buttons until 4.1.C.
- **Architecture (locked in 4.1.A, enforced in 4.1.B).** Three new pure modules + two provider rewrites + one orchestrator wiring inside [`src/services/citation/`](../../src/services/citation/):
  - [`lru-cache.ts`](../../src/services/citation/lru-cache.ts) (NEW, ~80 LoC) — generic `LruCache<K, V>` with `get`, `set`, evict-oldest when over `maxEntries`, and a per-entry `fetchedAt` for TTL eviction. Caches `null` results too (negative caching) so a DOI that's known-bad doesn't get re-fetched for 30 days. Constructor takes `ttlMs: number`, `maxEntries: number`, and an injectable `clock: () => number` (defaults to `Date.now`) so 5.x vitest fixtures can fast-forward time without sleeping.
  - [`token-bucket.ts`](../../src/services/citation/token-bucket.ts) (NEW, ~60 LoC) — `TokenBucket` with `take(): Promise<void>` (await-with-backoff, not busy-loop), `rps: number`, `capacity: number`, and the same injectable `clock`. **Single shared bucket across both providers** per B3 (CrossRef and OpenAlex polite pools don't talk to each other, but our budget does). `tryTake()` for non-blocking code paths (the cache-hit path skips it entirely per B2).
  - [`openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts) (NEW, ~80 LoC) — hand-rolled `openAlexWorkToCsl(work: OpenAlexWork): CslJsonRecord` mapper. Reconstructs `abstract` from `abstract_inverted_index` (position-keyed reverse-join per B5). Maps OpenAlex's `type` vocabulary to CSL's `type` vocabulary per B6. Pulls the OA PDF URL from `best_oa_location?.pdf_url` and stashes it on `Paper.oaUrl` via the `csl-to-paper.ts` bridge (B7).
  - [`providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) (REWRITE) — real `fetch` against `api.crossref.org/works/<doi>?transform=application/vnd.citationstyles.csl+json` for lookup, `?query.title=…` for `searchByTitle`, `?query.bibliographic=…` for `searchByQuery`. Polite-pool `mailto` goes into the `User-Agent` header per B8: `ResearchVault/<version> (+mailto:<politeContact>) <CROSSREF_DEFAULT_USER_AGENT>`. Throws `CitationLookupError` on non-2xx; the orchestrator maps to `reason`.
  - [`providers/openalex.ts`](../../src/services/citation/providers/openalex.ts) (REWRITE) — real `fetch` against `api.openalex.org/works/doi:<doi>` for lookup and `api.openalex.org/works?search=…` for `searchByTitle`. Polite-pool `mailto` goes into the `?mailto=…` query param per B8. Same `CitationLookupError` shape.
  - [`citation-service.ts`](../../src/services/citation/citation-service.ts) (WIRE) — the 3 public methods become `cache.get` → `bucket.take()` → `provider.X(...)` → `cache.put` → `eventBus.emit(...)` per B2. **Cache hits don't spend tokens** (B2 second half). Emits `citationLookupSucceeded` on success and `citationLookupFailed` with one of the 5 reasons on failure per B9. `searchByQuery` falls back from CrossRef to OpenAlex when 0 hits per B11; `searchByTitle` stays on the user's preferred provider per Q1.
- **No new dependencies.** Built-in `fetch`, `URL`, `URLSearchParams`, `Map`, `Date.now`. `pdfjs-dist` stays out. No `axios`, no `node-fetch`, no `p-queue` — the token-bucket is ~60 LoC and is exactly the API surface we need.
- **No UI changes.** The modal doesn't get new buttons in 4.1.B. The `lookupByDoi` / `searchByTitle` / `searchByQuery` methods are still publicly callable on `plugin.citationService` (4.1.A exposed them); 4.1.C wires the buttons to them.
- **No settings changes.** All 4.1.A settings (`enableCitationLookup`, `preferredProvider`, `politeContact`) are still off-by-default. 4.1.B doesn't touch the settings tab.
- **Error mapping (locked B9).** 200 → success; 401/403 → `network`; 404 → `not-found` for `lookupByDoi` / success-with-empty for `searchByTitle` and `searchByQuery`; 429 → one retry with backoff (250 ms ± jitter) → `rate-limited` if still 429; other 4xx → `invalid-doi` for `lookupByDoi` / success-with-empty for search; 5xx + fetch throws → `network`. Negative results (`null` for lookup, `[]` for search) are cached per B10.
- **Cache key shape (locked B1).** `lookupByDoi` keys are `doi:<lowercased-doi>` (CrossRef DOIs are case-insensitive but it's polite to normalise). `searchByTitle` and `searchByQuery` keys are `q:<provider>:<lowercased-trimmed-query>:<limit>`. `null` and `[]` are cached with a `null` sentinel — same TTL, same cap.
- **Cache TTL + cap (locked B4, moved from declared-but-unused to enforced).** `CACHE_TTL_DAYS = 30`, `CACHE_MAX_ENTRIES = 500`. Re-verification deferred to 4.1.E manual smoke (env has no web access — see design doc §8.3). If 4.1.E shows 30 d is too short, only one constant moves.
- **Rate-limit numbers (locked B4, same re-verification caveat).** `RATE_LIMIT_RPS = 5`, `RATE_LIMIT_BURST = 10`. Single bucket, shared across both providers. If a real load test shows 5 req/s is too tight, only one constant moves.
- **Test seam (locked B12).** `LruCache` and `TokenBucket` both take a `clock: () => number` for time-travel. `FetchImpl` was already injected in 4.1.A as `deps.fetch` on `CitationServiceDeps`; the two providers read `deps.fetch` from the orchestrator, not from a global, so vitest fixtures can pass a mock that records calls and returns canned responses. The two providers are pure-function-shaped: `(args) => Promise<{ status, body }>` — no class state, no I/O outside the injected `fetch`.
- **Surface (new files).** [`src/services/citation/lru-cache.ts`](../../src/services/citation/lru-cache.ts), [`src/services/citation/token-bucket.ts`](../../src/services/citation/token-bucket.ts), [`src/services/citation/openalex-to-csl.ts`](../../src/services/citation/openalex-to-csl.ts).
- **Surface (modified files).** [`src/services/citation/providers/crossref.ts`](../../src/services/citation/providers/crossref.ts) (rewrite stubs → real fetch), [`src/services/citation/providers/openalex.ts`](../../src/services/citation/providers/openalex.ts) (rewrite stubs → real fetch), [`src/services/citation/citation-service.ts`](../../src/services/citation/citation-service.ts) (wire cache + limiter + reason mapping + event emit), [`plans/plan.md`](../../plans/plan.md) (this entry + dated entry in §13 when shipped).
- **Surface (NOT modified).** [`src/settings.ts`](../../src/settings.ts), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts), [`src/ui/modals/citation-search-modal.ts`](../../src/ui/modals/citation-search-modal.ts) (doesn't exist yet — that's 4.1.C), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts), [`src/services/paper-service.ts`](../../src/services/paper-service.ts), [`src/types/literature.ts`](../../src/types/literature.ts), [`src/types/index.ts`](../../src/types/index.ts), [`src/core/plugin.ts`](../../src/core/plugin.ts), `manifest.json`, `package.json`, `esbuild.config.mjs`, `eslint.config.mts`.
- **Bundle cost.** Pre-bundle: ~270 LoC of new code (3 modules + 2 rewrites) + ~50 LoC of orchestrator wiring ≈ 320 LoC. With esbuild's minification and the size of similar plumbing code in the repo, expected main.js delta is **+2.5 to 4.0 KB**. **Honest caveat (per the 4.1.A overshoot):** 4.1.A's design doc estimated +1.0–1.4 KB and shipped +4,157 B (4.1.A came in at 3x the estimate). The +2.5–4.0 KB range here is intentionally generous; the real number comes from 4.1.F's measurement. 4.1.B does not block on the estimate; 4.1.F's 7 KB total-budget gate does.
- **Verification gates.** `npx tsc --noEmit` exit 0; `npm run lint` exit 0 with 0 errors and 0 warnings (the `obsidianmd/no-global-this` rule means we use `window.fetch?.bind(window)` in the default `FetchImpl`, not `globalThis.fetch`); `npm run build` exit 0 with `main.js` delta captured. **No live network calls during automated verification** — the env has no web access. The two providers are exercised via injected `fetch` mocks in the (deferred) vitest fixtures; the live CrossRef/OpenAlex round-trip is part of 4.1.E's manual smoke.
- **Hand-off contract for 4.1.C (the modal wiring phase).** After 4.1.B lands, 4.1.C can assume: (a) `plugin.citationService.lookupByDoi(doi)` returns `CitationLookupSucceeded | null` and never throws for known-mapped errors; (b) `plugin.citationService.searchByTitle(query, limit)` returns `CslJsonRecord[]` and never throws for known-mapped errors; (c) `plugin.citationService.searchByQuery(query, limit)` returns `CslJsonRecord[]` with CrossRef-primary / OpenAlex-fallback per B11; (d) every public call emits exactly one `citationLookupSucceeded` or `citationLookupFailed` event with the right reason; (e) the `cslToManualInput` bridge in 4.1.A still converts records to form fields correctly for both CrossRef-native CSL and OpenAlex-via-mapper CSL. 4.1.C is the **only** sub-pass that touches [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts) and creates [`src/ui/modals/citation-search-modal.ts`](../../src/ui/modals/citation-search-modal.ts).
- **What 4.1.B does NOT do.** Doesn't add the modal Lookup/Search buttons (4.1.C). Doesn't add the settings tab Citations section (4.1.D — already mostly done in 4.1.A, just needs the disclosure paragraph). Doesn't add CSL-JSON import UI (4.1.1). Doesn't add Zotero (5.1+). Doesn't run a live network test (4.1.E). Doesn't measure final bundle cost (4.1.F). Doesn't add a privacy disclosure to the README (4.1.G). Doesn't add vitest fixtures (5.x).
- **Design doc.** Full kickoff, locked decisions B1–B12, rate-limit re-verification, and hand-off contract in [`plans/citation-lookup-research.md` §8](./citation-lookup-research.md#8-41b-kickoff--wire-the-real-fetch-calls-logged-2026-07-22).

### 4.1.C `PaperImportModal` — wire `Lookup DOI` + `Search by title` buttons (autofill preserves manual edits; inline modal status; preferred-provider provenance)  `[x]` (shipped 2026-07-22; drift audit repainted on 2026-07-25 — `setStatus` + `autofilledFields` + `preferredProvider()`; full dated entry in section 13; main.js +715 B incremental over 4.1.B)
- **Goal.** Make `PaperImportModal` the visible surface of 4.1: a `Lookup` button beside the `doi` field hits the active provider’s DOI endpoint; a `Search by title...` button beside the `title` field opens `CitationSearchModal` (lists candidates via `searchByTitle` with fallback to `searchByQuery`). Citekey preview re-renders via `refreshPreview()` after every successful fill.
- **Track-on-edit (`autofilledFields: Set<keyof PaperImportForm>`).** On every `onChange`, the field is removed from the set (user edit wins). `applyAutofill` checks membership before overwriting. The “fix the year but keep my title” case lands cleanly.
- **Inline modal status (`statusEl` + `setStatus`).** Replaces the global `new Notice()` that the 4.1.A scaffold left in `performDoiLookup`. Status element lives on `contentEl` with class `researchvault-import-status`; `setStatus(message, kind)` toggles a `.is-error` class. `onClose` resets `statusEl = null`.
- **Files modified.** `src/ui/modals/paper-import-modal.ts`, `src/ui/modals/citation-search-modal.ts` (hardcoded `‘crossref’` → `this.citationService.preferredProvider()`), `src/services/citation/citation-service.ts` (single additive edit: `preferredProvider(): string` getter immediately after `clearCaches()`).
- **Files NOT touched.** Providers/*, src/settings.ts, src/types/*, src/services/paper-service.ts, manifest.json, package.json, esbuild.config.mjs.
- **Verification gates.** tsc / lint / build all 0 (verified 2026-07-22 first ship, 2026-07-25 drift-audit repaint).

### 4.1.D Settings tab — Citations section (between Projects and AI; privacy-disclosure paragraph sourced from design-doc section 1.3 verbatim)  `[x]` (shipped 2026-07-22; drift-audit repainted the privacy disclosure paragraph on 2026-07-25 to match design-doc §1.3 wording exactly; full dated entry in section 13)
- **Goal.** `renderCitations(root)` private method between `renderProjects` and `renderAI` in `src/ui/settings/settings-tab.ts`. Each row corresponds to a `citation.*` field on `ResearchVaultSettings`: toggle (`enableCitationLookup`, opt-in, off by default per `D14`), dropdown (`preferredProvider`, defaults to `crossref`), text (`politeContact`, empty by default). 4.1.A rate-limit + cache preferences are read-only labels (they are code constants locked in design-doc §8 B4).
- **Privacy disclosure paragraph (drift-audit repaint, 2026-07-25).** First `<p>` under the Citations heading reads (verbatim): *“Lookups send only the doi or search string you typed. No vault content is sent. Responses are cached locally for 30 days. The `mailto:` field is opt-in and only sent to your chosen provider’s polite pool. No analytics.”* This paragraph is the source for the future 4.1.G README *Privacy* block.
- **Sentence-case lint.** `obsidianmd/ui/sentence-case` flagged original `Api` → corrected to `API`. No other lint surface changes.
- **Files modified.** `src/ui/settings/settings-tab.ts` only.
- **Files NOT touched.** Providers/*, paper-import-modal.ts (4.1.C), citation-service.ts (4.1.C `preferredProvider()` is the only edit), src/settings.ts, src/types/*, manifest.json, package.json, esbuild.config.mjs.
- **Verification gates.** tsc / lint / build all 0.

### 4.1.E Manual smoke — verify Lookup + Search buttons in a real Obsidian test vault  `[x]` (**PASSED 2026-09-27**; 4 findings fixed — CrossRef transform-param removal, CSL `string | string[]` fields, autofill DOM sync, README disclosure (→ 4.1.G) — plus 2 UX polishes: Title | Authors | Year column grid and auto-run of the pre-filled search query; main.js +961 B to 115,153 B; full dated entry in §13)
- **Goal.** End-to-end click-through against a fresh test vault. Paste DOI `10.1109/CVPR.2016.90` → confirm `title` / `author[]` / `year` / `venue` fill. Edit `year` → re-click Lookup → `year` stays, `title` re-fills. Toggle `enableCitationLookup` off → Lookup button hides. Free-text *“attention is all you need”* → pick candidate → form fills. Submit → `Notice: Imported [citekey]` and note file lands with correct frontmatter.
- **Why deferred from 4.1.C.** Modal code compiles + types pass + lint clean, but a click-through needs a real Obsidian instance wired to the plugin’s test-vault path. Best done once the next round of bundle-cost gates + settings-tab polish is quiet enough that the 7-step scorecard won’t be drowned out.

### 4.1.F Bundle-cost gate — final `npx esbuild ... --metafile` measurement  `[x]` (measured 2026-09-27: citation feature 20,893 B minified incl. search modal ≈ 2.9× the 7 KB budget; user chose trim → 4.1.F.1 shipped same day: folded `openalex-to-csl.ts` into `providers/openalex.ts`, deleted dead `clearCaches()`, kept `importCslJson` for 4.1.1/5.1; net **−493 B**, main.js 114,685 → 114,192 B; full dated entry in §13)
- **Goal.** Produce the final 4.1 A+B+C+D byte delta. Honest-caveat reminder per design-doc §8.3: 4.1.A came in **3x** the design-doc estimate; 4.1.B likewise. Cumulative budget for §14 row 4.1 is 7 KB total; current measurement is **~+14,200 B which means the row overshoots**. Decision at 4.1.F time: (a) accept the overshoot and document it, (b) trim code (likely candidates: absorb `openalex-to-csl` mapper into a single helper file; drop `clearCaches()` from public API until 4.1.D wires the settings-tab *Clear cache* button), or (c) defer 4.1.G README prose until 5.x.
- **No new code in 4.1.F.** Just measurement + a sub-pass row entry recording the actual main.js delta + a decision (a/b/c).

### 4.1.G README privacy disclosure for `D29` (the first network feature outside `AIClient`)  `[x]` (shipped 2026-09-27: endpoint-level disclosure added to both `README.md` "Privacy & external services" and the §15 canonical draft — CrossRef/OpenAlex endpoints named, what's sent (DOI/search string only), 30-day local cache, opt-in `mailto:`; full dated entry in §13)
- **Goal.** Lift the privacy-disclosure paragraph from `renderCitations` (4.1.D) verbatim into the `## 15. README Source → ## Privacy` block, and write it to `README.md` after the prose draft is signed off.
- **Why deferred from 4.1.D.** The disclosure text exists; the README section does not yet. Splitting the two means 4.1.G is a 1-hour pass once the user signs off on the prose.

### 5.1 Zotero web API read-in (`D30` layer a)  `[ ]` (planned, not started)
- **Goal.** "Sync from Zotero" affordance in the sidebar — pull items from a Zotero library using the Zotero Web API v3, convert them to `Paper` records, and import them via the same `PaperService.createManual` path.
- **Settings (opt-in, off by default).** New `zotero: { userID, apiKey, defaultCollectionKey? }` block on [`ResearchVaultSettings`](../../src/settings.ts). Disclosure paragraph in the settings tab names the third-party endpoint and the payload (just the API key + collection filter; no vault content).
- **Service.** New `ZoteroClient` in [`src/services/integrations/zotero/`](../../src/services/integrations/zotero/) — a thin wrapper over the Zotero Web API v3 (`/users/{userID}/items?format=csljson`). Reuses `CitationService.importCslJson` (4.1 follow-on) for the CSL→Paper conversion, so no second parser lives in the codebase.
- **Surface.** A "Sync from Zotero" button in the sidebar header (when configured) that opens a small `ZoteroImportModal` (collection picker, limit field, optional tag filter) and calls `zoteroClient.listItems(...)` → `paperService.createManual` per item. PDFs: when a CSL-JSON item has a `link[].url` with `attachment-type=application/pdf`, download to `<project>/pdfs/<citekey>.pdf` via the same `copyPdfIntoProject` path used by `D28`.
- **Files (new).** [`src/services/integrations/zotero/zotero-client.ts`](../../src/services/integrations/zotero/zotero-client.ts), [`src/ui/modals/zotero-import-modal.ts`](../../src/ui/modals/zotero-import-modal.ts).
- **Files (modified).** [`src/services/paper-service.ts`](../../src/services/paper-service.ts) (none — `createManual` is the import path), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (Sync button), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) (Zotero section), [`src/settings.ts`](../../src/settings.ts) (`zotero` block + `migrateSettings` step), [`src/core/plugin.ts`](../../src/core/plugin.ts) (instantiate `ZoteroClient`), [`plans/plan.md`](../../plans/plan.md) (this entry + dated entry in §13 when shipped), [`README.md`](../../README.md) (Privacy + What works today disclosures).
- **Verification gates.** `npm run build` / `lint` / `tsc --noEmit` clean. Manual smoke: configure a Zotero API key, click Sync, pick a collection, confirm papers land in the active project with correct frontmatter + citekeys. Vitest fixtures for `ZoteroClient` land with 5.x.
- **Deferred.** Bidirectional sync (5.3) — incremental webhooks, collection mappings, tag sync — is a lot of surface; defer until we have real usage data.

### 5.2 Zotero local API push-back (`D30` layer b, desktop only)  `[ ]` (planned, not started)
- **Goal.** "Push to Zotero" affordance on each sidebar row — send a paper back to a Zotero collection via the Zotero local HTTP API on `127.0.0.1:23119`.
- **Surface.** `ZoteroLocalClient` probes `127.0.0.1:23119` at sidebar-open time, stores the dynamic per-session key, and surfaces a "Push to Zotero" action on each row (hidden when the probe fails; the row shows a "Zotero is offline" tooltip instead). The push converts `Paper` → CSL-JSON → Zotero create-item request.
- **Mobile / desktop carve-out.** This sub-pass is desktop-only by definition. `manifest.json` stays `isDesktopOnly: false`; the local-API push-back affordance is simply hidden on mobile. Web-API read-in (5.1) and DOI lookup (4.1) remain available everywhere.
- **Files (new).** [`src/services/integrations/zotero/zotero-local-client.ts`](../../src/services/integrations/zotero/zotero-local-client.ts).
- **Files (modified).** [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (Push button), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) ("Connect to Zotero desktop" toggle), [`src/core/plugin.ts`](../../src/core/plugin.ts) (instantiate `ZoteroLocalClient`).
- **Verification gates.** `npm run build` / `lint` / `tsc --noEmit` clean. Manual smoke on desktop with Zotero running; manual smoke on desktop with Zotero closed (confirm the affordance is hidden and the "Zotero is offline" message renders).

### 5.3 Zotero + official-plugins coexistence (`D30` layer c)  `[ ]` (planned, not started)
- **Goal.** A "Citations" section in the settings tab that links to the two well-known Obsidian community plugins that already bridge Zotero: `Zotero Integration` (the original, by mgmeyers) and `obsidian-zotero-desktop-connector`. Zero new code, ships with the Zotero work in 5.1 to land all three layers in the same release.
- **Copy (draft).** "ResearchVault complements, rather than replaces, the official Zotero Obsidian plugins. *Zotero Integration* and *obsidian-zotero-desktop-connector* handle insert-citation in the editor; we handle sidebar browse, PDF management, and status tracking. Install either of those if you want the insert-citation UX inside notes."
- **Files (modified).** [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) (Zotero section gets the "works alongside" paragraph + two `Setting` link rows), [`README.md`](../../README.md) (Privacy + What works today disclosures), [`plans/plan.md`](../../plans/plan.md) (this entry + dated entry in §13 when shipped).

### 3.x Tier 2 remainder  `[ ]`
- **`CitationManager`** — in-text citation insertion via editor callback; `exportBibtex(projectId)` writes a `.bib` per project from the inverse `citekey → file` index.
- **`VaultIndexer`** — `fuse.js` over note titles + frontmatter; backs the sidebar filter (2.3 follow-up) and Tier 3 search.
- **Literature-graph edges** — paper ↔ paper (`cites`, `extends`, `contradicts`). Storage decision: per-project JSON file in `<project>/literature/` once `saveData` (per `D5`) is too small.
- **`citeproc-js`** — explicitly deferred to a Sprint 3 follow-up per the `D11` rationale.

### ~~3.1a~~ Sidebar polish (search reorder + color hierarchy + Needs-action group)  `~~[ ]~~` → **Shipped 2026-07-11 in sub-pass 3.1b.** Absorbed into the 3.1b dated entry below; see §13 for full details.
- **Goal.** Make the existing sidebar scannable at a glance: search input at the top, status groups with real visual hierarchy, a red "Needs action" group at the top of the list.
- **Surface.** Only `projects-sidebar-view.ts` + `styles.css`. No new types, no new services, no new settings.
- **'Needs action' definition.** `priority === 'critical'`, OR `status in {reading, skimming, annotating}`, OR (`status in {skimming, annotating}` AND staleness > 14 days). Derived in the view; not a stored field (see `D20`).
- **Deferred to follow-ups.** Per-row action buttons (3.1b), research stages (3.1c), project homepage note (4.x or 5.x).
- **Verification gates.** `npm run build` / `lint` / `tsc --noEmit` clean; manual smoke in the test vault confirms reorder, color hierarchy, and red "Needs action" group behaviour.
- **Files.** Modified: [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`styles.css`](../../styles.css), [`plans/plan.md`](../../plans/plan.md).

### 3.1b Sidebar row polish + live sync + data formats  `[x]` (shipped 2026-07-11)
- **Goal.** Upgrade every sidebar row to a workflow row (title + edit pencil; citekey/year; status + priority + quote glyph; date line), live-sync edits from anywhere in the vault, and pin down the on-disk data formats (citekey separator, date format).
- **Locked decisions:** D22–D25 (see `Sprint 3 — Sub-pass 3.1b` above).
- **Files touched:** new [`src/utils/format-date.ts`](../../src/utils/format-date.ts); modified [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts), [`src/ui/modals/paper-import-modal.ts`](../../src/ui/modals/paper-import-modal.ts), [`src/services/paper-service.ts`](../../src/services/paper-service.ts), [`src/core/plugin.ts`](../../src/core/plugin.ts), [`src/core/events.ts`](../../src/core/events.ts), [`styles.css`](../../styles.css), [`plans/plan.md`](../../plans/plan.md).
- **Deferred (rolls into a future 3.x pass).** Quick-action "→ next" / "skip" buttons per row and the "was this relevant?" post-read prompt. Inline status + priority dropdowns give us enough signal to judge whether those are worth adding before any new UI surface lands.
- **Verification gates.** `npx tsc --noEmit` / `npm run lint` / `npm run build` / `npm run deploy:build` all clean; manual smoke in the test vault covers the four behaviours (live sync from a markdown edit, edit-modal opens with citekey disabled, date line renders ISO frontmatter, button positions don't reflow when switching groups).

### 3.1c Research stages (intake / synthesis)  `[ ]` (planned; not yet started)
- **Goal.** A derived "project stage" (intake vs synthesis) plus an optional `Project.stage` override; stage-aware default sort in the sidebar.
- **Files (proposed).** [`src/types/project.ts`](../../src/types/project.ts) (optional `stage` field + `migrateSettings` bump), [`src/services/project-manager.ts`](../../src/services/project-manager.ts) (derivation helper), [`src/ui/views/projects-sidebar-view.ts`](../../src/ui/views/projects-sidebar-view.ts) (stage-aware sort), [`src/ui/settings/settings-tab.ts`](../../src/ui/settings/settings-tab.ts) (stage override dropdown), `plans/plan.md`.
- **Verification gates.** Same as 3.1a, plus smoke: switching project stage changes the group ordering.
- **Architectural decision.** Default to *derived* stage; explicit override is opt-in.


### 4.x Tier 3  `[ ]`
- **Real `AIClient`** — OpenAI-compatible HTTP client covering OpenAI / Anthropic / OpenRouter / Ollama. Streaming via `fetch` + `ReadableStream`. Provider config lives in **Settings → AI**.
- **`AIChatView`** — new `ItemView` with a message thread; uses `AIClient.stream`.
- **Budget enforcement** — daily token cap recorded against `AIConfig`. Over-cap = `Notice`, no call.
- **Privacy posture.** Per `D15` — every AI call gated behind a settings toggle; vault contents never leave unless that toggle is on.

### 5.x Polish + release  `[ ]`
- **`Vitest`** for `composeCitekey`, `renderTemplate`, `splitFrontmatter`, `ProjectManager.ensureProjectFolders` (mocked vault).
- **GitHub Actions** — lint then build on PR.
- **BRAT** — manifest fields for tagged pre-release tests.
- **Gallery submission** — `obsidianmd/obsidian-releases` PR with §15 lifted into `README.md` and the compliance checklist run.

---

## 15. README Source — GitHub README Prose Draft

> **Lift-and-paste.** This is the canonical prose for `README.md`. Anything we say to a user originates here. Until v1.0.0 ships, edit *this* section first; lift into `README.md` at release boundaries. After 1.0.0, `README.md` becomes the user-facing source and §15 becomes its mirror.

### Current draft

````md
# ResearchVault

> Turn Obsidian into the research operating system you actually use.

ResearchVault gives you **projects**, **manual paper import with citekeys**, **status tracking**, and a **sidebar that shows you where everything lives** — without locking your work inside a separate app.

Your papers are plain markdown files. Your notes are plain markdown files. The metadata lives next to the content, transparently — you can grep your vault.

## Three layers, each independently useful

- **Manage** — projects, paper import, citekeys, BibTeX export, citation lookup (DOI + free-text). *(Today's release ships this; citation lookup is opt-in per `D29`.)*
- **Workflow** — quotes from PDFs and editor, literature links (cites / extends / contradicts), reading queue, Zotero sync. *(In development.)*
- **Intelligence** — vault-grounded AI chat, summarization, claim extraction, cross-paper synthesis. *(Planned.)*

## What works today

- Create / rename / archive research projects in **Settings → Projects**.
- Add papers by hand; citekey is auto-derived (`smith2024transformer`) and collision-safe (`smith2024transformer-2`).
- Every paper lives at `<Project>/papers/<citekey>.md` — your file, your folder, no lock-in.
- Drop or browse for a PDF alongside a paper; the file lands in `<Project>/pdfs/<citekey>.pdf` and the paper note gets a `## Attached PDF` wikilink. *(Link-only per `D27` — see "What's coming" for the deferred text extraction.)*
- Status dropdown on the sidebar flips between Reading / Backlog / Read / Archived.
- Sidebar view lists papers grouped by status; click to open a paper note directly.
- Mobile-ready (Obsidian Mobile parity).

## What's coming

- Quote capture from editor selections — pick a paper, drop the quote, done.
- Literature graph (cites / extends / contradicts edges).
- **Citation lookup** (per `D29`). Paste a DOI in the import modal and the form fills itself with metadata from CrossRef (with OpenAlex as a free-text fallback). *Opt-in* under **Settings → Citations**; default off. No vault content leaves the device. Detailed plan in [`plans/citation-lookup-research.md`](./citation-lookup-research.md).
- **Zotero integration** (per `D30`). Three independent layers — read from the Zotero web API (5.1), push back via the local API on desktop (5.2), and coexist with the official `Zotero Integration` / `obsidian-zotero-desktop-connector` plugins (5.3). All opt-in.
- PDF **text** extraction. Link-only PDF attachment already works (see *What works today* above, per `D27` and `D28`); parsing the PDF (auto-quotes, citation detection) stays deferred until a sandbox-safe worker is available. Quote capture still happens in the editor today.

## Privacy

- **Default-off network.** ResearchVault does not send your vault anywhere unless the AI features are explicitly on. Citation lookup (`D29`) and Zotero sync (`D30`) follow the same opt-in pattern: off by default, no vault content ever sent, every external endpoint disclosed in the settings tab and above.
- **No telemetry.** No analytics. No fingerprinting.
- **Citation lookup** (`D29`) sends only the DOI or search string you typed to `api.crossref.org` and/or `api.openalex.org`. No vault content is sent. Responses are cached locally for 30 days; the polite-pool `mailto:` contact is opt-in and sent only to your chosen provider.
- **You own the files.** Every paper is a normal markdown file in your vault folder.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. In your vault, create `.obsidian/plugins/researchvault/`.
3. Drop the three files into that folder.
4. In Obsidian, **Settings → Community plugins → enable ResearchVault**.

## For developers

See [`plans/plan.md`](./plans/plan.md) — architecture, locked decisions, the live changelog, and the upcoming passes all live there. Open it before opening a PR.
````

### Things this prose deliberately does *not* promise yet

- **AI chat promises.** Until Tier 3 lands, §15 mentions Tier 3 as "Planned" only.
- **PDF text extraction.** Link-only PDF attachment is "What works today"; parsing the PDF (auto-quotes, citation detection) is "What's coming" with an honest "until a sandbox-safe worker is available" caveat. No `pdfjs-dist` promise.
- **PDF-driven metadata import.** Per `D28`, an attached PDF is an attachment only — it does not auto-fill `title` / `authors` / `year`. The user always supplies the metadata by hand. README wording is silent on this so we don't accidentally promise a "drag in a PDF and we'll figure it out" experience.
- **BibTeX export.** Mentioned in 3.x as planned work; do not promise shipped export until 3.x lands.
- **Citation lookup (no live lookups yet).** The "Citation lookup" bullet in *What's coming* is a roadmap commitment under `D29`; do not promise shipped lookup behaviour until sub-pass 4.1 lands.
- **Zotero integration (no live sync yet).** The "Zotero integration" bullet in *What's coming* is a roadmap commitment under `D30`; do not promise shipped sync behaviour until sub-pass 5.1 (or 5.2) lands. Until then, the settings-tab "Citations" section is at most a link-out to the official community plugins.
- **Mobile-specific PDF handling.** With `D27` the PDF behaviour is identical desktop + mobile (obsidian's built-in PDF viewer handles the wikilinked `.pdf`). No special mobile carve-out left to promise. (Former `D26` desktop-only caveat is gone.) Note: Zotero local-API push-back in 5.2 is desktop-only by design, but the rest of the citation story (4.1, 5.1, 5.3) is mobile-safe.

> **Once we start a release.** Copy the *Current draft* above into `README.md`, bump the **What works today** bullets to match the latest dated entry in §13, and leave the rest untouched.
