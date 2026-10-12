// src/services/papers/paper-paths.ts
//
// Path resolution helpers for paper notes: where a `Paper`'s markdown file
// lives on disk and how long vault `modify` events are debounced before a
// re-sync. Extracted from `paper-service.ts` in the 2026-10 cleanup
// (see `docs/REFACTOR_CONTEXT.md`).

import { normalizePath } from 'obsidian';
import type { Paper } from '../../types';

/** Fetch the on-disk papers folder from a paper's `customFields`. Returns `undefined` if missing or wrong shape. */
export function papersFolderOf(paper: Paper): string | undefined {
  const folder = paper.customFields['papersFolder'];
  return typeof folder === 'string' && folder.length > 0 ? folder : undefined;
}

/** The canonical `<papersFolder>/<citekey>.md` path for a paper, or undefined. */
export function canonicalPathOf(paper: Paper): string | undefined {
  const folder = papersFolderOf(paper);
  if (!folder) return undefined;
  return normalizePath(`${folder}/${paper.citekey}.md`);
}

/** Debounce window (ms) for vault `modify` events before a `syncFromFile`. */
export const SYNC_DEBOUNCE_MS = 750;
