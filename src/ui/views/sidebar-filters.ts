// src/ui/views/sidebar-filters.ts
//
// 2.9 — structured filter state for the sidebar. Chip semantics (locked in
// the §14 2.9 spec): within a category chips OR together, across
// categories the categories AND together, empty selection = no filter on
// that category. Free-text search ANDs with chip filters (handled by the
// view's existing Fuse path).
//
// Pure module — no DOM, no Obsidian imports — so the filter semantics are
// trivially testable in 5.x vitest fixtures.

import type { Paper, Priority, ReadingStatus } from '../../types';

export interface SidebarFilterState {
  status: ReadingStatus[];
  priority: Priority[];
  year?: { from?: number; to?: number };
  hasPdf?: boolean;
  hasNotes?: boolean;
  /** Exact author last-name filter (from the typeahead picker). */
  authorQuery?: string;
}

export function defaultFilter(): SidebarFilterState {
  return { status: [], priority: [] };
}

/** Number of active filter categories (the header "Filters: N" badge). */
export function activeFilterCount(state: SidebarFilterState): number {
  let n = 0;
  if (state.status.length > 0) n++;
  if (state.priority.length > 0) n++;
  if (state.year && (state.year.from !== undefined || state.year.to !== undefined)) n++;
  if (state.hasPdf === true) n++;
  if (state.hasNotes === true) n++;
  if (state.authorQuery && state.authorQuery.trim()) n++;
  return n;
}

export function isDefaultFilter(state: SidebarFilterState): boolean {
  return activeFilterCount(state) === 0;
}

/** Apply the filter state to a paper list. Pure. */
export function applySidebarFilters(papers: Paper[], state: SidebarFilterState): Paper[] {
  return papers.filter((p) => {
    // Within a category: OR. Across categories: AND. Empty = no filter.
    if (state.status.length > 0 && !state.status.includes(p.status)) return false;
    if (state.priority.length > 0 && !state.priority.includes(p.priority)) return false;
    if (state.year?.from !== undefined && p.year < state.year.from) return false;
    if (state.year?.to !== undefined && p.year > state.year.to) return false;
    if (state.hasPdf === true && !p.pdfPath) return false;
    if (state.hasNotes === true && !(p.myNotes && p.myNotes.trim())) return false;
    if (state.authorQuery && state.authorQuery.trim()) {
      const q = state.authorQuery.trim().toLowerCase();
      if (!p.authors.some((a) => a.toLowerCase() === q)) return false;
    }
    return true;
  });
}

/**
 * Distinct author last names in the project, sorted by descending paper
 * count (the typeahead picker's ranking). Pure.
 */
export function distinctAuthors(papers: Paper[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of papers) {
    for (const a of p.authors) {
      const name = a.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Round-trip through JSON for `Project.sidebarFilter` persistence. */
export function serializeFilter(state: SidebarFilterState): string {
  return JSON.stringify(state);
}

/** Inverse of `serializeFilter`; falls back to the default on any mismatch. */
export function deserializeFilter(raw: unknown): SidebarFilterState {
  const base = defaultFilter();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<SidebarFilterState>;
  return {
    status: Array.isArray(s.status) ? (s.status as ReadingStatus[]) : [],
    priority: Array.isArray(s.priority) ? (s.priority as Priority[]) : [],
    year:
      s.year && typeof s.year === 'object'
        ? { from: s.year.from, to: s.year.to }
        : undefined,
    hasPdf: s.hasPdf === true ? true : undefined,
    hasNotes: s.hasNotes === true ? true : undefined,
    authorQuery: typeof s.authorQuery === 'string' ? s.authorQuery : undefined,
  };
}
