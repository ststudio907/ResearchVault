// src/types/literature.ts

export interface Paper {
  id: string;                    // UUID or citekey
  citekey: string;                 // Unique citation key (e.g., "smith2023learning")
  title: string;
  /** Author last names, one string per author (YAML list). Empty strings are not allowed. */
  authors: string[];
  /**
   * Optional parallel array of author first names, indexed in lockstep with `authors`.
   * Absent when the user typed only last names (the common case). When present, every
   * entry corresponds to the entry with the same index in `authors` — empty string means
   * the author has only a last name. This is the new parallel-array shape (2.8.E), chosen
   * so the YAML stays as a YAML list (Obsidian-tag-searchable) and so we keep `Paper.authors`
   * a plain `string[]` (no nested objects, no per-author middle/affiliation/orcid yet).
   */
  authorFirstNames?: string[];
  year: number;
  venue?: string;                  // Journal, conference, etc.
  doi?: string;
  url?: string;
  /**
   * Open-access PDF URL returned by OpenAlex / CrossRef `link` arrays. Stored
   * alongside `url?` (the canonical landing page) so 4.1.C can offer a
   * "Download OA PDF" affordance without re-asking the network. 4.1.A wires
   * the type only — providers do not yet return this in 4.1.A.
   */
  oaUrl?: string;
  pdfPath?: string;                // Path in vault (e.g., "Projects/ML/papers/smith2023.pdf")
  abstract?: string;
  keywords: string[];

  // ResearchVault managed fields
  status: ReadingStatus;
  priority: Priority;
  rating?: number;                 // 1-5 star rating
  dateAdded: number;
  dateModified: number;
  dateRead?: number;

  // User-generated content
  myNotes?: string;                // Path to main note file
  quotes: Quote[];
  claims: Claim[];

  // Relationships
  citations: string[];             // Citekeys this paper cites
  citedBy: string[];               // Citekeys citing this paper
  related: string[];               // Manually linked papers

  // AI-generated
  summary?: string;
  keyFindings?: string[];
  methodology?: string;
  limitations?: string[];

  // Custom fields from project
  customFields: Record<string, unknown>;

  // Source metadata
  source: PaperSource;
  importedFrom?: string;          // Zotero, Mendeley, etc.
}

export interface Author {
  firstName: string;
  lastName: string;
  middleName?: string;
  affiliation?: string;
  orcid?: string;
}

export type ReadingStatus =
  | 'unread'
  | 'skimming'
  | 'reading'
  | 'annotating'
  | 'synthesized'
  | 'archived'
  | 'excluded';

export type Priority = 'low' | 'normal' | 'high';

export interface Quote {
  id: string;
  text: string;
  page?: number;
  section?: string;
  note?: string;
  tags: string[];
  createdAt: number;
  /**
   * Provenance of the quote. Drives the small `-- source: …` footer under
   * each quote in paper notes and lets future PDF extraction know not to
   * duplicate editor-captured slices.
   *
   * Optional on the bare `Quote` type so legacy papers (written before this
   * field existed) still deserialise cleanly. Callers writing new quotes
   * should always use {@link QuoteInput}, which makes `source` required.
   */
  source?: QuoteSource;
  /** Optional page-level locator (e.g. "42", "42-43"); preferred over `page` when present. */
  locator?: string;
}

/**
 * Provenance of a captured quote.
 *
 * - `'editor'`  — captured from the active editor via QuoteCaptureModal.
 * - `'pdf'`     — extracted from a PDF via PdfService (lands with 2.6).
 * - `'manual'`  — pasted by hand outside the editor (e.g. via a future
 *                 "Notes → quote" command).
 */
export type QuoteSource = 'editor' | 'pdf' | 'manual';

/**
 * Required shape when *writing* a new quote. Differs from {@link Quote} by
 * requiring `source` so callers (modal, PDF extractor, future services)
 * commit a known origin. Tighten the source union rather than widening this
 * shape when adding new capture flows.
 */
export type QuoteInput = Omit<Quote, 'id' | 'source'> & { source: QuoteSource };

export interface Claim {
  id: string;
  text: string;
  confidence: 'low' | 'medium' | 'high';
  evidence?: string;
  relatedPapers: string[];         // Supporting/contradicting
}

export type PaperSource =
  | 'manual'
  | 'doi'
  | 'pdf'
  | 'zotero'
  | 'mendeley'
  | 'browser'
  | 'rss'
  | 'imported';
