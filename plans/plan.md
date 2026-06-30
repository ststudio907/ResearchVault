# ResearchVault — Master Plan

> **Authority:** This document is the source of truth for the ResearchVault Obsidian plugin. `PROJECT_CONTEXT.md` is editable and should be aligned to this plan when they diverge.

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

Decisions are locked unless a future sprint reveals a real blocker; any change goes through this plan file.

---

## 4. Module Blueprints

### 4.1 Core
- **`ResearchVaultPlugin`** — extends `Plugin`. Holds `settings`, `projectManager`, `paperService` (stub in Sprint 1), `aiClient` (stub). `onload`: hydrate settings → instantiate services → register ribbon ("library") → register commands → add settings tab → register event handlers. `onunload`: services dispose.
- **`EventBus`** — typed cross-service pub/sub. Services emit (`projectChanged`, `paperImported`, `paperStatusChanged`, `aiRequestStarted`, `aiRequestCompleted`). UI listens.

### 4.2 Services (all instantiable classes, JSDoc on public methods)

| Service | Sprint | Responsibilities |
|---|---|---|
| `ProjectManager` | 1 | Create/list/get/activate/delete projects; vault-folder association; per-project file filtering; stats. |
| `PaperService` | 2 | Import PDF/DOI → metadata + citekey → create paper note file; status transitions; quote/claim CRUD. |
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
- `frontmatter.ts` — read/write YAML frontmatter in markdown files (no `js-yaml` dep; small hand-rolled parser/writer).
- `path.ts` — helpers to safely concatenate vault paths, normalize trailing slashes.
- `debounce.ts` — generic debounce/throttle.

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
- [ ] **E1.** [`src/ui/modals/create-project-modal.ts`](../src/ui/modals/create-project-modal.ts):
  - `extends Modal`.
  - Inputs: name (text), folder path (text + "Suggest" button using `app.vault.getAllFolders()`).
  - On submit → `projectManager.createProject(...)`; close on success; `Notice` on error.
  - Reads citation style default from settings.

### Phase F — Verification
- [ ] **F1.** `npm run build` — must complete with zero errors. `main.js` produced at root.
- [ ] **F2.** `npm run lint` — zero errors, zero warnings.
- [ ] **F3.** `npx tsc --noEmit` — type check is clean.

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
- [x] `main.js` produced; `manifest.json` validated.
- [x] This plan file committed.
- [x] `PROJECT_CONTEXT.md` updated to match this plan if they diverged (history kept).

Ready to start Phase A on user approval.
