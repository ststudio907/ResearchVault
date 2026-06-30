# ResearchVault - Project Context for AI Assistant

## Project Overview
ResearchVault is an Obsidian plugin that transforms Obsidian into a research operating system. It manages academic papers, tracks reading progress, organizes projects, and integrates AI for research synthesis—all while keeping data in markdown files.

**Current Phase:** Sprint 1 - Foundation (Week 1)  
**Status:** Architecture complete, implementation starting  
**Tech Stack:** TypeScript, Obsidian API, Node.js

## What Has Been Completed (Planning Phase)

### ✅ Architecture Designed
- Modular service-based architecture (ProjectManager, PaperService, AIClient, etc.)
- Data models defined (Project, Paper, LiteratureNote, AIConfig)
- Storage strategy: Markdown files + JSON settings (no external DB)
- UI structure: Ribbon buttons, sidebar views, modals

### ✅ Project Structure Planned
src/
├── main.ts # Plugin entry point
├── types/
│ ├── project.ts # Project, ProjectSettings interfaces
│ ├── literature.ts # Paper, Author, Quote interfaces
│ ├── notes.ts # LiteratureNote, AtomicNote interfaces
│ ├── ai.ts # AIConfig, ChatMessage interfaces
│ └── index.ts # Type exports
├── core/
│ ├── plugin.ts # Main plugin class
│ ├── events.ts # Event bus
│ └── constants.ts # Enums, constants
├── services/
│ ├── project-manager.ts # Project CRUD, switching
│ ├── paper-service.ts # Paper import, metadata
│ ├── citation-manager.ts # Citekey generation, BibTeX
│ ├── vault-indexer.ts # Search, indexing
│ ├── ai-client.ts # LLM API integration
│ ├── pdf-service.ts # PDF text extraction
│ └── template-engine.ts # Note templating
├── ui/
│ ├── components/ # Reusable UI components
│ ├── views/ # Sidebar views
│ ├── modals/ # Dialogs
│ └── settings/ # Settings tab
└── utils/ # Helper functions

### ✅ Data Models Defined

See `/src/types/` for full interfaces. Key types:

**Project:**
- id, name, folderPath, description, settings, isActive
- Settings include: templates, citationStyle, aiProvider, customFields

**Paper:**
- citekey (unique), title, authors[], year, venue, doi, pdfPath
- status: 'unread' | 'queued' | 'skimming' | 'reading' | 'annotating' | 'summarized' | 'synthesized' | 'archived'
- priority: 'low' | 'medium' | 'high' | 'critical'
- quotes[], claims[], citations[], related[]

**AIConfig:**
- provider: 'openai' | 'anthropic' | 'local' | 'custom'
- model, apiKey, maxTokens, temperature
- Feature toggles: enableSummarization, enableChat, enableSuggestions

## What Needs to Be Built (Sprint 1)

### Immediate Tasks (This Session)

1. **Create Type Definition Files**
   - Create `/src/types/project.ts` with Project, ProjectSettings, ProjectStats interfaces
   - Create `/src/types/literature.ts` with Paper, Author, Quote, Claim, ReadingStatus, Priority
   - Create `/src/types/ai.ts` with AIConfig, ChatMessage, AIRequest, AIResponse
   - Create `/src/types/index.ts` exporting all types

2. **Set Up Plugin Foundation**
   - Create `/src/main.ts` with plugin entry point
   - Create `/src/core/plugin.ts` with main ResearchVaultPlugin class
   - Implement lifecycle: onload, onunload
   - Add settings tab integration

3. **Implement Settings System**
   - Create `/src/settings/settings.ts` with ResearchVaultSettings interface
   - Create `/src/ui/settings/settings-tab.ts` with settings UI
   - Default settings with AI config, project array, templates

4. **Start ProjectManager Service**
   - Create `/src/services/project-manager.ts`
   - Implement: createProject, getActiveProject, activateProject
   - Store projects in plugin data (this.app.saveData/loadData)

### Technical Requirements

**Obsidian API Patterns to Follow:**
- Use `Plugin` base class from 'obsidian'
- Settings via `PluginSettingTab`
- Files via `this.app.vault` (TFile, TFolder)
- UI via `Modal`, `Setting`, `PluginSettingTab`
- Events via `Workspace.on('event-name', callback)`

**Storage Strategy:**
- Projects: `this.saveData({ projects: [...] })` in plugin data
- Papers: Regular markdown files with YAML frontmatter
- Settings: Obsidian's built-in settings system

**Naming Conventions:**
- Classes: PascalCase (ProjectManager)
- Interfaces: PascalCase (ProjectSettings)
- Files: kebab-case (project-manager.ts)
- Constants: UPPER_SNAKE_CASE

## Key Technical Decisions Already Made

1. **No external database** - Everything in markdown files + JSON
2. **Project-based isolation** - One vault, multiple projects via folder paths
3. **Citekey format** - authorYYYYtitle (customizable per project)
4. **AI abstraction** - Support multiple providers via unified interface
5. **PDF extraction** - Use pdfjs-dist in worker thread (don't block UI)

## Dependencies to Add

```json
{
  "dependencies": {
    "pdfjs-dist": "^4.0.0",
    "citeproc": "^2.4.63",
    "fuse.js": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "obsidian": "latest",
    "tslib": "^2.6.0",
    "typescript": "^5.3.0",
    "esbuild": "^0.20.0"
  }
}
Reference Materials in Repo
/README.md - Living document with roadmap and current status
/src/types/*.ts - Type definitions (to be created)
/manifest.json - Obsidian plugin manifest
/package.json - Dependencies
Current Blockers / Questions
None. Ready to implement Sprint 1.

Success Criteria for Sprint 1
 Plugin loads without errors in Obsidian
 Can create a new project via settings
 Can switch between projects
 Project data persists across restarts
 Settings UI is functional
---