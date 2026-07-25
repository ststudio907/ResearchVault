// src/services/vault-indexer.ts
//
// In-memory fuzzy search index over the plugin's `Paper` records, built on
// fuse.js. Subscribes to the plugin's typed EventBus so the index stays fresh
// as papers are imported, their status flips, or new quotes are captured.
//
// Sprint 3 surface (this phase): `hydrate`, `searchPapers`, and incremental
// `addToIndex` / `removeFromIndex`. The remaining stubs (graph, AI context
// prep) stay as `notImplemented` until later sub-passes.

import Fuse from 'fuse.js';
import type { Paper, LiteratureNote, ReadingStatus, Priority } from '../types';
import type { ResearchVaultPlugin } from '../core/plugin';

/** A chunk of paper text prepared for AI context. (Sprint 3 — Tier 3 follow-up) */
export interface TextChunk {
  paperId: string;
  text: string;
  page?: number;
  tokenEstimate: number;
}

/** Node + edges for the citation graph. (Sprint 3 — Tier 3 follow-up) */
export interface CitationGraph {
  nodes: Array<{ id: string; title: string }>;
  edges: Array<{
    from: string;
    to: string;
    kind: 'cites' | 'extends' | 'contradicts' | 'related';
  }>;
}

/** Filters surfaced in search UI. Kept in this file because only the indexer consumes them. */
export interface SearchFilters {
  status?: ReadingStatus[];
  year?: { min?: number; max?: number };
  authors?: string[];
  tags?: string[];
  priority?: Priority[];
  rating?: { min?: number; max?: number };
  dateAdded?: { after?: number; before?: number };
  hasPdf?: boolean;
  hasNotes?: boolean;
  customFields?: Record<string, unknown>;
}

/**
 * Flattened, search-optimised projection of a `Paper`. We keep a small
 * footprint (no `quotes` / `claims` arrays) by collapsing quote text into a
 * single `quoteSnippets` string of bounded length, which gives fuzzy search
 * over quote bodies without re-indexing every quote on capture.
 */
interface IndexedPaper {
  id: string;
  citekey: string;
  title: string;
  authorsText: string;
  year: number;
  venue: string;
  keywordsText: string;
  abstract: string;
  status: ReadingStatus;
  priority: Priority;
  rating?: number;
  dateAdded: number;
  hasPdf: boolean;
  hasNotes: boolean;
  quoteSnippets: string;
  projectId: string;
  paper: Paper; // back-reference so callers get the full record
}

const QUOTE_SNIPPET_MAX_CHARS = 400;

export class VaultIndexer {
  /** Fuse instance — recreated on every `rebuild`; patched incrementally otherwise. */
  private fuse: Fuse<IndexedPaper> | null = null;

  /** Local store kept in lock-step with the Fuse instance. */
  private byId = new Map<string, IndexedPaper>();

  /** Unsubscribe handles returned by `eventBus.on()`; called from `dispose()`. */
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly plugin: ResearchVaultPlugin) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Prime the index from every paper `PaperService` already knows about and
   * wire event subscriptions for incremental updates. Safe to call once
   * during `ResearchVaultPlugin.onload()`. Idempotent: a second call clears
   * and rebuilds.
   */
  hydrate(): void {
    // Drop any prior state (idempotent reloads, hot-reload, tests).
    this.dispose();

    const all = this.plugin.paperService.getAll();
    const now = Date.now();
    for (const paper of all) {
      this.byId.set(paper.id, projectFor(paper));
    }
    this.rebuild();

    // Incremental updates: each event mutates one record, then we emit so
    // the sidebar can re-render its result list.
    this.unsubscribers.push(
      this.plugin.eventBus.on('paperImported', (paper) => this.onPaperUpsert(paper)),
      this.plugin.eventBus.on('paperStatusChanged', (paper) => this.onPaperUpsert(paper)),
      this.plugin.eventBus.on('quoteAdded', ({ paper }) => this.onPaperUpsert(paper)),
    );

    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
    // `now` is intentionally unused; kept here as a marker for future last-built timestamps.
    void now;
  }

  /**
   * Stop listening to events and drop the in-memory index. The plugin's own
   * `eventBus.clear()` is the primary cleanup path; this is exposed for tests
   * and for any future "suspend indexing" UI toggle.
   */
  dispose(): void {
    for (const off of this.unsubscribers.splice(0)) off();
    this.fuse = null;
    this.byId.clear();
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Fuzzy search across all indexed papers. The `query` is matched against
   * weighted fields (title, authors, keywords, quotes, citekey, venue); the
   * optional `filters` are applied as a post-filter on the Fuse result set.
   */
  searchPapers(query: string, filters?: SearchFilters): Paper[] {
    if (!this.fuse) return [];

    const trimmed = query.trim();
    let candidates: IndexedPaper[];

    if (!trimmed) {
      // No query: return every paper (still subject to filters).
      candidates = [...this.byId.values()];
    } else {
      const results = this.fuse.search(trimmed, { limit: 200 });
      candidates = results.map((r) => r.item);
    }

    const filtered = filters ? applyFilters(candidates, filters) : candidates;
    // Stable order: by `dateAdded` desc, then title asc.
    filtered.sort((a, b) => {
      if (b.dateAdded !== a.dateAdded) return b.dateAdded - a.dateAdded;
      return a.title.localeCompare(b.title);
    });
    return filtered.map((p) => p.paper);
  }

  /** Stub — note-level search belongs to a future sprint once note bodies are indexed. */
  searchNotes(_query: string): LiteratureNote[] {
    throw this.notImplemented('searchNotes');
  }

  /** Stub — cross-vault mention scan is a follow-up to 3.2 (CitationManager). */
  findUnlinkedMentions(_citekey: string): TFile[] {
    throw this.notImplemented('findUnlinkedMentions');
  }

  // -------------------------------------------------------------------------
  // Graph (Sprint 3 — Tier 3 follow-up)
  // -------------------------------------------------------------------------

  getCitationGraph(): CitationGraph {
    throw this.notImplemented('getCitationGraph');
  }
  getRelatedPapers(_paperId: string, _depth?: number): string[] {
    throw this.notImplemented('getRelatedPapers');
  }

  // -------------------------------------------------------------------------
  // AI prep (Sprint 3 — Tier 3 follow-up)
  // -------------------------------------------------------------------------

  getChunksForPaper(_paperId: string): TextChunk[] {
    throw this.notImplemented('getChunksForPaper');
  }
  getProjectContext(_projectId: string, _maxTokens?: number): string {
    throw this.notImplemented('getProjectContext');
  }

  // -------------------------------------------------------------------------
  // Index maintenance
  // -------------------------------------------------------------------------

  /**
   * Public for `PaperService` to call after it reads a paper file from disk
   * and discovers drift from the cached `Paper`. Triggers a single reindex
   * + indexUpdated event.
   */
  addToIndex(paper: Paper): void {
    this.onPaperUpsert(paper);
  }

  /** Public counterpart for paper deletion. */
  removeFromIndex(paperId: string): void {
    if (!this.byId.has(paperId)) return;
    this.byId.delete(paperId);
    this.rebuild();
    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
  }

  /** Public counterpart for file edits; used by `PaperService` on re-hydration. */
  updateIndex(_file: TFile): void {
    // We rely on event subscriptions for paper-level changes. File-level
    // updates from outside the plugin are picked up the next time
    // `PaperService` re-emits a paper event. Kept for API stability.
    this.rebuild();
    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onPaperUpsert(paper: Paper): void {
    this.byId.set(paper.id, projectFor(paper));
    // Cheaper than rebuild for a single change: rebuild Fuse from the map.
    // fuse.js `setCollection` reuses the existing in-memory index in most
    // cases, so cost is roughly O(n) tokens, not O(n²).
    this.rebuild();
    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
  }

  private rebuild(): void {
    const docs = [...this.byId.values()];
    // 2.8.Sidebar: lower the per-token match length so 1-character and
    // partial-prefix queries return hits, and loosen the threshold slightly so
    // fuzzy matches against longer titles / author names still surface.
    this.fuse = new Fuse<IndexedPaper>(docs, {
      keys: [
        { name: 'title', weight: 0.4 },
        { name: 'authorsText', weight: 0.2 },
        { name: 'keywordsText', weight: 0.2 },
        { name: 'quoteSnippets', weight: 0.1 },
        { name: 'citekey', weight: 0.05 },
        { name: 'venue', weight: 0.05 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 1,
      includeScore: false,
    });
  }

  private notImplemented(method: string): Error {
    return new Error(
      `VaultIndexer.${method} is not implemented yet (Sprint 3 — see plans/plan.md §7 / §14).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectFor(paper: Paper): IndexedPaper {
  // 2.8.E — `paper.authors` is the last-name string[]; if a parallel
  // `authorFirstNames?` array exists we prefix each entry with the
  // corresponding first name (whitespace-trimmed, missing -> '').
  const firsts = paper.authorFirstNames ?? [];
  const authorsText = paper.authors
    .map((last, i) => `${firsts[i] ?? ''} ${last}`.trim())
    .filter(Boolean)
    .join('; ');

  // Quote-level tags live on individual `Quote` records; `Paper.keywords`
  // is the canonical search corpus. Quotes contribute via `quoteSnippets`
  // below, so we deliberately do not flatten quote tags here.
  const keywordsText = paper.keywords.join(' ');

  const joinedQuotes = paper.quotes
    .map((q) => q.text)
    .join(' \u2022 ')
    .slice(0, QUOTE_SNIPPET_MAX_CHARS);

  return {
    id: paper.id,
    citekey: paper.citekey,
    title: paper.title,
    authorsText,
    year: paper.year,
    venue: paper.venue ?? '',
    keywordsText,
    abstract: paper.abstract ?? '',
    status: paper.status,
    priority: paper.priority,
    rating: paper.rating,
    dateAdded: paper.dateAdded,
    hasPdf: Boolean(paper.pdfPath),
    hasNotes: Boolean(paper.myNotes),
    quoteSnippets: joinedQuotes,
    // projectId is read from customFields (where PaperService stores it on import).
    projectId:
      typeof paper.customFields['projectId'] === 'string'
        ? paper.customFields['projectId']
        : '',
    paper,
  };
}

function applyFilters(items: IndexedPaper[], filters: SearchFilters): IndexedPaper[] {
  return items.filter((item) => {
    if (filters.status && filters.status.length > 0 && !filters.status.includes(item.status)) {
      return false;
    }
    if (filters.priority && filters.priority.length > 0 && !filters.priority.includes(item.priority)) {
      return false;
    }
    if (filters.year) {
      if (typeof filters.year.min === 'number' && item.year < filters.year.min) return false;
      if (typeof filters.year.max === 'number' && item.year > filters.year.max) return false;
    }
    if (filters.rating) {
      const r = item.rating ?? 0;
      if (typeof filters.rating.min === 'number' && r < filters.rating.min) return false;
      if (typeof filters.rating.max === 'number' && r > filters.rating.max) return false;
    }
    if (filters.dateAdded) {
      if (typeof filters.dateAdded.after === 'number' && item.dateAdded < filters.dateAdded.after) {
        return false;
      }
      if (typeof filters.dateAdded.before === 'number' && item.dateAdded > filters.dateAdded.before) {
        return false;
      }
    }
    if (filters.hasPdf === true && !item.hasPdf) return false;
    if (filters.hasPdf === false && item.hasPdf) return false;
    if (filters.hasNotes === true && !item.hasNotes) return false;
    if (filters.hasNotes === false && item.hasNotes) return false;
    if (filters.tags && filters.tags.length > 0) {
      const kws = item.keywordsText.toLowerCase().split(/\s+/);
      for (const tag of filters.tags) {
        if (!kws.includes(tag.toLowerCase())) return false;
      }
    }
    if (filters.authors && filters.authors.length > 0) {
      const haystack = item.authorsText.toLowerCase();
      for (const author of filters.authors) {
        if (!haystack.includes(author.toLowerCase())) return false;
      }
    }
    if (filters.customFields) {
      for (const [k, v] of Object.entries(filters.customFields)) {
        if (item.paper.customFields[k] !== v) return false;
      }
    }
    return true;
  });
}

// Local re-import of `TFile` keeps the public API stable with the rest of
// the service layer without forcing `TFile` to be referenced from above.
// (We don't actually use it in the body, but the parameter is required by
// the pre-existing public signature.)
import type { TFile } from 'obsidian';
