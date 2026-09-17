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
  /** Every prompt token, cached ones included (decision 109); an adapter that reports them apart adds them up. */
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cache hits, when known. */
  cacheReadTokens?: number;
  /** Provider-reported cache writes, when known (Anthropic `cache_creation_input_tokens`). */
  cacheWriteTokens?: number;
  /** Provider-reported reasoning tokens, when known; included in outputTokens by most providers. */
  reasoningTokens?: number;
}

/** USD per million tokens (decision 108). Cache rates default to the input rate. */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  currency: 'USD';
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

/**
 * What an adapter yields while a reply is being produced (decision 105). A `toolCall.delta` is a
 * fragment for a host reading the adapter directly; the loop never acts on one: `done.reply`
 * carries every tool call whole, and nothing is validated or executed before `done`.
 */
export type ModelStreamEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'toolCall.delta'; index: number; callId?: string; name?: string; arguments: string }
  | { type: 'done'; reply: ModelReply };

export interface ModelAdapter {
  /** Stable id for logs and the agent definition, e.g. "openai-compat:qwen3-8b". */
  id: string;
  modelId: string;
  features: ModelFeatures;
  /** Absent means unknown: no cost is recorded and maxCost never trips (decision 108). */
  pricing?: ModelPricing;
  complete(request: ModelRequest): Promise<ModelReply>;
  /** Present when features.streaming is true; the loop prefers it over complete() (decision 104). Must end with `done`. */
  stream?(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
  /** Optional exact counter; the loop falls back to context.estimateTokens. */
  estimateTokens?(text: string): number;
}
