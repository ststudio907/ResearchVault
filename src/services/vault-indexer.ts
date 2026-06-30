// src/services/vault-indexer.ts

export class VaultIndexer {
  constructor(private plugin: ResearchVaultPlugin);
  
  // Indexing
  async buildIndex(): Promise<void>;
  async updateIndex(file: TFile): Promise<void>;
  async removeFromIndex(file: TFile): Promise<void>;
  
  // Search
  searchPapers(query: string, filters?: SearchFilters): Paper[];
  searchNotes(query: string): LiteratureNote[];
  findUnlinkedMentions(citekey: string): TFile[];
  
  // Graph
  getCitationGraph(): CitationGraph;
  getRelatedPapers(paperId: string, depth?: number): string[];
  
  // AI prep
  getChunksForPaper(paperId: string): TextChunk[];
  getProjectContext(projectId: string, maxTokens?: number): string;
}

export interface SearchFilters {
  status?: ReadingStatus[];
  year?: { min?: number; max?: number };
  authors?: string[];
  tags?: string[];
  priority?: Priority[];
  rating?: { min?: number; max?: number };
  dateAdded?: { after?: number; before?: number };
  hasPdf?: boolean;
  hasNotes?: boolean;
  customFields?: Record<string, any>;
}