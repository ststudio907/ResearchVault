// src/ui/views/filter-panel.ts
//
// 2.9.C — filter panel state + pure logic for the sidebar (D31-era).
// DOM-free by design: the sidebar view owns all rendering; this module owns
// the state shape, defaults, persistence helpers, filtering, and sorting.
// Design: plans/sidebar-overhaul-research.md §7.6.

import type { Paper, Priority, ReadingStatus } from '../../types';
import { PRIORITIES, READING_STATUSES } from '../../types';

/** Sort modes offered in the panel dropdown. */
export type SortMode = 'dateAdded' | 'dateModified' | 'title' | 'year' | 'priority';

/** Full persisted panel state. Persisted globally in `settings.filterPanel`. */
export interface FilterPanelState {
  /** Show the derived Attention group above the status groups. */
  attention: boolean;
  /** Visible statuses; `null` = all (default, adds no filter). */
  status: ReadingStatus[] | null;
  /** Visible priorities; `null` = all (default). */
  priority: Priority[] | null;
  /** Sort key within groups (and for Attention / search results). */
  sort: SortMode;
  /** Sort direction. Meaning is per-mode: dates newest-first when false. */
  sortAsc: boolean;
  /** Skip rendering groups with no visible papers. */
  hideEmpty: boolean;
  /** Whether the panel is expanded in the sidebar header. */
  open: boolean;
}

export const DEFAULT_FILTER_PANEL: FilterPanelState = {
  attention: true,
  status: null,
  priority: null,
  sort: 'dateAdded',
  sortAsc: false,
  hideEmpty: true,
  open: false,
};

/**
 * Merge a partially-known persisted blob into a valid state. Tolerates
 * payloads written by older builds (missing keys) or corrupted values.
 */
export function normalizeFilterPanel(raw: unknown): FilterPanelState {
  const merged: FilterPanelState = { ...DEFAULT_FILTER_PANEL };
  if (!raw || typeof raw !== 'object') return merged;
  const r = raw as Partial<FilterPanelState>;
  if (typeof r.attention === 'boolean') merged.attention = r.attention;
  if (r.status === null || Array.isArray(r.status)) {
    merged.status = r.status === null
      ? null
      : (r.status.filter((s): s is ReadingStatus =>
          READING_STATUSES.includes(s)));
  }
  if (r.priority === null || Array.isArray(r.priority)) {
    merged.priority = r.priority === null
      ? null
      : (r.priority.filter((p): p is Priority =>
          PRIORITIES.includes(p)));
  }
  if (
    r.sort === 'dateAdded' || r.sort === 'dateModified' ||
    r.sort === 'title' || r.sort === 'year' || r.sort === 'priority'
  ) {
    merged.sort = r.sort;
  }
  if (typeof r.sortAsc === 'boolean') merged.sortAsc = r.sortAsc;
  if (typeof r.hideEmpty === 'boolean') merged.hideEmpty = r.hideEmpty;
  if (typeof r.open === 'boolean') merged.open = r.open;
  return merged;
}

/** True when any facet deviates from defaults (drives the icon tint). */
export function isFilterActive(state: FilterPanelState): boolean {
  const d = DEFAULT_FILTER_PANEL;
  return (
    state.attention !== d.attention ||
    state.status !== null ||
    state.priority !== null ||
    state.sort !== d.sort ||
    state.sortAsc !== d.sortAsc ||
    state.hideEmpty !== d.hideEmpty
  );
}

/**
 * Apply the status/priority facets. OR within a facet, AND across facets;
 * `null` facets pass everything through.
 */
export function applyFilters(papers: Paper[], state: FilterPanelState): Paper[] {
  let out = papers;
  if (state.status !== null) {
    const allow = new Set(state.status);
    out = out.filter((p) => allow.has(p.status));
  }
  if (state.priority !== null) {
    const allow = new Set(state.priority);
    out = out.filter((p) => allow.has(p.priority));
  }
  return out;
}

/** Per-mode comparators. All return "a before b" as a negative number. */
function compare(a: Paper, b: Paper, mode: SortMode): number {
  switch (mode) {
    case 'dateAdded':
      return a.dateAdded - b.dateAdded;
    case 'dateModified':
      return a.dateModified - b.dateModified;
    case 'title':
      return a.title.localeCompare(b.title);
    case 'year':
      return a.year - b.year;
    case 'priority': {
      const weight: Record<Priority, number> = { low: 0, normal: 1, high: 2 };
      return weight[a.priority] - weight[b.priority];
    }
  }
}

/**
 * Sort papers for display. Direction defaults per mode (dates newest-first,
 * title A→Z, priority high-first); `sortAsc` flips it.
 */
export function sortPapers(papers: Paper[], state: FilterPanelState): Paper[] {
  const dir = state.sortAsc ? 1 : -1;
  return papers.slice().sort((a, b) => compare(a, b, state.sort) * dir);
}
