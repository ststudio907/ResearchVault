// src/services/citation/types.ts
//
// Public types for citation lookup. Hand-typed CSL-JSON subset so we do not
// pull in `@citation-types/csl-json` (L10). Provider enum is a string-literal
// union (L11) so it tree-shakes cleanly and avoids TS `enum` / `const enum`
// ESM pitfalls. Same pattern as `ReadingStatus` / `Priority` / `PaperSource`.
//
// 4.1.A: types + skeleton. 4.1.B fills in the real CrossRef + OpenAlex
// `fetch` calls — the orchestrator API stays stable across both passes.
//

/** Which network provider to call first when looking up a DOI / etc. */
export type CitationProvider = 'crossref' | 'openalex';

/**
 * Per-install Citation settings block. Lives alongside the existing
 * `ResearchVaultSettings` children (`projects`, `templates`, `ai`, ...).
 *
 * Q2 (locked 2026-07-22): `politeContact` defaults to `''` — no identifier
 * leaves the device unless the user types one in the Citations settings tab
 * (4.1.D lands the UI).
 */
export interface CitationSettings {
  /** Master switch. When false, every entry point returns null / [] / throws disabled. Modal hides the Lookup button. */
  enableCitationLookup: boolean;
  /** Primary provider for DOI lookups. CrossRef is the canonical DOI registry; OpenAlex is the wider free-text corpus. */
  preferredProvider: CitationProvider;
  /**
   * Optional `mailto:` polite-pool contact. Empty = no identifier leaves the device (slower, default pool).
   * Non-empty = User-Agent gets `mailto:<value>` so we land in the polite pool (faster, opt-in).
   */
  politeContact: string;
  /** In-memory LRU cache TTL in days. Default 30. */
  cacheTtlDays: number;
  /** In-memory LRU cache entry cap. Default 500. */
  cacheMaxEntries: number;
  /** Token-bucket refill rate, tokens/s. Default 5. */
  rateLimitRps: number;
  /** Token-bucket capacity (burst). Default 10. */
  rateLimitBurst: number;
}

export const DEFAULT_CITATION_SETTINGS: CitationSettings = {
  enableCitationLookup: false,
  preferredProvider: 'crossref',
  politeContact: '',
  cacheTtlDays: 30,
  cacheMaxEntries: 500,
  rateLimitRps: 5,
  rateLimitBurst: 10,
};

/**
 * Hand-typed CSL-JSON record subset. The official `@citation-types/csl-json`
 * package would add ~30 KB to the bundle; we use ~14 of the ~80+ CSL fields,
 * so we type them inline and ignore unknown extras at parse time.
 *
 * Reference: https://docs.citationstyles.org/en/stable/specification.html#appendix-iv-variables
 */
export interface CslJsonRecord {
  /** 'journal-article' | 'book' | 'chapter' | 'preprint' | … */
  type?: string;
  /** DOI, ISBN, or other provider-native id. */
  id?: string;
  /**
   * NOTE (2026-09-27): the CSL-JSON spec types these text fields as
   * `string | string[]`, and CrossRef's plain `/works/{doi}` endpoint
   * returns arrays (the removed `?transform=` param used to coerce them).
   * `cslToManualInput` normalizes both shapes via `asText()`.
   */
  title?: string | string[];
  abstract?: string;
  /** Journal or book title. */
  'container-title'?: string | string[];
  shortTitle?: string | string[];
  volume?: string | number;
  issue?: string | number;
  /** Page range like "123-145". */
  page?: string;
  publisher?: string;
  'publisher-place'?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  ISSN?: string;
  /** CSL "keyword" property — usually a comma-joined string. */
  keyword?: string | string[];
  /** OpenAlex sometimes uses "subject" / "keywords" instead of CSL's "keyword". */
  subject?: string | string[];
  author?: CslAuthor[];
  editor?: CslAuthor[];
  issued?: CslDate;
  accessed?: CslDate;
  language?: string;
}

export interface CslAuthor {
  family?: string;
  given?: string;
  /** Some providers (OpenAlex in particular) collapse to a single `literal` when the name isn't well-formed. */
  literal?: string;
}

/** CSL date — most commonly `["date-parts": [[year, month?, day?]]]`. */
export interface CslDate {
  'date-parts'?: Array<[number] | [number, number] | [number, number, number]>;
  literal?: string;
  raw?: string;
}

// ----- Provider client (consumed by both CrossRef + OpenAlex providers) -----

/** Defaults to globalThis.fetch. Tests can inject a mock. */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type FetchImpl = (input: any, init?: any) => Promise<Response>;

/**
 * The two providers implement this interface. 4.1.A ships both as stubs that
 * throw `Error('4.1.B')` for the network calls; `importCslJson` (in the
 * orchestrator) does the CSL→Paper mapping regardless of provider and is
 * fully implemented in 4.1.A.
 */
export interface CitationProviderClient {
  readonly name: CitationProvider;
  /** Resolve a DOI to a CSL-JSON record. Returns null on 404. */
  lookupByDoi(doi: string, opts: ProviderFetchOpts): Promise<CslJsonRecord | null>;
  /** Free-text title search → list of CSL-JSON records. */
  searchByTitle(title: string, limit: number, opts: ProviderFetchOpts): Promise<CslJsonRecord[]>;
  /**
   * Bibliographic / journal-name search — CrossRef accepts a
   * `query.bibliographic` param and OpenAlex accepts a generic `search` param;
   * both handle journal names, partial citations, author + year, etc.
   * (User-flagged 2026-07-22 — see `plans/citation-lookup-research.md` §7.4.)
   */
  searchByQuery(query: string, limit: number, opts: ProviderFetchOpts): Promise<CslJsonRecord[]>;
}

export interface ProviderFetchOpts {
  /** When non-empty, used as `mailto:` in the User-Agent so we land in the polite pool. */
  politeContact: string;
  /** Injected by tests; defaults to globalThis.fetch inside the provider. */
  fetchImpl?: FetchImpl;
}

// ----- Telemetry events (mirror `aiRequestStarted` / `aiRequestCompleted`) -----

export interface CitationLookupSucceeded {
  doi?: string;
  query?: string;
  provider: CitationProvider;
  /** Wall-clock duration of the network call, in milliseconds. */
  durationMs: number;
  /** True if the response came from the LRU cache, not the network. */
  cacheHit: boolean;
}

export type CitationLookupFailureReason =
  | 'network'
  | 'rate-limited'
  | 'not-found'
  | 'invalid-doi'
  | 'disabled'
  | 'parse';

export interface CitationLookupFailed {
	reason: CitationLookupFailureReason;
	doi?: string;
	query?: string;
	provider?: CitationProvider;
	/** Provider / JSON-parse -supplied message when available. */
	message?: string;
}

/**
 * Thrown by a `CitationProviderClient` when the network call has completed
 * but the response was something the orchestrator needs to map to a
 * `CitationLookupFailureReason` (B9, locked 2026-07-22). The orchestrator
 * catches these and either re-throws (network / unexpected) or converts
 * them to a `CitationLookupFailed` event.
 *
 * `kind` is the canonical reason. `status` is the HTTP status when known
 * (undefined for fetch-throws / parse errors). `message` is the human-
 * readable explanation surfaced to the modal info line on failure.
 */
export type CitationLookupErrorKind =
	/** HTTP 404 on `lookupByDoi` — distinct from "no hits in search". */
	| 'not-found'
	/** HTTP 429 after the orchestrator's single retry. */
	| 'rate-limited'
	/** HTTP 401 / 403 / 5xx / fetch threw / parse error. */
	| 'network'
	/** Other 4xx (besides 404, 429) on a DOI lookup. */
	| 'invalid-doi';

export class CitationLookupError extends Error {
	readonly kind: CitationLookupErrorKind;
	readonly status: number | undefined;

	constructor(kind: CitationLookupErrorKind, message: string, status?: number) {
		super(message);
		this.name = 'CitationLookupError';
		this.kind = kind;
		this.status = status;
	}
}
