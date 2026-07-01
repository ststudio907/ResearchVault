// src/services/paper-service.ts
//
// Sprint 2 — manual paper import, status transitions, quote capture.
// The remaining paper surface (DOI lookup, PDF text extraction, BibTeX
// import/export, literature-graph edges) deliberately still throws
// `notImplemented` so calls surface loudly while we keep the file lean —
// each of those is its own follow-up sub-task (see plans/plan.md §7).
//

import { Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type {
  Author,
  Paper,
  PaperSource,
  Quote,
  ReadingStatus,
} from '../types';
import { READING_STATUSES } from '../types';
import { generateUniqueCitekey, slugify } from '../utils/citekey';
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
  authors: Author[];
  year: number;
  venue?: string;
  doi?: string;
  url?: string;
  pdfPath?: string;
  abstract?: string;
  keywords: string[];
  status: ReadingStatus;
  priority: Paper['priority'];
  rating?: number;
  dateAdded: number;
  dateModified: number;
  dateRead?: number;
  source: PaperSource;
  importedFrom?: string;
  customFields: Record<string, unknown>;
};

/** Input shape accepted by `PaperService.createManual`. */
export interface PaperManualInput {
  title: string;
  authors: Author[];
  year: number;
  venue?: string;
  doi?: string;
  url?: string;
  pdfPath?: string;
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
   * citekey, ensures the project's `papers/` folder exists, writes the
   * markdown file with rendered body, and emits `paperImported`.
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

    const citekey = this.resolveCitekey(input, papersFolder);
    const filePath = normalizePath(`${papersFolder}/${citekey}.md`);

    if (this.plugin.app.vault.getAbstractFileByPath(filePath)) {
      throw new Error(
        `PaperService.createManual: a paper already exists at "${filePath}".`,
      );
    }

    const now = Date.now();
    const paper: Paper = {
      id: citekey,
      citekey,
      title: input.title.trim(),
      authors: input.authors.map(normaliseAuthor),
      year: input.year,
      venue: trimOrUndefined(input.venue),
      doi: trimOrUndefined(input.doi),
      url: trimOrUndefined(input.url),
      pdfPath: trimOrUndefined(input.pdfPath),
      abstract: trimOrUndefined(input.abstract),
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      status: input.status ?? 'queued',
      priority: input.priority ?? 'medium',
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
      source: 'manual',
    };

    const body = renderTemplate(this.paperTemplate(project), templateDataFor(paper));
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

  async createFromPdf(_pdfPath: string, _projectId: string): Promise<Paper> {
    throw this.notImplemented('createFromPdf');
  }

  async importBibtex(_bibtex: string, _projectId: string): Promise<Paper[]> {
    throw this.notImplemented('importBibtex');
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  /** Update arbitrary fields. Persists via frontmatter; body is left alone. */
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
    await this.persistPaper(next);
    this.byId.set(next.id, next);
    this.plugin.eventBus.emit('paperImported', next);
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
    };
    paper.quotes.push(storedQuote);

    const file = this.findPaperFile(paper);
    if (file) {
      const existing = await this.plugin.app.vault.read(file);
      const { body } = splitFrontmatter(existing);
      const section = renderQuoteSection(storedQuote);
      const heading = body.includes('## Quotes') ? '' : '## Quotes\n\n';
      const nextBody = `${body.trimEnd()}\n\n${heading}${section}`;
      await this.plugin.app.vault.modify(file, joinFrontmatter(toFrontmatter(paper), nextBody));
    }

    return storedQuote;
  }

  async extractQuotesFromPdf(_paperId: string): Promise<Quote[]> {
    throw this.notImplemented('extractQuotesFromPdf');
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

  async findCitationsInPdf(_paperId: string): Promise<string[]> {
    throw this.notImplemented('findCitationsInPdf');
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
    this.byId.delete(paper.id);
    this.citekeyToId.delete(paper.citekey.toLowerCase());
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

    const lastName = input.authors[0]?.lastName ?? 'anon';
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

  /** Write the given paper's frontmatter to disk; body is untouched. */
  private async persistPaper(paper: Paper): Promise<void> {
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
    await this.plugin.app.vault.modify(file, joinFrontmatter(toFrontmatter(paper), body));
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

function normaliseAuthor(a: Author): Author {
  return {
    firstName: a.firstName?.trim() ?? '',
    lastName: a.lastName?.trim() ?? '',
    middleName: trimOrUndefined(a.middleName),
    affiliation: trimOrUndefined(a.affiliation),
    orcid: trimOrUndefined(a.orcid),
  };
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
  return {
    id: paper.id,
    citekey: paper.citekey,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    doi: paper.doi,
    url: paper.url,
    pdfPath: paper.pdfPath,
    abstract: paper.abstract,
    keywords: paper.keywords,
    status: paper.status,
    priority: paper.priority,
    rating: paper.rating,
    dateAdded: paper.dateAdded,
    dateModified: paper.dateModified,
    dateRead: paper.dateRead,
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
  return {
    id,
    citekey,
    title: String(fm.title ?? file.basename),
    authors: Array.isArray(fm.authors) ? (fm.authors) : [],
    year: typeof fm.year === 'number' ? fm.year : new Date(file.stat.ctime).getFullYear(),
    venue: fm.venue,
    doi: fm.doi,
    url: fm.url,
    pdfPath: fm.pdfPath,
    abstract: fm.abstract,
    keywords: Array.isArray(fm.keywords) ? (fm.keywords) : [],
    status: ((): ReadingStatus => {
      const candidate = fm.status;
      if (candidate && READING_STATUSES.includes(candidate)) {
        return candidate;
      }
      return 'queued';
    })(),
    priority: ((): Paper['priority'] => {
      const p = fm.priority;
      if (p === 'low' || p === 'medium' || p === 'high' || p === 'critical') return p;
      return 'medium';
    })(),
    rating: typeof fm.rating === 'number' ? fm.rating : undefined,
    dateAdded: typeof fm.dateAdded === 'number' ? fm.dateAdded : file.stat.ctime,
    dateModified: typeof fm.dateModified === 'number' ? fm.dateModified : file.stat.mtime,
    dateRead: typeof fm.dateRead === 'number' ? fm.dateRead : undefined,
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
  return {
    citekey: paper.citekey,
    title: paper.title,
    authors: paper.authors.map((a) => a.lastName).join(', '),
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

function renderQuoteSection(quote: Quote): string {
  const head = `> ${quote.text.replace(/\n/g, '\n> ')}`;
  const meta: string[] = [];
  if (quote.page) meta.push(`p. ${quote.page}`);
  if (quote.section) meta.push(quote.section);
  const metaLine = meta.length > 0 ? `\n-- ${meta.join(' \u00B7 ')}` : '';
  const tagsLine = quote.tags.length > 0 ? `\n#tags: ${quote.tags.join(' ')}\n` : '\n';
  return `${head}${metaLine}${tagsLine}`;
}

/** Fallback template if both settings.templates.paper and project settings are empty. */
const DEFAULT_PAPER_TEMPLATE = `# {{title}}

> Authors: {{authors}} ({{year}}). {{venue}}.

## Summary

## Key points

## Quotes

## Notes
`;
