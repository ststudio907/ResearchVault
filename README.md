# ResearchVault

An Obsidian plugin that turns your vault into a **research operating system**: manage projects, track papers, capture quotes, organize atomic notes, and (in later sprints) synthesize across sources with AI assistance.

> Status: **Sprint 1 — Foundation**. Projects can be created, switched, and persist across restarts. PDF import, citation manager, AI client, and search land in subsequent sprints. See [`plans/plan.md`](plans/plan.md) for the full roadmap.

## Features shipped in Sprint 1

- Ribbon button with `library` icon and command palette entries (`Create research project`, `Switch active project`).
- `ResearchVaultPlugin` lifecycle (load, unload, settings persistence).
- `ResearchVaultSettings` with versioned schema + `migrateSettings` notional entry point.
- `ProjectManager` service covering create / read / update / delete, activation invariant (single `isActive`), per-project file filtering, and a stubbed `getProjectStats` that counts markdown files under `<project>/papers/`.
- `EventBus` with typed payloads (`projectChanged`, `paperImported`, etc.).
- Settings UI: General, Projects (list with Activate/Delete), AI (provider/model/key/feature toggles), Templates.
- `CreateProjectModal` and `SwitchProjectModal` for fast onboarding.

## Quick start (development)

```bash
# from the repo root
npm install
npm run dev          # type-check + watch-bundle into main.js
npm run build        # one-shot production bundle (writes main.js)
npm run lint         # eslint with eslint-plugin-obsidianmd
```

The build emits `main.js` at the repo root; copy that alongside `manifest.json` and `styles.css` into:

```
<Vault>/.obsidian/plugins/researchvault/
```

Reload Obsidian (`Settings → Community plugins → ResearchVault → enable`).

## File map

```
src/
├── main.ts                     # minimal re-export of the plugin class
├── core/
│   ├── plugin.ts               # ResearchVaultPlugin + EventBus
│   └── events.ts               # typed event payloads
├── settings.ts                 # ResearchVaultSettings + DEFAULT_SETTINGS + migrateSettings
├── services/
│   ├── project-manager.ts      # CRUD, activation, file filtering
│   ├── ai-client.ts            # stub (Sprint 4)
│   ├── paper-service.ts        # stub (Sprint 2)
│   ├── vault-indexer.ts        # stub (Sprint 3)
│   └── notes.ts                # stub (Sprint 2)
├── types/
│   ├── index.ts                # barrel re-export of all types
│   ├── project.ts              # Project, ProjectSettings, ProjectStats, ProjectCreateConfig
│   ├── literature.ts           # Paper, Author, Quote, Claim, statuses, priorities
│   ├── notes.ts                # LiteratureNote, AtomicNote, ConceptNote
│   └── ai.ts                   # AIConfig, ChatMessage, AIRequest/AIResponse
├── ui/
│   ├── settings/
│   │   └── settings-tab.ts     # ResearchVaultSettingTab
│   └── modals/
│       └── create-project-modal.ts   # CreateProjectModal, SwitchProjectModal
└── utils/
    ├── event-emitter.ts        # tiny typed emitter (mobile-safe)
    └── uuid.ts                 # crypto.randomUUID with fallback
plans/plan.md                   # master plan; source of truth for architecture
```

## Privacy & external services

ResearchVault's AI features send only user-selected text (papers, notes, chat input) to the provider configured in **Settings → AI features**. No telemetry, no auto-update, no external code execution. API keys are stored locally in plaintext — protected by your Obsidian settings file.

**Citation lookup** (opt-in, off by default under **Settings → Citations**) sends only the DOI or search string you typed to `api.crossref.org` and/or `api.openalex.org`. No vault content is sent. Responses are cached locally for 30 days so repeat lookups don't re-hit the network. The optional polite-pool `mailto:` contact is off by default and, when enabled, is sent only to your chosen provider.

**Zotero sync** (opt-in, off by default under **Settings → Zotero sync**) sends only library read requests — plus your search terms — to `api.zotero.org`, using the account ID and read-only API key you provide. No vault content is sent. The API key is stored locally in this vault's plugin settings file.

**Zotero push** (opt-in, off by default under **Settings → Zotero push (desktop)**, desktop only) sends a paper's metadata (title, authors, year, DOI, abstract) to the Zotero desktop app running on the same computer, via Zotero's local connector server on `127.0.0.1:23119`. All traffic stays on your machine — nothing is sent to any server. The push button appears only when Zotero is actually running.

See the [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) and [developer policies](https://docs.obsidian.md/Developer+policies) for the constraints that shaped these choices.

## License

0-BSD (same as the Obsidian sample plugin we forked from).
