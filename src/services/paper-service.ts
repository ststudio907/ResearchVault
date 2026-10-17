// src/services/paper-service.ts
//
// Manual + linked-PDF paper import, status transitions, quote capture, live
// sync from vault `modify`/`rename`/`delete` events.
// PDF import is link-only (D27): the chosen PDF is copied into the vault-level
// shared PDF library (`settings.pdfLibraryFolder`, D34) and wikilinked from
// the paper note; the same paper in another project links the same file.
// PDF text extraction (D27 deferred), BibTeX import/export (D17), and
// relationship management are not shipped — the dead stubs were removed in
// the 2026-10 cleanup (see `docs/REFACTOR_CONTEXT.md`).
//

import { TFile, TFolder, normalizePath } from 'obsidian';
import type {
  Paper,
  PaperSource,
  Quote,
  ReadingStatus,
} from '../types';
import { READING_STATUSES } from '../types';
import { generateUniqueCitekey, slugify } from '../utils/citekey';
import { joinFrontmatter, splitFrontmatter } from '../utils/frontmatter';
import { renderTemplate } from '../utils/template';
import { newId } from '../utils/uuid';
import type { ResearchVaultPlugin } from '../core/plugin';
import type { ProjectManager } from './project-manager';
import {
  DEFAULT_PAPER_TEMPLATE,
  frontmatterToPaper,
  normaliseAuthorName,
  renderQuoteSection,
  templateDataFor,
  toFrontmatter,
  trimOrUndefined,
  upsertAttachedPdfSection,
  type PaperFrontmatter,
} from './papers/paper-file-format';
import { SYNC_DEBOUNCE_MS, canonicalPathOf, papersFolderOf } from './papers/paper-paths';
import { findSamePaper, isInsideFolder, normalizePdfLibraryFolder } from './papers/paper-matching';

/** Input shape accepted by `PaperService.createManual`. */
export interface PaperManualInput {
  title: string;
  /** Last names per author — the canonical author shape (2.8.E). */
  authors: string[];
  /** Optional first names, parallel to `authors`. Empty strings allowed. */
  authorFirstNames?: string[];
  year: number;
  venue?: string;
  /** Publication metadata (D38 / 3.2 C0). Additive + purely optional. */
  volume?: string;
  issue?: string;
  /** Page range like "123-145". */
  pages?: string;
  publisher?: string;
  entryType?: Paper['entryType'];
  doi?: string;
  url?: string;
  /** Open-access PDF URL (4.1.A). Only set when 4.1.B's provider responses include it. */
  oaUrl?: string;
  /**
   * Vault-relative path of an existing PDF file the caller would like linked
   * to the new paper. If provided, `createManual` will copy the file into the
   * shared PDF library (renaming to `<citekey>.pdf`, D34) — or link it in
   * place if it's already inside the library — and inject a
   * `## Attached PDF` wikilink section into the note body. The user always
   * supplies the textual metadata — the PDF is just an attachment. (D28.)
   */
  attachPdfFrom?: string;
  /**
   * Explicit provenance for the resulting `Paper.source`. When omitted,
   * `createManual` infers `'pdf'` if `attachPdfFrom` is set, else `'manual'`.
   * 4.1.C's DOI-lookup button passes `source: 'doi'` so the imported paper
   * is distinguishable from manual entries and from PDF imports.
   */
  source?: PaperSource;
  abstract?: string;
  keywords?: string[];
  status?: ReadingStatus;
  priority?: Paper['priority'];
  rating?: number;
  /** Optional explicit citekey — otherwise computed from author/year/title. */
  citekey?: string;
}

/**
 * Aggregate access surface: O(1) lookup by id (`${projectId}/${citekey}`) or
 * canonical path. Citekeys are unique within a project but may repeat across
 * projects, so citekey lookups scan `byId` (cheap at realistic sizes).
 */
export class PaperService {
  /** Active in-memory record of the on-disk paper files, keyed by composite id. Recomputed by `hydrate()`. */
  private byId = new Map<string, Paper>();
  /**
   * Reverse index: lower-cased canonical note path (`<papersFolder>/<citekey>.md`) -> id.
   * Lets vault `rename`/`delete` handlers find a paper in O(1) even after the
   * file is gone (previously a linear scan that resolved files via the vault,
   * which silently missed deleted/renamed files).
   */
  private pathToId = new Map<string, string>();
  /** Per-path debounce timers for the vault `modify` handler (see `scheduleSync`). */
  private syncTimers = new Map<string, number>();
  /**
   * Sidebar-overhaul fix B (2026-09-28): paths we just wrote through
   * `persistPaper` / `addQuote`. The vault `modify` handler in `plugin.ts`
   * consumes a matching marker and skips the echo handling for that one
   * event, so our own writes are never mistaken for external edits (which
   * previously let the 2.8.D re-stamp resurrect a stale snapshot and
   * clobber in-flight changes). Markers are consumed exactly once; a failed
   * write removes its marker in the helper below.
   */
  private selfWritePaths = new Set<string>();

  constructor(
    private readonly plugin: ResearchVaultPlugin,
    private readonly projectManager: ProjectManager,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Walk every project's `papers/` folder and rebuild the in-memory index
   * from each file's frontmatter. Files missing required citekey / title /
   * year are silently skipped (logged) so a stray markdown file does not
   * poison the index.
   *
   * Phase 1 cleanup (2026-10): must run after `workspace.onLayoutReady` so the
   * metadata cache is populated; frontmatter is then read from
   * `metadataCache` (no disk I/O) with a `cachedRead` fallback. Startup no
   * longer creates folders — `createManual` / project creation do that when
   * they actually need to write.
   */
  async hydrate(): Promise<void> {
    this.byId.clear();
    this.pathToId.clear();

    for (const project of this.plugin.settings.projects) {
      const folder = this.plugin.app.vault.getAbstractFileByPath(
        this.projectManager.getProjectPapersFolder(project.id),
      );
      if (!(folder instanceof TFolder)) continue;

      const files = folder.children.filter(
        (c): c is TFile => c instanceof TFile && c.extension === 'md',
      );
      const papers = await Promise.all(
        files.map((f) => this.readPaperFile(f, project.id, { preferCache: true })),
      );
      for (const paper of papers) {
        if (paper) this.indexPaper(paper);
      }
    }
  }

  /** Cancel pending debounced syncs. Called from `plugin.onunload`. */
  dispose(): void {
    for (const handle of this.syncTimers.values()) window.clearTimeout(handle);
    this.syncTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Read accessors
  // -------------------------------------------------------------------------

  getAll(): Paper[] {
    return [...this.byId.values()];
  }

  getById(id: string): Paper | undefined {
    return this.byId.get(id);
  }

  /**
   * Look up a paper by citekey. Citekeys are unique within a project but may
   * repeat across projects, so pass `projectId` to disambiguate; without it
   * the first matching paper (arbitrary project) is returned.
   */
  getByCitekey(citekey: string, projectId?: string): Paper | undefined {
    const key = citekey.toLowerCase();
    for (const paper of this.byId.values()) {
      if (paper.citekey.toLowerCase() !== key) continue;
      if (projectId !== undefined && paper.customFields['projectId'] !== projectId) continue;
      return paper;
    }
    return undefined;
  }

  getInProject(projectId: string): Paper[] {
    return this.getAll().filter((p) => p.customFields['projectId'] === projectId);
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  /**
   * Create a paper record from manual input. Generates (or accepts) a
   * citekey, ensures the project's `papers/` folder exists, optionally
   * copies a chosen PDF into the shared PDF library as `<citekey>.pdf`
   * (D28: a PDF is an attachment, not a source of truth for metadata;
   * D34: one vault-level library shared by all projects), writes the
   * markdown file with rendered body, and emits `paperImported`.
   *
   * In memory the paper's `id` is the composite `${projectId}/${citekey}`:
   * citekeys are unique per project (the on-disk basename) but the same
   * paper — even the same citekey — may be added to several projects, and
   * only the composite keeps the `byId` index unambiguous. The disk
   * frontmatter `id` stays the plain citekey for human-friendly YAML.
   */
  async createManual(input: PaperManualInput, projectId: string): Promise<Paper> {
    const project = this.projectManager.getProjectById(projectId);
    if (!project) {
      throw new Error(`PaperService.createManual: project "${projectId}" not found.`);
    }
    if (!input.title?.trim()) {
      throw new Error('PaperService.createManual: title is required.');
    }
    if (!Number.isFinite(input.year)) {
      throw new Error('PaperService.createManual: a 4-digit year is required.');
    }

    await this.projectManager.ensureProjectFolders(projectId);
    const papersFolder = this.projectManager.getProjectPapersFolder(projectId);
    // D34: attachments land in ONE vault-level library, not `<project>/pdfs/`.
    const pdfLibrary = normalizePdfLibraryFolder(this.plugin.settings.pdfLibraryFolder);

    const citekey = this.resolveCitekey(input, papersFolder, projectId);
    const filePath = normalizePath(`${papersFolder}/${citekey}.md`);

    if (this.plugin.app.vault.getAbstractFileByPath(filePath)) {
      throw new Error(
        `PaperService.createManual: a paper already exists at "${filePath}".`,
      );
    }

    // D28: PDF attached is an attachment, never override or supply metadata.
    const trimmedAttach = trimOrUndefined(input.attachPdfFrom);
    let linkedPdfPath: string | undefined;
    // 4.1.A: widened from `'pdf' | 'manual'` to the full `PaperSource` union so
    // the new `oaUrl`/`source: 'doi'` code path (4.1.C) can stamp the right tag.
    // Backward-compatible: default still picks `'pdf'` when an attachment is
    // present, else `'manual'`. An explicit `input.source` always wins.
    let sourceTag: PaperSource = 'manual';
    if (trimmedAttach) {
      const source = this.plugin.app.vault.getAbstractFileByPath(trimmedAttach);
      if (!(source instanceof TFile) || source.extension.toLowerCase() !== 'pdf') {
        throw new Error(
          `PaperService.createManual: selected attachment is not a PDF file ("${trimmedAttach}").`,
        );
      }
      // D34: a source already inside the shared library (drag-drop pre-staged
      // it there, or the user re-picked another project's linked file) is
      // linked in place — a copy would silently duplicate the same bytes.
      linkedPdfPath = isInsideFolder(source.path, pdfLibrary)
        ? source.path
        : await this.copyPdfIntoLibrary(source, pdfLibrary, citekey);
      sourceTag = 'pdf';
    } else {
      // D34: no explicit attachment — if the same paper already exists in
      // another project with a PDF in the shared library, link that file so
      // the same work never gets a duplicate copy.
      const match = findSamePaper(
        this.getAll(),
        { doi: input.doi, title: input.title, authors: input.authors, year: input.year },
        projectId,
      );
      if (
        match?.paper.pdfPath &&
        this.plugin.app.vault.getAbstractFileByPath(match.paper.pdfPath) instanceof TFile
      ) {
        linkedPdfPath = match.paper.pdfPath;
      }
    }
    if (input.source) {
      sourceTag = input.source;
    }

    const now = Date.now();
    const paper: Paper = {
      id: `${projectId}/${citekey}`,
      citekey,
      title: input.title.trim(),
      authors: input.authors.map(normaliseAuthorName),
      authorFirstNames: input.authorFirstNames
        ? input.authorFirstNames.map((n) => n.trim()).map((_n, i) => {
            // Pad missing entries (or shorter array) with empty strings so the
            // two arrays stay the same length in memory and on disk.
            return (input.authorFirstNames ?? [])[i] ?? '';
          }).slice(0, input.authors.length)
        : undefined,
      year: input.year,
      venue: trimOrUndefined(input.venue),
      volume: trimOrUndefined(input.volume),
      issue: trimOrUndefined(input.issue),
      pages: trimOrUndefined(input.pages),
      publisher: trimOrUndefined(input.publisher),
      entryType: input.entryType,
      doi: trimOrUndefined(input.doi),
      url: trimOrUndefined(input.url),
      // 4.1.A: only set when the provider returned a usable OA link.
      // 4.1.B's `cslToManualInput` will populate this; we just round-trip.
      oaUrl: trimOrUndefined(input.oaUrl),
      pdfPath: linkedPdfPath,
      abstract: trimOrUndefined(input.abstract),
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      status: input.status ?? 'unread',
      priority: input.priority ?? 'normal',
      rating: input.rating,
      dateAdded: now,
      dateModified: now,
      quotes: [],
      claims: [],
      citations: [],
      citedBy: [],
      related: [],
      // `papersFolder` lets `findPaperFile` locate the note after writes that don't go through `createManual`
      // (e.g., an existing in-memory paper hydrated before the folder guarantee was added).
      customFields: { projectId, papersFolder },
      source: sourceTag,
    };

    const renderedBody = renderTemplate(this.paperTemplate(project), templateDataFor(paper));
    const body = upsertAttachedPdfSection(renderedBody, linkedPdfPath);
    const fileContent = joinFrontmatter(toFrontmatter(paper), body);
    await this.plugin.app.vault.create(filePath, fileContent);

    this.indexPaper(paper);

    this.plugin.eventBus.emit('paperImported', paper);
    return paper;
  }

  /**
   * Copy a PDF `TFile` from anywhere in the vault into the shared library as
   * `<citekey>.pdf` (D34). On a basename collision, suffix `-2`, `-3`, ...
   * until the destination is free. Creates the library folder (and parents)
   * on demand. Returns the absolute vault path of the newly-created file.
   */
  private async copyPdfIntoLibrary(source: TFile, pdfLibrary: string, citekey: string): Promise<string> {
    const bytes = await this.plugin.app.vault.readBinary(source);
    await this.ensureFolderRecursive(pdfLibrary);
    let target = normalizePath(`${pdfLibrary}/${citekey}.pdf`);
    let n = 1;
    while (this.plugin.app.vault.getAbstractFileByPath(target)) {
      n += 1;
      target = normalizePath(`${pdfLibrary}/${citekey}-${n}.pdf`);
    }
    await this.plugin.app.vault.createBinary(target, bytes);
    return target;
  }

  /**
   * Create `path` and any missing parents, tolerating a race with an
   * already-existing folder. (`vault.createFolder` throws when the parent is
   * missing and when the folder already exists.)
   */
  private async ensureFolderRecursive(path: string): Promise<void> {
    const segments = path.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (this.plugin.app.vault.getAbstractFileByPath(current)) continue;
      try {
        await this.plugin.app.vault.createFolder(current);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/exists|already/i.test(msg)) throw err;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  /** Update arbitrary fields. Persists via frontmatter; body is left alone **except** for the
   *  `## Attached PDF` section, which is re-rendered when `pdfPath` changes so a wikilink to
   *  the new file replaces any stale one (D27). */
  async updatePaper(
    id: string,
    updates: Partial<Omit<Paper, 'id' | 'citekey' | 'dateAdded' | 'quotes' | 'claims' | 'projectId'>>,
  ): Promise<Paper> {
    const current = this.requireById(id);
    const next: Paper = {
      ...current,
      ...updates,
      dateModified: Date.now(),
    };
    // Sidebar-overhaul fix A (2026-09-28): update the in-memory index BEFORE
    // persisting. `persistPaper`'s disk write fires a vault `modify` event,
    // and the handlers we registered for it read this index; updating first
    // means a stray `syncFromFile` sees the fresh values and short-circuits.
    // If the write fails we roll the index back so memory never diverges.
    this.indexPaper(next);
    try {
      await this.persistPaper(next, { refreshAttachedPdf: next.pdfPath !== current.pdfPath });
    } catch (err) {
      this.indexPaper(current);
      throw err;
    }
    // `paperUpdated` is the canonical signal for `updatePaper` so subscribers (sidebar, indexer)
    // re-render without needing to know whether the change came from the modal or a vault sync.
    this.plugin.eventBus.emit('paperUpdated', next);
    return next;
  }

  /** Update reading status only; emits `paperStatusChanged` for listeners like the sidebar. */
  async updateStatus(id: string, status: ReadingStatus): Promise<Paper> {
    if (!READING_STATUSES.includes(status)) {
      throw new Error(`PaperService.updateStatus: invalid status "${status}".`);
    }
    const next = await this.updatePaper(id, { status });
    this.plugin.eventBus.emit('paperStatusChanged', next);
    return next;
  }

  // -------------------------------------------------------------------------
  // Quotes
  // -------------------------------------------------------------------------

  /** Append a quote to the paper's in-memory list and to the on-disk body. */
  async addQuote(paperId: string, quote: Omit<Quote, 'id'>): Promise<Quote> {
    const paper = this.requireById(paperId);
    const storedQuote: Quote = {
      ...quote,
      id: newId(),
      tags: quote.tags ?? [],
      createdAt: quote.createdAt ?? Date.now(),
      source: quote.source ?? 'editor',
    };
    paper.quotes.push(storedQuote);

    const file = this.findPaperFile(paper);
    if (file) {
      const section = renderQuoteSection(storedQuote);
      await this.selfAwareProcess(file, (existing) => {
        const { body } = splitFrontmatter(existing);
        const heading = body.includes('## Quotes') ? '' : '## Quotes\n\n';
        const nextBody = `${body.trimEnd()}\n\n${heading}${section}`;
        return joinFrontmatter(toFrontmatter(paper), nextBody);
      });
    }

    return storedQuote;
  }

  // -------------------------------------------------------------------------
  // File operations + bulk
  // -------------------------------------------------------------------------

  async getNoteContent(paperIdOrCitekey: string): Promise<string> {
    const paper = this.byId.get(paperIdOrCitekey) ?? this.getByCitekey(paperIdOrCitekey);
    if (!paper) throw new Error(`PaperService.getNoteContent: paper "${paperIdOrCitekey}" not found.`);
    const file = this.findPaperFile(paper);
    if (!file) return '';
    return this.plugin.app.vault.read(file);
  }

  /**
   * Delete a paper from disk AND remove it from the in-memory index. Unlike
   * `ProjectManager.deleteProject`, we DO remove the file by default because
   * the file was authored by ResearchVault.
   */
  async deletePaper(paperId: string, options: { deleteFile?: boolean } = {}): Promise<void> {
    const paper = this.requireById(paperId);
    const file = this.findPaperFile(paper);
    if (file && options.deleteFile !== false) {
      // Use `trashFile` so the user's deletion preference (Settings → Files & Links → "Deleted files")
      // routes the note to `.trash` instead of an irreversible hard delete.
      await this.plugin.app.fileManager.trashFile(file);
    }
    this.dropFromIndex(paper.id);
    this.plugin.eventBus.emit('paperRemoved', { paperId: paper.id });
  }

  // -------------------------------------------------------------------------
  // Live sync (vault `modify` / `rename` / `delete`) — D23
  // -------------------------------------------------------------------------

  /**
   * Reload a paper from its on-disk file. Wired to `vault.on('modify')` so
   * that an in-Obsidian edit (status flip, priority bump, quote paste) shows
   * up in the sidebar without a manual refresh.
   */
  async syncFromFile(file: TFile): Promise<Paper | null> {
    if (file.extension !== 'md') return null;
    const projectId = this.findOwnerProject(file.path);
    if (!projectId) return null;

    const next = await this.readPaperFile(file, projectId);
    if (!next) {
      // Required fields vanished but the file still exists — drop it from the index so the sidebar
      // does not show a stale entry. Callers (plugin.onload) only wire sync for papers/ folders, so
      // this is essentially a "we lost the citekey and can't recover" branch.
      this.dropAtPath(file.path);
      return null;
    }

    const previous = this.byId.get(next.id);
    if (previous && papersEqual(previous, next)) {
      return previous;
    }

    this.indexPaper(next);
    this.plugin.eventBus.emit('paperUpdated', next);
    return next;
  }

  /**
   * Debounced entry point for the vault `modify` handler. Obsidian autosaves
   * roughly every 2 s while the user types, so we coalesce bursts into a
   * single `syncFromFile` per path. Replaces the old 2.8.D handler that
   * re-wrote frontmatter on every keystroke-save (D24 amended).
   */
  scheduleSync(file: TFile): void {
    if (file.extension !== 'md' || !this.findOwnerProject(file.path)) return;
    const pending = this.syncTimers.get(file.path);
    if (pending !== undefined) window.clearTimeout(pending);
    const handle = window.setTimeout(() => {
      this.syncTimers.delete(file.path);
      void this.syncFromFile(file).catch((err) => {
        console.warn('[ResearchVault] PaperService: sync failed for', file.path, err);
      });
    }, SYNC_DEBOUNCE_MS);
    this.syncTimers.set(file.path, handle);
  }

  /**
   * Drop a paper from the in-memory index by its `paper.id`. Keeps the path
   * reverse index consistent.
   */
  dropFromIndex(paperId: string): void {
    const paper = this.byId.get(paperId);
    if (!paper) return;
    this.byId.delete(paperId);
    const path = canonicalPathOf(paper);
    if (path) this.pathToId.delete(path.toLowerCase());
  }

  /** Insert or replace a paper in `byId` and the path reverse index. */
  private indexPaper(paper: Paper): void {
    if (this.byId.has(paper.id)) this.dropFromIndex(paper.id);
    this.byId.set(paper.id, paper);
    const path = canonicalPathOf(paper);
    if (path) this.pathToId.set(path.toLowerCase(), paper.id);
  }

  /**
   * Handle a vault `rename` or `delete` for a file. Drops the paper that was
   * at `oldPath` and (for renames into a project folder) tries to sync the
   * new path as if it had just appeared. Safe to call repeatedly.
   */
  async pathChanged(opts: { oldPath?: string; newPath?: string }): Promise<void> {
    if (opts.oldPath) {
      this.dropAtPath(opts.oldPath);
    }
    if (opts.newPath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(opts.newPath);
      if (file instanceof TFile) {
        await this.syncFromFile(file);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Self-write tracking + path lookups
  // -------------------------------------------------------------------------

  /**
   * Sidebar-overhaul fix B (2026-09-28): single choke point for every write
   * this service performs on an existing paper file. Arms the echo marker
   * just before the write and disarms it on failure, so the vault `modify`
   * event the write triggers is recognized as ours in `plugin.ts` exactly
   * once — success or not.
   *
   * Phase 1 cleanup (2026-10): uses `vault.process` so the read-modify-write
   * is atomic — a user keystroke-save between our read and our write can no
   * longer be overwritten.
   */
  private async selfAwareProcess(file: TFile, fn: (data: string) => string): Promise<void> {
    this.selfWritePaths.add(file.path);
    try {
      await this.plugin.app.vault.process(file, fn);
    } catch (err) {
      this.selfWritePaths.delete(file.path);
      throw err;
    }
  }

  /**
   * Consume-at-most-once check used by the vault `modify` handler in
   * `plugin.ts`: returns true (and removes the marker) when the event is the
   * echo of one of our own writes and must not be treated as an external
   * edit.
   */
  consumeSelfWrite(path: string): boolean {
    return this.selfWritePaths.delete(path);
  }

  /**
   * Resolve the paper id for a note path. O(1) via `pathToId`; falls back to
   * the basename-as-citekey lookup for notes whose basename is the citekey
   * but whose recorded folder differs. Works after the file is already gone
   * from the vault (rename/delete).
   */
  private idAtPath(filePath: string): string | undefined {
    const byPath = this.pathToId.get(normalizePath(filePath).toLowerCase());
    if (byPath) return byPath;
    const stem = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    if (!stem) return undefined;
    // Fallback: find the indexed paper whose citekey AND folder match.
    // Citekeys can repeat across projects, so the folder guard is required.
    const stemLower = stem.toLowerCase();
    const parent = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
    for (const paper of this.byId.values()) {
      if (paper.citekey.toLowerCase() === stemLower && papersFolderOf(paper) === parent) {
        return paper.id;
      }
    }
    return undefined;
  }

  /**
   * Drop the paper (if any) stored at `filePath` and emit `paperRemoved`.
   */
  private dropAtPath(filePath: string): void {
    const id = this.idAtPath(filePath);
    if (!id) return;
    this.dropFromIndex(id);
    this.plugin.eventBus.emit('paperRemoved', { paperId: id });
  }

  /**
   * Find which project (if any) the supplied file path belongs to by checking
   * each project's `papers/` folder. Returns `undefined` for files outside any
   * ResearchVault project.
   */
  private findOwnerProject(filePath: string): string | undefined {
    for (const project of this.plugin.settings.projects) {
      const folder = this.projectManager.getProjectPapersFolder(project.id);
      if (!folder) continue;
      // Obsidian normalises all paths to forward slashes, so a single
      // prefix check is enough \u2014 no need to also probe Windows separators.
      if (filePath === folder || filePath.startsWith(`${folder}/`)) {
        return project.id;
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireById(id: string): Paper {
    const paper = this.byId.get(id);
    if (!paper) {
      // Throw-only: callers decide how to surface the failure (Notice, modal).
      throw new Error(`Paper not found: ${id}`);
    }
    return paper;
  }

  /**
   * Read a single paper markdown file and rebuild a `Paper` from its
   * frontmatter. With `preferCache` the frontmatter is taken from
   * `metadataCache` (hydration only — the caller runs after layout-ready, so
   * the cache is warm and no disk I/O is needed); any cache miss falls back
   * to `cachedRead` + manual parsing.
   */
  private async readPaperFile(
    file: TFile,
    projectId: string,
    options: { preferCache?: boolean } = {},
  ): Promise<Paper | null> {
    try {
      let frontmatter: Partial<PaperFrontmatter> | undefined;
      if (options.preferCache) {
        const cached = this.plugin.app.metadataCache.getFileCache(file);
        if (cached?.frontmatter) {
          frontmatter = cached.frontmatter;
        }
      }
      if (!frontmatter) {
        const raw = await this.plugin.app.vault.cachedRead(file);
        frontmatter = splitFrontmatter<Partial<PaperFrontmatter>>(raw).frontmatter;
      }
      if (!frontmatter.title || !frontmatter.citekey || !frontmatter.year) {
        console.warn('[ResearchVault] PaperService: skipping file without required fields', file.path);
        return null;
      }
      return frontmatterToPaper(frontmatter, projectId, file);
    } catch (err) {
      console.warn('[ResearchVault] PaperService: failed to read', file.path, err);
      return null;
    }
  }

  /** Resolve an absolute path for a `Paper`'s markdown file via citekey + papers folder. */
  private findPaperFile(paper: Paper): TFile | null {
    const folder = papersFolderOf(paper);
    if (!folder) return null;
    const abstract = this.plugin.app.vault.getAbstractFileByPath(
      normalizePath(`${folder}/${paper.citekey}.md`),
    );
    return abstract instanceof TFile ? abstract : null;
  }

  /**
   * Pick a unique citekey for an incoming paper. "Unique" is scoped to the
   * TARGET project: a citekey already used in another project is fine — the
   * same paper may live in several projects. If the user supplied a citekey
   * we honour it as long as it doesn't collide within the project; otherwise
   * we derive one from author/year/title and append `-2`, `-3`, … on
   * collisions.
   */
  private resolveCitekey(input: PaperManualInput, papersFolder: string, projectId: string): string {
    const folder = this.plugin.app.vault.getAbstractFileByPath(papersFolder);
    if (!(folder instanceof TFolder)) {
      throw new Error('PaperService.createManual: papers folder disappeared mid-flight.');
    }

    const isTaken = (candidate: string): boolean => {
      const path = normalizePath(`${papersFolder}/${candidate}.md`);
      if (this.plugin.app.vault.getAbstractFileByPath(path)) return true;
      return this.getByCitekey(candidate, projectId) !== undefined;
    };

    if (input.citekey && input.citekey.trim()) {
      const explicit = slugify(input.citekey);
      if (!explicit) throw new Error('PaperService.createManual: citekey is empty after slugify.');
      if (isTaken(explicit)) {
        throw new Error(
          `PaperService.createManual: citekey "${explicit}" is already in use in this project.`,
        );
      }
      return explicit;
    }

    const lastName = input.authors[0] || 'anon';
    return generateUniqueCitekey(
      { lastName, year: input.year, title: input.title },
      isTaken,
    );
  }

  /** Resolve the template string for a project's paper notes. Falls back to a sane default. */
  private paperTemplate(project: { settings: { paperTemplate?: string } }): string {
    const tpl = project.settings.paperTemplate ?? this.plugin.settings.templates.paper;
    return tpl && tpl.trim().length > 0 ? tpl : DEFAULT_PAPER_TEMPLATE;
  }

  /** Write the given paper's frontmatter to disk; body is untouched unless
   *  `options.refreshAttachedPdf` is true, in which case the `## Attached PDF`
   *  section is rewritten to reflect the current `paper.pdfPath` (D27). */
  private async persistPaper(
    paper: Paper,
    options: { refreshAttachedPdf?: boolean } = {},
  ): Promise<void> {
    if (options.refreshAttachedPdf) {
      await this.refreshAttachedPdfBody(paper);
      return;
    }
    const file = this.findPaperFile(paper);
    if (!file) {
      // No existing file — create one at the canonical papersFolder location.
      const folder = papersFolderOf(paper);
      if (!folder) {
        throw new Error(
          `PaperService: cannot persist "${paper.citekey}" because no papersFolder is recorded in customFields.`,
        );
      }
      const path = normalizePath(`${folder}/${paper.citekey}.md`);
      await this.plugin.app.vault.create(path, joinFrontmatter(toFrontmatter(paper), ''));
      return;
    }
    await this.selfAwareProcess(file, (existing) => {
      const { body } = splitFrontmatter(existing);
      return joinFrontmatter(toFrontmatter(paper), body);
    });
  }

  /**
   * Read the paper's existing note, replace the `## Attached PDF` section with
   * one that wikilinks the paper's current `pdfPath` (or remove the section
   * entirely if no PDF is linked), and write the note back. Leaves the rest
   * of the body alone so user-authored notes survive the rewrite.
   */
  private async refreshAttachedPdfBody(paper: Paper): Promise<void> {
    const file = this.findPaperFile(paper);
    if (!file) return; // Nothing on disk yet — the next persistPaper will create the file.
    await this.selfAwareProcess(file, (existing) => {
      const { body } = splitFrontmatter(existing);
      const nextBody = upsertAttachedPdfSection(body, paper.pdfPath);
      return joinFrontmatter(toFrontmatter(paper), nextBody);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shallow equality used by `syncFromFile` to decide whether a disk change is
 * actually a content change. We intentionally exclude `quotes`/`claims`/etc.
 * because those live in the body and don't affect sidebar rendering.
 */
function papersEqual(a: Paper, b: Paper): boolean {
  return (
    a.id === b.id &&
    a.citekey === b.citekey &&
    a.title === b.title &&
    a.year === b.year &&
    a.venue === b.venue &&
    a.volume === b.volume &&
    a.issue === b.issue &&
    a.pages === b.pages &&
    a.publisher === b.publisher &&
    a.entryType === b.entryType &&
    a.doi === b.doi &&
    a.url === b.url &&
    a.pdfPath === b.pdfPath &&
    a.abstract === b.abstract &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.rating === b.rating &&
    a.dateAdded === b.dateAdded &&
    a.dateModified === b.dateModified &&
    a.dateRead === b.dateRead &&
    a.source === b.source &&
    a.importedFrom === b.importedFrom &&
    authorsEqual(a.authors, b.authors) &&
    keywordsEqual(a.keywords, b.keywords)
  );
}

/**
 * 2.8.E — author arrays are plain last-name strings now. We compare only
 * the canonical `authors` field; `authorFirstNames` is an enriched display
 * parallel array and is intentionally not part of the equality lattice so
 * a user editing just the last-name list does not flip `papersEqual`.
 */

function authorsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function keywordsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

