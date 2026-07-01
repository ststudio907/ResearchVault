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
| D11 | External dependencies | `pdfjs-dist`, `fuse.js` only at MVP; `citeproc` deferred | Bundle size matters; citeproc is heavy — defer with simple BibTeX emission first. |
| D12 | AI feature flagging | Each AI feature gated by `AIConfig.enableXxx` AND `apiKey` present | Required by Obsidian plugin guidelines: opt-in, explicit disclosure. |
| D13 | API key storage | Plaintext in settings; UI shows warning + masking | Best we can do without OAuth. Documented in README. We never send keys anywhere but the configured provider. |
| D14 | Files written outside vault | Never. Files read outside vault | Plugin guidelines + privacy. |
| D15 | Telemetry | None. Ever. | Privacy default. If added later: explicit opt-in + README disclosure. |
| D16 | Frontmatter R/W | [`parseYaml`](../src/utils/frontmatter.ts) / [`stringifyYaml`](../src/utils/frontmatter.ts) re-exports from `obsidian` | Obsidian already ships these. Use the host app's parser so a paper note opened in another editor behaves identically to its Obsidian read-back. **No** hand-rolled YAML parser. |
| D17 | Delete semantics | `fileManager.trashFile()` for paper notes (`obsidianmd/prefer-file-manager-trash-file`) | Honors the user's Settings → Files & Links → "Deleted files" preference. Only project folders and project MD are deleted via raw `vault.delete` if/when we add a destructive project-folder clear. |

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
| `PaperService` | 2 | Import PDF/DOI → metadata + citekey → create paper note file; status transitions; quote/claim CRUD. **Manual import, in-memory index, status transitions, quote append, delete via `trashFile` implemented.** DOI/PDF file write, BibTeX import/export, relationship edges (cites/extends/contradicts/related), and reading-progress remain `notImplemented` — see §13 Living Log. |
| `CitekeyGenerator` | 2 | Deterministic citekey from authors/year/title; collision suffix. |
| `CitationManager` | 3 | BibTeX export, CSL render via `citeproc` (deferred), in-text citation insertion in editor. |
| `VaultIndexer` | 3 | Background scan → in-memory index; `fuse.js` powered fuzzy search; relevance scoring for AI context. |
| `AIClient` | 3 (stub in 1) | Provider abstraction (OpenAI, Anthropic, local, custom); chat + summarize + extract endpoints; budget enforcement. |
| `PdfService` | 2 | Worker-thread PDF text extraction via `pdfjs-dist`; never block UI; returns structured pages. |
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
Goal: import papers, track status, capture quotes. Adds PaperService, PdfService (text only), CitekeyGenerator, PaperImportModal, QuoteCaptureModal, ProjectsSidebarView.

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
| 2.6 | `PdfService` + `pdfjs-dist` install + esbuild worker config (deferred to end of Sprint 2) | 2 | Blocks `createFromPdf` + PDF text extraction. Bundle costs ~+500 KB; mobile needs worker shim. |
| 2.manual-smoke | Drop plugin into a real vault, click through, document results in PR | 2 Phase G | Deferred from Sprint 1 — same checklist applies. |
| 3.x | `CitationManager` (BibTeX emit, in-text cite insertion), `VaultIndexer` + `fuse.js`, literature-graph edges | 3 | Citeproc deferred until Sprint 3 follow-up. |
| 4.x | `AIClient` real provider wiring, `AIChatView`, budget enforcement | 4 | Currently still `notImplemented`. |
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

### 2.4 `QuoteCaptureModal` — selection → quote  `[ ]`
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

### 2.6 `PdfService` + `pdfjs-dist` install  `[ ]`
- **Goal.** `PaperService.createFromPdf(file, projectId)` becomes real; `findCitationsInPdf` and `extractQuotesFromPdf` graduate from `notImplemented`.
- **Bundle cost.** `pdfjs-dist` ~+500 KB. Plan: copy the worker (`pdf.worker.min.mjs`) to a top-level asset folder and fetch at runtime so it is *not* bundled.
- **Mobile caveat.** Mobile WebView worker support is bumpy. Options: (a) ship the worker as an in-vault asset, (b) accept that PDF text capture is desktop-only initially, (c) wait upstream. Open question tracked in §9.
- **Files (new).** `src/services/pdf-service.ts`, `src/services/pdf/loader.ts`.
- **Files (modified).** `package.json` (`pdfjs-dist` dep), [`esbuild.config.mjs`](../../esbuild.config.mjs) (asset copy step), `manifest.json` *(only if a new permission scope is needed)*.
- **Verification gates.** Bundle size budget tracked in §9; CI green.

### 2.manual-smoke — Phase G  `[ ]`
- **Goal.** A single end-to-end check in this sprint, against a fresh test vault.
- **Checklist (results recorded in §13):**
  1. Drop `main.js` / `manifest.json` / `styles.css` into a fresh vault's `.obsidian/plugins/researchvault/` directory.
  2. Settings tab opens; create + rename + delete round-trip.
  3. `add-paper` command creates a paper file with correct frontmatter + body. Open it; template rendered correctly.
  4. Sidebar shows the new paper; status flip edits the file's frontmatter.
  5. Select text inside the paper note; `capture-quote` lands under `## Quotes` in the chosen paper.
  6. Audit: count of console warnings during the entire flow; log of network calls (`expected: none` outside an AI session).
- **Output.** PR with screenshots and a copy of the checklist scored.

### 3.x Tier 2 remainder  `[ ]`
- **`CitationManager`** — in-text citation insertion via editor callback; `exportBibtex(projectId)` writes a `.bib` per project from the inverse `citekey → file` index.
- **`VaultIndexer`** — `fuse.js` over note titles + frontmatter; backs the sidebar filter (2.3 follow-up) and Tier 3 search.
- **Literature-graph edges** — paper ↔ paper (`cites`, `extends`, `contradicts`). Storage decision: per-project JSON file in `<project>/literature/` once `saveData` (per `D5`) is too small.
- **`citeproc-js`** — explicitly deferred to a Sprint 3 follow-up per the `D11` rationale.

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

- **Manage** — projects, paper import, citekeys, BibTeX export. *(Today's release ships this.)*
- **Workflow** — quotes from PDFs and editor, literature links (cites / extends / contradicts), reading queue, Zotero sync. *(In development.)*
- **Intelligence** — vault-grounded AI chat, summarization, claim extraction, cross-paper synthesis. *(Planned.)*

## What works today

- Create / rename / archive research projects in **Settings → Projects**.
- Add papers by hand; citekey is auto-derived (`smith2024transformer`) and collision-safe (`smith2024transformer-2`).
- Every paper lives at `<Project>/papers/<citekey>.md` — your file, your folder, no lock-in.
- Status dropdown on the sidebar flips between Reading / Backlog / Read / Archived.
- Sidebar view lists papers grouped by status; click to open a paper note directly.
- Mobile-ready (Obsidian Mobile parity).

## What's coming

- Quote capture from editor selections — pick a paper, drop the quote, done.
- Paper import by DOI and PDF (text extraction once `pdfjs-dist` lands).
- Literature graph (cites / extends / contradicts edges).

## Privacy

- **Default-off network.** ResearchVault does not send your vault anywhere unless the AI features are explicitly on.
- **No telemetry.** No analytics. No fingerprinting.
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
- **PDF quote capture.** Mentioned in "What's coming" with the `pdfjs-dist` footnote, not listed under "What works today".
- **BibTeX export.** Mentioned in 3.x as planned work; do not promise shipped export until 3.x lands.
- **Mobile-specific PDF handling.** Awaiting the 2.6 outcome from §9.

> **Once we start a release.** Copy the *Current draft* above into `README.md`, bump the **What works today** bullets to match the latest dated entry in §13, and leave the rest untouched.
