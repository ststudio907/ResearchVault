// src/core/events.ts
//
// Typed event payloads used across the plugin. Centralised here so the
// `EventBus` declaration in `ResearchVaultPlugin` has a single, checked
// source of truth and Vim/IDE "Go to type" lands in one place.
//

import type { Project, ProjectStats, Paper, Quote, AIRequest, AIResponse } from '../types';
import type {
  CitationLookupSucceeded,
  CitationLookupFailed,
} from '../services/citation/types';

export interface ResearchVaultEvents {
  /** Emitted when any project's creation, update, or activation happens. */
  projectChanged: Project;
  /** Emitted when per-project stats are recomputed (handy for sidebar refreshes). */
  projectStatsUpdated: ProjectStats & { projectId: string };
  /** Emitted when a paper is imported or its file is created on disk. */
  paperImported: Paper;
  /**
   * Emitted when a paper's metadata is updated (in-app edits or live sync from
   * a vault `modify` event). Subscribers should re-render or re-derive state.
   */
  paperUpdated: Paper;
  /** Emitted when a paper is removed from the index (delete or rename away). */
  paperRemoved: { paperId: string };
  /** Emitted when a paper's status or priority changes. */
  paperStatusChanged: Paper;
  /** Emitted when a quote is appended to a paper (editor capture or PDF extraction). */
  quoteAdded: { paper: Paper; quote: Quote };
  /** Emitted when the vault index is rebuilt or patched. Subscribers re-render. */
  indexUpdated: { count: number };
  /** Emitted right before a network AI call goes out. */
  aiRequestStarted: AIRequest;
  /** Emitted when an AI call returns (success or failure). */
  aiRequestCompleted: { request: AIRequest; response: AIResponse };
  /**
   * 4.1.A: Emitted when a citation lookup (DOI / title / bibliographic query)
   * returns a record. The modal (4.1.C) subscribes to this to refresh the
   * preview pane. 4.1.B fills in the real network calls; today the orchestrator
   * only emits the failure variant (provider stubs throw).
   */
  citationLookupSucceeded: CitationLookupSucceeded;
  /** 4.1.A: Emitted on any citation-lookup failure (network, parse, disabled, etc.). */
  citationLookupFailed: CitationLookupFailed;
}
