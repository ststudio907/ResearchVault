// src/types/index.ts
//
// Barrel re-export of every public type and const used across the plugin.
// Consumers should `import { Project, Paper, AIConfig, ... } from './types';`
// rather than reaching into the individual files so refactors stay local.
//

import type { ReadingStatus, Priority } from './literature';
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
  Claim,
  ReadingStatus,
  Priority,
  PaperSource,
} from './literature';

/** Tuples used by UI dropdowns and validation. Kept in sync with the unions in `literature.ts`. */
export const READING_STATUSES: readonly ReadingStatus[] = [
  'unread',
  'queued',
  'skimming',
  'reading',
  'annotating',
  'summarized',
  'synthesized',
  'archived',
  'excluded',
] as const;

export const PRIORITIES: readonly Priority[] = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

// ----- Notes -----
export type {
  LiteratureNote,
  AtomicNote,
  ConceptNote,
  ConceptClaim,
} from './notes';

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
