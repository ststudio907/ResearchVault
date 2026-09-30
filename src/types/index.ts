// src/types/index.ts
//
// Barrel re-export of every public type and const used across the plugin.
// Consumers should `import { Project, Paper, AIConfig, ... } from './types';`
// rather than reaching into the individual files so refactors stay local.
//

import type { ReadingStatus, Priority, QuoteSource } from './literature';
import type { AIConfig } from './ai';

// ----- Project -----
export type {
  Project,
  ProjectSettings,
  ProjectCreateConfig,
  ProjectStats,
  CustomField,
  CitationStyle,
} from './project';

export {
  CITATION_STYLES,
  DEFAULT_CITATION_STYLE,
} from './project';

// ----- Literature -----
export type {
  Paper,
  Author,
  Quote,
  QuoteSource,
  QuoteInput,
  Claim,
  ReadingStatus,
  Priority,
  PaperSource,
} from './literature';

/** Tuples used by UI dropdowns and validation. Kept in sync with the unions in `literature.ts`.
 *  2026-09-30 label redesign: `queued` merged into `unread`, `summarized` merged into
 *  `annotating`; priorities re-tiered to low/normal/high (`critical` → `high`). Legacy
 *  frontmatter values are coerced on read in `paper-service.ts` (§7.5 of
 *  plans/sidebar-overhaul-research.md). */
export const READING_STATUSES: readonly ReadingStatus[] = [
  'unread',
  'skimming',
  'reading',
  'annotating',
  'synthesized',
  'archived',
  'excluded',
] as const;

export const PRIORITIES: readonly Priority[] = [
  'low',
  'normal',
  'high',
] as const;

/** Provenance values a Quote may carry. Kept in sync with `QuoteSource` in `literature.ts`. */
export const QUOTE_SOURCES: readonly QuoteSource[] = [
  'editor',
  'pdf',
  'manual',
] as const;

// ----- Notes -----
export type {
  LiteratureNote,
  AtomicNote,
  ConceptNote,
  ConceptClaim,
} from './notes';

// ----- Citation (4.1.A) -----
// Barrel for the citation sub-module. Re-exporting from `services/citation/types`
// rather than introducing a top-level `types/citation.ts` keeps the sub-module
// self-contained — 4.1.B will add providers / orchestrator without churning
// the public barrel.
export type {
  CitationProvider,
  CitationSettings,
  CitationProviderClient,
  CslJsonRecord,
  CitationLookupSucceeded,
  CitationLookupFailed,
  CitationLookupFailureReason,
} from '../services/citation/types';

export { DEFAULT_CITATION_SETTINGS } from '../services/citation/types';

// ----- AI -----
export type {
  AIConfig,
  ChatMessage,
  RetrievedContext,
  AIRequest,
  AIResponse,
} from './ai';

/** Providers the plugin knows how to speak to. Order is intentional (most common first). */
export const AI_PROVIDERS: readonly AIConfig['provider'][] = [
  'openai',
  'anthropic',
  'local',
  'custom',
] as const;
