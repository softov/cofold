import type { Message } from './message.js';
import type { ModelToolDefinition } from './tool.js';

export interface ModelFeatures {
  tools: boolean;
  streaming: boolean;
  images: boolean;
  structuredOutput: boolean;
}

export interface ModelParams {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stop?: string[];
  seed?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cache hits, when known. */
  cacheReadTokens?: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other';

export interface ModelRequest {
  instructions: string;
  messages: Message[];
  tools: ModelToolDefinition[];
  params: ModelParams;
  signal: AbortSignal;
}

export interface ModelReply {
  /** role 'assistant', source 'model'; text and toolCall parts only. */
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
