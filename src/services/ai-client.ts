// src/services/ai-client.ts

export class AIClient {
  constructor(private config: AIConfig);
  
  // Core
  async chat(messages: ChatMessage[], context?: RetrievedContext[]): Promise<AIResponse>;
  async summarize(text: string, style?: 'brief' | 'detailed' | 'bullet'): Promise<AIResponse>;
  
  // Research-specific
  async extractClaims(paperText: string): Promise<Claim[]>;
  async findGaps(paperIds: string[]): Promise<string[]>;
  async synthesize(paperIds: string[], topic: string): Promise<AIResponse>;
  async suggestConnections(paperId: string, candidates: string[]): Promise<string[]>;
  
  // Context management
  async buildContext(query: string, projectId?: string): Promise<RetrievedContext[]>;
  
  // Utilities
  countTokens(text: string): number;
  estimateCost(tokens: number): number;
}