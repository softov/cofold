import type { Message } from './message.js';
import type { ModelToolDefinition } from './tool.js';

export interface ModelFeatures {
  tools: boolean;
  streaming: boolean;
  images: boolean;
  structuredOutput: boolean;
  /** Accepts ModelParams.reasoning and may return ReasoningPart. */
  reasoning: boolean;
}

/** The whole range providers accept (decision 98); a level a provider rejects is the provider's error, not a client-side clamp. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelParams {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stop?: string[];
  seed?: number;
  /** Ignored by an adapter whose features.reasoning is false. */
  reasoning?: { effort?: ReasoningEffort; maxTokens?: number };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cache hits, when known. */
  cacheReadTokens?: number;
  /** Provider-reported reasoning tokens, when known; included in outputTokens by most providers. */
  reasoningTokens?: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other';

export interface ModelRequest {
  instructions: string;
  messages: Message[];
  tools: ModelToolDefinition[];
  params: ModelParams;
  /** Stable per session; adapters that key a prompt cache use it (decision 100). */
  cacheKey: string;
  signal: AbortSignal;
}

export interface ModelReply {
  /** role 'assistant', source 'model'; reasoning, text and toolCall parts only. */
  message: Message;
  usage: Usage;
  finish: FinishReason;
  /** Provider payload for diagnostics; never sent to the model or stored in the transcript. */
  raw?: unknown;
}

export interface ModelAdapter {
  /** Stable id for logs and the agent definition, e.g. "openai-compat:qwen3-8b". */
  id: string;
  modelId: string;
  features: ModelFeatures;
  complete(request: ModelRequest): Promise<ModelReply>;
  /** Optional exact counter; the loop falls back to context.estimateTokens. */
  estimateTokens?(text: string): number;
}
