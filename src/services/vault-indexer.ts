// src/services/vault-indexer.ts
//
// In-memory fuzzy search over the plugin's `Paper` records, using Obsidian's
// native `prepareFuzzySearch` (D33, 2026-10 — replaces fuse.js, which was
// 26.4 KB of the bundle for behaviour the host app already ships). The
// index itself is a plain Map; search applies per-field weights at query
// time. Subscribes to the plugin's typed EventBus so the store stays fresh
// as papers are imported, edited, or removed.
//
// Sprint 3 surface (this phase): `hydrate`, `searchPapers`, and incremental
// `addToIndex` / `removeFromIndex`. The remaining stubs (graph, AI context
// prep) stay as `notImplemented` until later sub-passes.

import { prepareFuzzySearch } from 'obsidian';
import type { SearchResult } from 'obsidian';
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
  /** Local store; search is computed per query over this map. */
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
    for (const paper of all) {
      this.byId.set(paper.id, projectFor(paper));
    }

    // Incremental updates: each event mutates one record, then we emit so
    // the sidebar can re-render its result list.
    // Phase 1 cleanup bug #1 follow-up: `paperUpdated` and `paperRemoved`
    // were previously ignored, so the index went stale on any edit path
    // that did not pass through `paperStatusChanged` (e.g. live sync after
    // the user edits the note body, or deleting/renaming a note).
    this.unsubscribers.push(
      this.plugin.eventBus.on('paperImported', (paper) => this.onPaperUpsert(paper)),
      this.plugin.eventBus.on('paperUpdated', (paper) => this.onPaperUpsert(paper)),
      this.plugin.eventBus.on('paperStatusChanged', (paper) => this.onPaperUpsert(paper)),
      this.plugin.eventBus.on('quoteAdded', ({ paper }) => this.onPaperUpsert(paper)),
      this.plugin.eventBus.on('paperRemoved', ({ paperId }) => this.removeFromIndex(paperId)),
    );

    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
  }

  /**
   * Stop listening to events and drop the in-memory index. The plugin's own
   * `eventBus.clear()` is the primary cleanup path; this is exposed for tests
   * and for any future "suspend indexing" UI toggle.
   */
  dispose(): void {
    for (const off of this.unsubscribers.splice(0)) off();
    this.byId.clear();
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Fuzzy search across all indexed papers. The `query` is matched against
   * weighted fields (title, authors, keywords, quotes, citekey, venue) via
   * Obsidian's `prepareFuzzySearch`; the optional `filters` are applied as a
   * post-filter on the match set.
   */
  searchPapers(query: string, filters?: SearchFilters): Paper[] {
    const trimmed = query.trim();
    let candidates: Array<{ item: IndexedPaper; score: number }>;

    if (!trimmed) {
      // No query: return every paper (still subject to filters).
      candidates = [...this.byId.values()].map((item) => ({ item, score: 0 }));
    } else {
      const fuzzy = prepareFuzzySearch(trimmed);
      candidates = [];
      for (const item of this.byId.values()) {
        const score = fuzzyScore(fuzzy, item);
        if (score !== null) candidates.push({ item, score });
      }
      // Cap the fan-out like the old fuse.js `limit: 200`.
      if (candidates.length > 200) {
        candidates.sort((a, b) => b.score - a.score);
        candidates = candidates.slice(0, 200);
      }
    }

    // Stable order: match score desc (0 for the no-query path), then
    // `dateAdded` desc, then title asc.
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.item.dateAdded !== a.item.dateAdded) {
        return b.item.dateAdded - a.item.dateAdded;
      }
      return a.item.title.localeCompare(b.item.title);
    });

    let items = candidates.map((c) => c.item);
    if (filters) items = applyFilters(items, filters);
    return items.map((p) => p.paper);
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
    if (!this.byId.delete(paperId)) return;
    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
  }

  /** Public counterpart for file edits; used by `PaperService` on re-hydration. */
  updateIndex(_file: TFile): void {
    // We rely on event subscriptions for paper-level changes. File-level
    // updates from outside the plugin are picked up the next time
    // `PaperService` re-emits a paper event. Kept for API stability.
    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onPaperUpsert(paper: Paper): void {
    this.byId.set(paper.id, projectFor(paper));
    this.plugin.eventBus.emit('indexUpdated', { count: this.byId.size });
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

/**
 * Fields matched per query with their weights (D33 — mirrors the old fuse.js
 * key weights so search ranking stays familiar: title dominates, venue and
 * citekey nudge ties, quotes contribute least).
 */
const SEARCH_FIELDS: ReadonlyArray<{ weight: number; text: (p: IndexedPaper) => string }> = [
  { weight: 0.4, text: (p) => p.title },
  { weight: 0.2, text: (p) => p.authorsText },
  { weight: 0.2, text: (p) => p.keywordsText },
  { weight: 0.1, text: (p) => p.quoteSnippets },
  { weight: 0.05, text: (p) => p.citekey },
  { weight: 0.05, text: (p) => p.venue },
];

/**
 * Highest weighted match over `SEARCH_FIELDS`, or null when no field matches.
 * Obsidian's fuzzy score is <= 0 (closer to 0 = better), so multiplying by
 * the weight still orders strong title hits above weak quote hits.
 */
function fuzzyScore(
  fuzzy: (text: string) => SearchResult | null,
  item: IndexedPaper,
): number | null {
  let best: number | null = null;
  for (const field of SEARCH_FIELDS) {
    const match = fuzzy(field.text(item));
    if (!match) continue;
    const weighted = match.score * field.weight;
    if (best === null || weighted > best) best = weighted;
  }
  return best;
}

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
