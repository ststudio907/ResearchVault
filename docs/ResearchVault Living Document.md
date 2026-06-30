# ResearchVault

> An Obsidian plugin for serious researchers. Manage papers, synthesize knowledge, and integrate AI into your research workflow—all without leaving your vault.

**Current Version:** 0.0.0 (Pre-alpha)  
**Status:** 🚧 Active Development  
**Last Updated:** 2026-06-30

---

## Quick Links

- [Feature Roadmap](#feature-roadmap)
- [Current Status](#current-status)
- [Architecture](#architecture)
- [Development Setup](#development-setup)
- [User Guide](#user-guide) (coming soon)
- [Changelog](#changelog)

---

## Vision

ResearchVault transforms Obsidian from a general note-taking tool into a purpose-built research operating system. It bridges the gap between reference managers (Zotero), note-taking apps (Obsidian), and AI research assistants—without forcing you to switch contexts or export data.

**Core Principles:**
1. **Your data stays yours** - Everything lives in markdown files you control
2. **Work in projects, not silos** - One vault, multiple isolated research projects
3. **AI augments, doesn't replace** - AI helps you think, not think for you
4. **Capture fast, organize later** - Frictionless paper ingestion

---

## Current Status

### ✅ Working Now
*Features currently functional in the dev build*

- [x] Project creation and management
- [x] Basic paper import (DOI lookup via Crossref)
- [x] Citekey generation (authorYYYYtitle format)
- [x] Structured paper notes with templates
- [x] Reading status tracking (unread → reading → summarized)
- [x] Project sidebar with reading queue

### 🚧 In Progress
*Features being actively developed*

- [ ] PDF text extraction and metadata parsing
- [ ] BibTeX import/export
- [ ] AI chat panel with vault context
- [ ] Paper summarization via LLM
- [ ] Citation relationship tracking (cites, relates-to)

### 📋 Planned
*Features in the backlog, ready for development*

- [ ] Browser extension for one-click capture
- [ ] Zotero/Mendeley sync
- [ ] Literature matrix view (spreadsheet comparison)
- [ ] Advanced AI features (gap analysis, synthesis)
- [ ] Mobile optimization

### ❌ Known Issues
*Current limitations and bugs*

- [ ] Large PDFs (>50MB) cause UI freeze during import
- [ ] AI chat doesn't persist across Obsidian restarts
- [ ] Citation formatting only supports APA and MLA
- [ ] Project switch doesn't update graph view filters

---

## Feature Roadmap

### Phase 1: Foundation (MVP) - Target: Month 2
*Goal: Core paper workflow functional*

- [x] Plugin scaffold and settings system
- [x] Project management (create, switch, delete)
- [x] Paper import via DOI with metadata extraction
- [x] Basic citekey generation
- [x] Structured note templates
- [x] Reading status workflow
- [ ] PDF text extraction
- [ ] BibTeX export
- [ ] Reading queue sidebar

### Phase 2: Knowledge Organization - Target: Month 4
*Goal: Connect papers and build knowledge graph*

- [ ] Paper relationship types (cites, contradicts, extends)
- [ ] Auto-link suggestions
- [ ] Literature graph visualization
- [ ] Concept notes (aggregated claims)
- [ ] Quote management with page refs
- [ ] Reading time tracking
- [ ] Priority/ranking system

### Phase 3: AI Integration - Target: Month 6
*Goal: AI-assisted research intelligence*

- [ ] Vault indexing for semantic search
- [ ] AI chat panel with project scoping
- [ ] Single paper summarization
- [ ] Cross-paper synthesis
- [ ] Claim extraction
- [ ] Gap identification
- [ ] Citation-aware AI responses

### Phase 4: Advanced Features - Target: Month 8+
*Goal: Power user features and ecosystem*

- [ ] Browser extension
- [ ] Zotero/Mendeley sync
- [ ] Literature matrix view
- [ ] Collaborative features
- [ ] Advanced export (pandoc integration)
- [ ] Plugin API for extensions

---

## Architecture

### System Overview