// src/services/ai-client.ts
//
// Sprint 4 placeholder (see plans/plan.md §7 — Sprint 4: AI / Tier 3).
// Real implementation will route through OpenAI, Anthropic, local, and
// custom providers with budget enforcement per settings.ai.currentMonthUsage.
//

import type {
  AIConfig,
  AIResponse,
  ChatMessage,
  Claim,
  RetrievedContext,
} from '../types';

export class AIClient {
  constructor(private readonly config: AIConfig) {}

  // ----- Core -----
  async chat(
    _messages: ChatMessage[],
    _context?: RetrievedContext[],
  ): Promise<AIResponse> {
    throw this.notImplemented('chat');
  }
  async summarize(
    _text: string,
    _style?: 'brief' | 'detailed' | 'bullet',
  ): Promise<AIResponse> {
    throw this.notImplemented('summarize');
  }

  // ----- Research-specific -----
  async extractClaims(_paperText: string): Promise<Claim[]> {
    throw this.notImplemented('extractClaims');
  }
  async findGaps(_paperIds: string[]): Promise<string[]> {
    throw this.notImplemented('findGaps');
  }
  async synthesize(_paperIds: string[], _topic: string): Promise<AIResponse> {
    throw this.notImplemented('synthesize');
  }
  async suggestConnections(
    _paperId: string,
    _candidates: string[],
  ): Promise<string[]> {
    throw this.notImplemented('suggestConnections');
  }

  // ----- Context management -----
  async buildContext(
    _query: string,
    _projectId?: string,
  ): Promise<RetrievedContext[]> {
    throw this.notImplemented('buildContext');
  }

  // ----- Utilities -----
  countTokens(_text: string): number {
    throw this.notImplemented('countTokens');
  }
  estimateCost(_tokens: number): number {
    throw this.notImplemented('estimateCost');
  }

  private notImplemented(method: string): Error {
    // Touch config so it's not reported as unused until real wiring lands.
    void this.config;
    return new Error(`AIClient.${method} is not implemented yet (Sprint 4 — see plans/plan.md §7).`);
  }
}

// Type kept here so the type imports above are recognised as exported
// re-uses the same vocabulary as `types/ai.ts`. (No runtime side effects.)
type _AIConfigReference = AIConfig;
