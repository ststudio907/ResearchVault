// src/types/literature.ts

export interface Paper {
  id: string;                    // UUID or citekey
  citekey: string;                 // Unique citation key (e.g., "smith2023learning")
  title: string;
  authors: Author[];
  year: number;
  venue?: string;                  // Journal, conference, etc.
  doi?: string;
  url?: string;
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
  customFields: Record<string, any>;
  
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
  | 'queued'
  | 'skimming'
  | 'reading'
  | 'annotating'
  | 'summarized'
  | 'synthesized'
  | 'archived'
  | 'excluded';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Quote {
  id: string;
  text: string;
  page?: number;
  section?: string;
  note?: string;
  tags: string[];
  createdAt: number;
}

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
