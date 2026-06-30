// src/services/paper-service.ts

export class PaperService {
  constructor(
    private plugin: ResearchVaultPlugin,
    private projectManager: ProjectManager,
    private indexer: VaultIndexer
  );
  
  // Creation
  async createFromDoi(doi: string, projectId: string): Promise<Paper>;
  async createFromPdf(pdfPath: string, projectId: string): Promise<Paper>;
  async createManual(data: Partial<Paper>, projectId: string): Promise<Paper>;
  
  // Updates
  async updatePaper(id: string, updates: Partial<Paper>): Promise<Paper>;
  async updateStatus(id: string, status: ReadingStatus): Promise<void>;
  async updateReadingProgress(id: string, progress: number): Promise<void>;
  
  // Relationships
  async addCitation(from: string, to: string): Promise<void>;
  async addRelated(paperId: string, relatedId: string): Promise<void>;
  async findCitationsInPdf(paperId: string): Promise<string[]>; // Extract from PDF
  
  // Quotes
  async addQuote(paperId: string, quote: Omit<Quote, 'id'>): Promise<Quote>;
  async extractQuotesFromPdf(paperId: string): Promise<Quote[]>;
  
  // File operations
  async createNoteFile(paper: Paper): Promise<TFile>;
  async getNoteContent(paper: Paper): Promise<string>;
  
  // Bulk
  async importBibtex(bibtex: string, projectId: string): Promise<Paper[]>;
  async exportBibtex(paperIds: string[]): Promise<string>;
}