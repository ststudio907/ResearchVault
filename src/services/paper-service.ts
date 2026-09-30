// src/services/paper-service.ts
//
// Sprint 2 — manual + linked-PDF paper import, status transitions, quote capture.
// PDF import is link-only (D27): the chosen PDF is copied into the project's
// `pdfs/` folder and wikilinked from the paper note. PDF text extraction
// (D27 deferred) and BibTeX import/export (D17) deliberately still throw
// `notImplemented` so calls surface loudly while we keep the file lean —
// each of those is its own follow-up sub-task (see plans/plan.md §7 / §13).
//

import { Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type {
  Paper,
  PaperSource,
  Quote,
  ReadingStatus,
} from '../types';
import { READING_STATUSES } from '../types';
import { generateUniqueCitekey, slugify } from '../utils/citekey';
import { fromFrontmatterDate, toLocalDateTime } from '../utils/format-date';
import { joinFrontmatter, splitFrontmatter } from '../utils/frontmatter';
import { renderTemplate, type TemplateData } from '../utils/template';
import { newId } from '../utils/uuid';
import type { ResearchVaultPlugin } from '../core/plugin';
import type { ProjectManager } from './project-manager';

/** Keys we promise to round-trip via frontmatter. */
type PaperFrontmatter = {
  id: string;
  citekey: string;
  title: string;
  /** Author last names as a YAML list (2.8.E). */
  authors: string[];
  /** Optional parallel first names list (2.8.E). */
  authorFirstNames?: string[];
  year: number;
  venue?: string;
  doi?: string;
  url?: string;
  /** Open-access PDF URL (4.1.A) — only set by 4.1.B's provider responses. */
  oaUrl?: string;
  pdfPath?: string;
  abstract?: string;
  keywords: string[];
  status: ReadingStatus;
  priority: Paper['priority'];
  rating?: number;
  /** ISO date+time string per `D24`. In-memory `Paper.dateAdded` stays as epoch ms. */
  dateAdded: string;
  dateModified: string;
  dateRead?: string;
  source: PaperSource;
  importedFrom?: string;
  customFields: Record<string, unknown>;
};

/** Input shape accepted by `PaperService.createManual`. */
export interface PaperManualInput {
  title: string;
  /** Last names per author — the canonical author shape (2.8.E). */
  authors: string[];
  /** Optional first names, parallel to `authors`. Empty strings allowed. */
  authorFirstNames?: string[];
  year: number;
  venue?: string;
  doi?: string;
  url?: string;
  /** Open-access PDF URL (4.1.A). Only set when 4.1.B's provider responses include it. */
  oaUrl?: string;
  /**
   * Vault-relative path of an existing PDF file the caller would like linked
   * to the new paper. If provided, `createManual` will copy the file into the
   * project's `pdfs/` folder (renaming to `<citekey>.pdf`) and inject a
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

/** Aggregate access surface: maps makes O(1) lookup by either id or citekey cheap. */
export class PaperService {
  /** Active in-memory record of the on-disk paper files. Recomputed by `hydrate()`. */
  private byId = new Map<string, Paper>();
  /** Reverse index: citekey -> id, kept consistent with `byId` on every mutation. */
  private citekeyToId = new Map<string, string>();
  private initialized = false;
  /**
   * Sidebar-overhaul fix B (2026-09-28): paths we just wrote through
   * `persistPaper` / `addQuote`. The vault `modify` handler in `plugin.ts`
   * consumes a matching marker and skips the echo handling for that one
   * event, so our own writes are never mistaken for external edits (which
   * previously let `onPaperFileModified` re-stamp from a stale snapshot and
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
   */
  async hydrate(): Promise<void> {
    this.byId.clear();
    this.citekeyToId.clear();

    for (const project of this.plugin.settings.projects) {
      // Best-effort: make sure folders exist even if a project was created
      // before Sprint 2 migration. Silent if already there.
      try {
        await this.projectManager.ensureProjectFolders(project.id);
      } catch (err) {
         
        console.warn('[ResearchVault] PaperService: failed to ensure folders for', project.name, err);
      }

      const folder = this.plugin.app.vault.getAbstractFileByPath(
        this.projectManager.getProjectPapersFolder(project.id),
      );
      if (!(folder instanceof TFolder)) continue;

      for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== 'md') continue;
        const paper = await this.readPaperFile(child, project.id);
        if (paper) {
          this.byId.set(paper.id, paper);
          this.citekeyToId.set(paper.citekey, paper.id);
        }
      }
    }

    this.initialized = true;
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

  getByCitekey(citekey: string): Paper | undefined {
    const id = this.citekeyToId.get(citekey.toLowerCase());
    return id ? this.byId.get(id) : undefined;
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
   * copies a chosen PDF into `<project>/pdfs/<citekey>.pdf` (D28: PDF is an
   * attachment, not a source of truth for metadata), writes the markdown
   * file with rendered body, and emits `paperImported`.
   *
   * The `id` field of the resulting paper is the citekey — the on-disk
   * file is canonically identified by its basename. This keeps the
   * citation vocabulary the same in markdown links and internal lookups.
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
    const pdfsFolder = this.projectManager.getProjectPdfsFolder(projectId);

    const citekey = this.resolveCitekey(input, papersFolder);
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
      linkedPdfPath = await this.copyPdfIntoProject(source, pdfsFolder, citekey);
      sourceTag = 'pdf';
    }
    if (input.source) {
      sourceTag = input.source;
    }

    const now = Date.now();
    const paper: Paper = {
      id: citekey,
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

    this.byId.set(paper.id, paper);
    this.citekeyToId.set(paper.citekey.toLowerCase(), paper.id);

    this.plugin.eventBus.emit('paperImported', paper);
    return paper;
  }

  // ----- Stubbed per Sprint 2 lean decision -----

  async createFromDoi(_doi: string, _projectId: string): Promise<Paper> {
    throw this.notImplemented('createFromDoi');
  }

  /**
   * Removed in sub-pass 2.7.1. The D27 PDF-importer became the D28 "PDF is an
   * attachment" path inside `createManual` (via `PaperManualInput.attachPdfFrom`).
   * Keeping a public stub would invite an old caller to silently synthesize
   * metadata from a PDF basename, which is exactly the bug we just fixed.
   */
  async createFromPdf(_pdfPath: string, _projectId: string): Promise<Paper> {
    throw new Error(
      'PaperService.createFromPdf: removed in 2.7.1 (D28). Use createManual({ ..., attachPdfFrom }).',
    );
  }

  /**
   * Copy a PDF `TFile` from anywhere in the vault into `<pdfsFolder>/<citekey>.pdf`.
   * On a basename collision, suffix `-2`, `-3`, ... until the destination is free.
   * Returns the absolute vault path of the newly-created file.
   */
  private async copyPdfIntoProject(source: TFile, pdfsFolder: string, citekey: string): Promise<string> {
    const bytes = await this.plugin.app.vault.readBinary(source);
    let target = normalizePath(`${pdfsFolder}/${citekey}.pdf`);
    let n = 1;
    while (this.plugin.app.vault.getAbstractFileByPath(target)) {
      n += 1;
      target = normalizePath(`${pdfsFolder}/${citekey}-${n}.pdf`);
    }
    await this.plugin.app.vault.createBinary(target, bytes);
    return target;
  }


  async importBibtex(_bibtex: string, _projectId: string): Promise<Paper[]> {
    throw this.notImplemented('importBibtex');
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
    // and the handlers we registered for it (`onPaperFileModified`,
    // `syncFromFile`) read this index. Updating it first means the
    // re-stamp's 2-second guard sees the fresh `dateModified` and skips,
    // and `syncFromFile`'s `papersEqual` short-circuits — the pre-fix order
    // let the re-stamp resurrect the STALE pre-change paper and clobber the
    // user's edit on disk (the "status changes then reverts right away" bug).
    // If the write fails we roll the index back so memory never diverges.
    this.byId.set(next.id, next);
    try {
      await this.persistPaper(next, { refreshAttachedPdf: next.pdfPath !== current.pdfPath });
    } catch (err) {
      this.byId.set(current.id, current);
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

  async updateReadingProgress(_id: string, _progress: number): Promise<void> {
    // Sprint 2 deferred — `Paper` has no progress field yet, the sidebar will
    // derive progress from `dateRead` and `status` once we wire that up.
    throw this.notImplemented('updateReadingProgress');
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
      const existing = await this.plugin.app.vault.read(file);
      const { body } = splitFrontmatter(existing);
      const section = renderQuoteSection(storedQuote);
      const heading = body.includes('## Quotes') ? '' : '## Quotes\n\n';
      const nextBody = `${body.trimEnd()}\n\n${heading}${section}`;
      await this.selfAwareModify(file, joinFrontmatter(toFrontmatter(paper), nextBody));
    }

    return storedQuote;
  }

  /**
   * Extract quote candidates from the paper's PDF and append them to the paper.
   *
   * **Deferred per D27** — `pdfjs-dist` v4 cannot run inside Obsidian's Electron
   * main process (it calls `process.getBuiltinModule()` at module load and
   * requires Web Workers at parse time). PDF import is link-only in this build;
   * this method deliberately throws so any accidental call surfaces loudly
   * instead of silently producing empty quotes. Use `QuoteCaptureModal` /
   * `addQuote` for manual quote capture until text extraction is reintroduced.
   */
  async extractQuotesFromPdf(_paperId: string): Promise<Quote[]> {
    throw new Error(
      'PaperService.extractQuotesFromPdf: PDF text extraction is not available (D27). ' +
        'Use QuoteCaptureModal or addQuote for manual quote capture instead. ' +
        'See plans/plan.md D27 for the deferred extraction roadmap.',
    );
  }

  // -------------------------------------------------------------------------
  // Relationships (Sprint 3 target)
  // -------------------------------------------------------------------------

  async addCitation(_from: string, _to: string): Promise<void> {
    throw this.notImplemented('addCitation');
  }

  async addRelated(_paperId: string, _relatedId: string): Promise<void> {
    throw this.notImplemented('addRelated');
  }

  /**
   * Scan the paper's PDF text for inline citation patterns like "(Author, Year)"
   * or "[Author Year]". Returns a deduplicated list of unique citations found.
   *
   * **Deferred per D27** — PDF text extraction is not available in this build.
   * This method throws so any accidental call surfaces loudly. Once D27's
   * extraction roadmap ships (e.g., shimmed into the renderer), this method
   * will be re-introduced alongside the matcher logic below.
   */
  async findCitationsInPdf(_paperId: string): Promise<string[]> {
    throw new Error(
      'PaperService.findCitationsInPdf: PDF text extraction is not available (D27). ' +
        'Citation scanning is deferred until pdfjs-dist can run inside Obsidian. ' +
        'See plans/plan.md D27 for the deferred extraction roadmap.',
    );
  }

  // -------------------------------------------------------------------------
  // File operations + bulk
  // -------------------------------------------------------------------------

  async getNoteContent(paperIdOrCitekey: string): Promise<string> {
    const paper =
      this.byId.get(paperIdOrCitekey) ??
      this.byId.get(this.citekeyToId.get(paperIdOrCitekey.toLowerCase()) ?? '');
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
      this.dropByPath(file.path);
      return null;
    }

    const previous = this.byId.get(next.id);
    if (previous && papersEqual(previous, next)) {
      return previous;
    }

    this.byId.set(next.id, next);
    if (previous?.citekey.toLowerCase() !== next.citekey.toLowerCase()) {
      if (previous) this.citekeyToId.delete(previous.citekey.toLowerCase());
      this.citekeyToId.set(next.citekey.toLowerCase(), next.id);
    }
    this.plugin.eventBus.emit('paperUpdated', next);
    return next;
  }

  /**
   * Drop a paper from the in-memory index by its `paper.id`. Public so
   * `vault.on('rename'|'delete')` handlers in `plugin.ts` can call it.
   */
  dropFromIndex(paperId: string): void {
    const paper = this.byId.get(paperId);
    if (!paper) return;
    this.byId.delete(paperId);
    this.citekeyToId.delete(paper.citekey.toLowerCase());
  }

  /**
   * Handle a vault `rename` or `delete` for a file. Drops the paper that was
   * at `oldPath` and (for renames into a project folder) tries to sync the
   * new path as if it had just appeared. Safe to call repeatedly.
   */
  async pathChanged(opts: { oldPath?: string; newPath?: string }): Promise<void> {
    if (opts.oldPath) {
      this.dropPaperAtPath(opts.oldPath);
    }
    if (opts.newPath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(opts.newPath);
      if (file instanceof TFile) {
        await this.syncFromFile(file);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2.8.D — `dateModified` re-stamp on every body edit
  // -------------------------------------------------------------------------

  /**
   * Find an in-memory paper by its on-disk file path. Linear scan, but the
   * index never holds more than a few hundred papers in a typical vault so
   * O(n) is fine and avoids needing a back-index by path. The lookup uses
   * the same canonical `<papersFolder>/<citekey>.md` shape `persistPaper`
   * writes, so the two never diverge.
   */
  private findByPath(filePath: string): Paper | undefined {
    const wanted = filePath.toLowerCase();
    for (const paper of this.byId.values()) {
      const folder = papersFolderOf(paper);
      if (!folder) continue;
      if (normalizePath(`${folder}/${paper.citekey}.md`).toLowerCase() === wanted) {
        return paper;
      }
    }
    return undefined;
  }

  /**
   * Vault `modify` handler that re-stamps `paper.dateModified` whenever a
   * paper note is edited externally. `syncFromFile` only catches frontmatter-
   * level changes; this fills the gap so body edits (footnote tweaks,
   * section rewrites, quote fixups) also surface a fresh `dateModified`.
   *
   * Echoes of our OWN writes are already filtered out upstream: the vault
   * `modify` handler in `plugin.ts` consumes a `selfWritePaths` marker
   * (armed by `writeTracked`) before calling this. The 2-second guard below
   * remains as a second line of defense for any path that slipped through
   * without a marker.
   */
  async onPaperFileModified(file: TFile): Promise<void> {
    const paper = this.findByPath(file.path);
    if (!paper) return;
    const next = Date.now();
    if (next - paper.dateModified < 2_000) return;
    const updated: Paper = { ...paper, dateModified: next };
    this.byId.set(updated.id, updated);
    await this.persistPaper(updated);
    this.plugin.eventBus.emit('paperUpdated', updated);
  }

  /**
   * Sidebar-overhaul fix B (2026-09-28): single choke point for every write
   * this service performs on an existing paper file. Arms the echo marker
   * just before the write and disarms it on failure, so the vault `modify`
   * event the write triggers is recognized as ours in `plugin.ts` exactly
   * once — success or not.
   */
  private async selfAwareModify(file: TFile, data: string): Promise<void> {
    this.selfWritePaths.add(file.path);
    try {
      await this.plugin.app.vault.modify(file, data);
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
    if (!this.selfWritePaths.delete(path)) return false;
    return true;
  }

  /**
   * Iterate the in-memory index, drop any paper whose resolved file matches
   * the supplied absolute path. Bails after the first match because citekeys
   * are unique within a project.
   */
  private dropPaperAtPath(filePath: string): void {
    for (const paper of [...this.byId.values()]) {
      const file = this.findPaperFile(paper);
      if (file?.path === filePath) {
        this.dropFromIndex(paper.id);
        this.plugin.eventBus.emit('paperRemoved', { paperId: paper.id });
        return;
      }
    }
  }

  /**
   * Remove a paper from the index when its on-disk file disappeared from the
   * vault (rename-away or trash). Looks up by the file basename against the
   * citekey reverse-index.
   */
  private dropByPath(filePath: string): void {
    const stem = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    if (!stem) return;
    const cachedId = this.citekeyToId.get(stem.toLowerCase());
    if (cachedId) this.dropFromIndex(cachedId);
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

  async exportBibtex(_paperIds: string[]): Promise<string> {
    throw this.notImplemented('exportBibtex');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireById(id: string): Paper {
    const paper = this.byId.get(id);
    if (!paper) {
      new Notice(`ResearchVault: no paper with id "${id}".`);
      throw new Error(`Paper not found: ${id}`);
    }
    return paper;
  }

  /** Read a single paper markdown file and rebuild a `Paper` from its frontmatter. */
  private async readPaperFile(file: TFile, projectId: string): Promise<Paper | null> {
    try {
      const raw = await this.plugin.app.vault.read(file);
      const { frontmatter } = splitFrontmatter<Partial<PaperFrontmatter>>(raw);
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
   * Pick a unique citekey for an incoming paper. If the user supplied one
   * we honour it as long as it doesn't collide; otherwise we derive one
   * from author/year/title and append `-2`, `-3`, … on collisions.
   */
  private resolveCitekey(input: PaperManualInput, papersFolder: string): string {
    const folder = this.plugin.app.vault.getAbstractFileByPath(papersFolder);
    if (!(folder instanceof TFolder)) {
      throw new Error('PaperService.createManual: papers folder disappeared mid-flight.');
    }

    const isTaken = (candidate: string): boolean => {
      const path = normalizePath(`${papersFolder}/${candidate}.md`);
      if (this.plugin.app.vault.getAbstractFileByPath(path)) return true;
      return this.citekeyToId.has(candidate.toLowerCase());
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
    const existing = await this.plugin.app.vault.read(file);
    const { body } = splitFrontmatter(existing);
    await this.selfAwareModify(file, joinFrontmatter(toFrontmatter(paper), body));
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
    const existing = await this.plugin.app.vault.read(file);
    const { body } = splitFrontmatter(existing);
    const nextBody = upsertAttachedPdfSection(body, paper.pdfPath);
    await this.selfAwareModify(file, joinFrontmatter(toFrontmatter(paper), nextBody));
  }

  private notImplemented(method: string): Error {
    return new Error(
      `PaperService.${method} is not implemented yet (deferred from Sprint 2 lean — see plans/plan.md §7).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trim a single author last-name string. Empty/whitespace-only strings become ''. */
function normaliseAuthorName(name: string): string {
  return (name ?? '').trim();
}

/**
 * 2.8.E — Read the legacy `authors: Author[]` frontmatter shape back into
 * the new `string[]` + `authorFirstNames?` shape. Used only by
 * `frontmatterToPaper` when an existing note predates 2.8.E.
 */
function authorsFromLegacy(rows: unknown): { lastNames: string[]; firstNames: string[] } {
  if (!Array.isArray(rows)) return { lastNames: [], firstNames: [] };
  const lastNames: string[] = [];
  const firstNames: string[] = [];
  for (const row of rows) {
    if (row && typeof row === 'object' && 'lastName' in row) {
      const r = row as { firstName?: string; lastName?: string };
      lastNames.push(normaliseAuthorName(String(r.lastName ?? '')));
      firstNames.push(normaliseAuthorName(String(r.firstName ?? '')));
    } else if (typeof row === 'string') {
      lastNames.push(normaliseAuthorName(row));
      firstNames.push('');
    }
  }
  return { lastNames, firstNames };
}

/** Fetch the on-disk papers folder from a paper's `customFields`. Returns `undefined` if missing or wrong shape. */
function papersFolderOf(paper: Paper): string | undefined {
  const folder = paper.customFields['papersFolder'];
  return typeof folder === 'string' && folder.length > 0 ? folder : undefined;
}

function trimOrUndefined(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function toFrontmatter(paper: Paper): PaperFrontmatter {
  // Dates: epoch ms on the in-memory `Paper`, ISO date+time string on disk (D24).
  return {
    id: paper.id,
    citekey: paper.citekey,
    title: paper.title,
    authors: paper.authors,
    authorFirstNames: paper.authorFirstNames,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    url: paper.url,
    oaUrl: paper.oaUrl,
    pdfPath: paper.pdfPath,
    abstract: paper.abstract,
    keywords: paper.keywords,
    status: paper.status,
    priority: paper.priority,
    rating: paper.rating,
    dateAdded: toLocalDateTime(paper.dateAdded),
    dateModified: toLocalDateTime(paper.dateModified),
    dateRead: paper.dateRead ? toLocalDateTime(paper.dateRead) : undefined,
    source: paper.source,
    importedFrom: paper.importedFrom,
    customFields: paper.customFields,
  };
}

function frontmatterToPaper(
  fm: Partial<PaperFrontmatter>,
  projectId: string,
  file: TFile,
): Paper {
  const citekey = String(fm.citekey ?? file.basename);
  const id = String(fm.id ?? citekey);
  const papersFolder = file.parent?.path ?? '';
  // Parse an optional ISO/epoch date. Returns `undefined` when the source is null/empty/unparseable,
  // never pinning `dateRead` to a 1970 fallback that the sidebar would render as a real timestamp.
  const parseOptionalDate = (raw: unknown): number | undefined => {
    if (raw == null) return undefined;
    const parsed = fromFrontmatterDate(raw, Number.NaN);
    return Number.isNaN(parsed) ? undefined : parsed;
  };
  // Dates: accept either new ISO string OR legacy epoch ms already on disk (D24).
  return {
    id,
    citekey,
    title: String(fm.title ?? file.basename),
    authors: ((): string[] => {
      // 2.8.E — three possible shapes on disk:
      //   new shape: `authors: [Vaswani, Shazeer]` (string[])
      //   new with first names: same + parallel `authorFirstNames?: [Ashish, Noam]`
      //   legacy: `authors: [{firstName, lastName}, …]` (object[])
      if (!Array.isArray(fm.authors)) return [];
      const sample = fm.authors[0];
      if (sample && typeof sample === 'object' && 'lastName' in sample) {
        return authorsFromLegacy(fm.authors).lastNames;
      }
      return (fm.authors as unknown[]).map((s) => normaliseAuthorName(coerceFrontmatterScalar(s)));
    })(),
    authorFirstNames: ((): string[] | undefined => {
      // 2.8.E — only set when the parallel array actually existed on disk,
      // or when the legacy object form had populated firstName fields.
      if (Array.isArray(fm.authorFirstNames)) {
        const arr = (fm.authorFirstNames as unknown[]).map((s) => normaliseAuthorName(coerceFrontmatterScalar(s)));
        return arr.length === 0 ? undefined : arr;
      }
      if (Array.isArray(fm.authors) && fm.authors[0] && typeof fm.authors[0] === 'object') {
        const fromLegacy = authorsFromLegacy(fm.authors).firstNames;
        return fromLegacy.some((n) => n.length > 0) ? fromLegacy : undefined;
      }
      return undefined;
    })(),
    year: typeof fm.year === 'number' ? fm.year : new Date(file.stat.ctime).getFullYear(),
    venue: fm.venue,
    doi: fm.doi,
    url: fm.url,
    // 4.1.A: round-trip oaUrl if it was ever stamped; absent otherwise.
    oaUrl: fm.oaUrl,
    pdfPath: fm.pdfPath,
    abstract: fm.abstract,
    keywords: Array.isArray(fm.keywords) ? (fm.keywords) : [],
    status: ((): ReadingStatus => {
      // Read the raw value unwidened: `fm.status` is typed as the NEW union,
      // but files written before the 2026-09-30 label redesign may still
      // carry legacy `queued` / `summarized` on disk.
      const candidate = fm.status as unknown as string | undefined;
      if (candidate && READING_STATUSES.includes(candidate as ReadingStatus)) {
        return candidate as ReadingStatus;
      }
      // 2026-09-30 label redesign (§7.5 of plans/sidebar-overhaul-research.md):
      // legacy values coerce at read time; the file rewrites itself with the
      // new value on the next persist. `queued` → `unread` (same posture),
      // `summarized` → `annotating` (synthesis still pending → stays
      // in-flight so staleness behaves correctly).
      if (candidate === 'queued') return 'unread';
      if (candidate === 'summarized') return 'annotating';
      return 'unread';
    })(),
    priority: ((): Paper['priority'] => {
      const p = fm.priority as unknown as string | undefined;
      if (p === 'low' || p === 'normal' || p === 'high') return p;
      // Legacy `medium` maps to the new default tier; legacy `critical`
      // collapses into `high` (urgency is now time-boxed by lifecycle).
      return 'normal';
    })(),
    rating: typeof fm.rating === 'number' ? fm.rating : undefined,
    dateAdded: fromFrontmatterDate(fm.dateAdded, file.stat.ctime),
    dateModified: fromFrontmatterDate(fm.dateModified, file.stat.mtime),
    // Only stamp dateRead when the frontmatter actually had a parseable value; an unparseable Read date
    // stays absent (interpreted as "not yet read") rather than pinning to a 1970 fallback.
    dateRead: parseOptionalDate(fm.dateRead),
    quotes: [],
    claims: [],
    citations: [],
    citedBy: [],
    related: [],
    customFields: {
      ...(fm.customFields ?? {}),
      projectId,
      papersFolder,
    },
    source: fm.source ?? 'manual',
    importedFrom: fm.importedFrom,
  };
}

function templateDataFor(paper: Paper): TemplateData {
  // 2.8.E — `authors` template placeholder is a comma-joined list of
  // "<first> <last>" strings when first names exist, else last names only.
  const joinedAuthors = paper.authorFirstNames
    ? paper.authors
        .map((last, i) => `${paper.authorFirstNames?.[i] ?? ''} ${last}`.trim())
        .join(', ')
    : paper.authors.join(', ');
  return {
    citekey: paper.citekey,
    title: paper.title,
    authors: joinedAuthors,
    year: paper.year,
    venue: paper.venue ?? '',
    doi: paper.doi ?? '',
    abstract: paper.abstract ?? '',
    keywords: paper.keywords.join(', '),
    status: paper.status,
    priority: paper.priority,
    dateAdded: isoDate(paper.dateAdded),
  };
}

function isoDate(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString();
}

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
/**
 * 2.8.E frontmatter reader helper. YAML scalars can hand us strings,
 * numbers, booleans, or null. Anything else (rolls up as objects/arrays
 * after YAML's incomplete typing) we coerce to '' so the YAML stays
 * round-trippable without surprising object-stringification defaults.
 */
function coerceFrontmatterScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

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

/**
 * Replace (or insert) the `## Attached PDF` section in `body` so it links to
 * `pdfPath`. If `pdfPath` is `undefined`, the section is removed (preserving
 * any content that followed it). Matches the heading at the start of a line
 * so headings in quotes/code blocks are not accidentally rewritten.
 */
function upsertAttachedPdfSection(body: string, pdfPath: string | undefined): string {
  const lines = body.split('\n');
  // Locate the existing `## Attached PDF` heading (case-insensitive, must be at line start).
  const headingRe = /^##\s+Attached PDF\s*$/i;
  const startIdx = lines.findIndex((l) => headingRe.test(l));
  if (startIdx === -1) {
    if (!pdfPath) return body; // Nothing to insert, nothing to remove.
    const link = `[[${pdfPath}|View PDF]]`;
    const append = `## Attached PDF\n\n${link}`;
    return body.trimEnd().length === 0 ? `${append}\n` : `${body.trimEnd()}\n\n${append}\n`;
  }
  if (!pdfPath) {
    // Remove the heading + its content up to the next `##` heading or end of body.
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i] ?? '')) { endIdx = i; break; }
    }
    const before = lines.slice(0, startIdx).join('\n').replace(/\s+$/u, '');
    const after = lines.slice(endIdx).join('\n').replace(/^\s+/u, '');
    return before.length === 0 && after.length === 0 ? '' : `${before}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
  }
  // Replace the section content with a single wikilink line.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? '')) { endIdx = i; break; }
  }
  const before = lines.slice(0, startIdx).join('\n').replace(/\s+$/u, '');
  const after = lines.slice(endIdx).join('\n').replace(/^\s+/u, '');
  const link = `[[${pdfPath}|View PDF]]`;
  const middle = `## Attached PDF\n\n${link}`;
  const parts = [before, middle, after].filter((p) => p.length > 0);
  return `${parts.join('\n\n')}\n`.replace(/\n{3,}/g, '\n\n');
}

function renderQuoteSection(quote: Quote): string {
  const head = `> ${quote.text.replace(/\n/g, '\n> ')}`;
  const meta: string[] = [];
  if (quote.page) meta.push(`p. ${quote.page}`);
  if (quote.section) meta.push(quote.section);
  const metaLine = meta.length > 0 ? `\n-- ${meta.join(' \u00B7 ')}` : '';
  const tagsLine = quote.tags.length > 0 ? `\n#tags: ${quote.tags.join(' ')}\n` : '\n';
  const sourceLine = quote.source ? `\n-- source: ${quote.source}\n` : '\n';
  return `${head}${metaLine}${tagsLine}${sourceLine}`;
}

/** Fallback template if both settings.templates.paper and project settings are empty. */
const DEFAULT_PAPER_TEMPLATE = `# {{title}}

> Authors: {{authors}} ({{year}}). {{venue}}.

## Summary

## Key points

## Quotes

## Notes
`;
