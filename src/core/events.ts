// src/core/events.ts
//
// Typed event payloads used across the plugin. Centralised here so the
// `EventBus` declaration in `ResearchVaultPlugin` has a single, checked
// source of truth and Vim/IDE "Go to type" lands in one place.
//

import type { Project, ProjectStats, Paper, AIRequest, AIResponse } from '../types';

export interface ResearchVaultEvents {
  /** Emitted when any project's creation, update, or activation happens. */
  projectChanged: Project;
  /** Emitted when per-project stats are recomputed (handy for sidebar refreshes). */
  projectStatsUpdated: ProjectStats & { projectId: string };
  /** Emitted when a paper is imported or its file is created on disk. */
  paperImported: Paper;
  /** Emitted when a paper's status or priority changes. */
  paperStatusChanged: Paper;
  /** Emitted right before a network AI call goes out. */
  aiRequestStarted: AIRequest;
  /** Emitted when an AI call returns (success or failure). */
  aiRequestCompleted: { request: AIRequest; response: AIResponse };
}
