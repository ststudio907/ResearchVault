// src/types/ai.ts

export interface AIConfig {
  provider: 'openai' | 'anthropic' | 'local' | 'custom';
  apiKey?: string;
  baseUrl?: string;                // For local/custom
  model: string;
  maxTokens: number;
  temperature: number;
  
  // Feature toggles
  enableSummarization: boolean;
  enableChat: boolean;
  enableSuggestions: boolean;
  
  // Cost control
  monthlyBudget?: number;
  currentMonthUsage: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  
  // Context used for this response
  context?: RetrievedContext[];
  
  // Metadata
  tokensUsed?: number;
  model?: string;
}

export interface RetrievedContext {
  paperId?: string;
  noteId?: string;
  quoteId?: string;
  content: string;
  relevanceScore: number;
}

export interface AIRequest {
  type: 'summarize' | 'chat' | 'extract_claims' | 'find_gaps' | 'synthesize';
  payload: unknown;
  projectScope?: string;           // Limit to project
  paperIds?: string[];             // Limit to specific papers
}

export interface AIResponse {
  content: string;
  tokensUsed: number;
  contextUsed?: RetrievedContext[];
  error?: string;
}