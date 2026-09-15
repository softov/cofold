import type { ModelAdapter, ModelFeatures, ModelParams } from './model.js';

/** One entry of a provider's catalog; what a host shows when the user picks a model. */
export interface ModelInfo {
  /** Provider model id, e.g. 'qwen/qwen3-8b'. */
  id: string;
  /** Display name; falls back to id. */
  name: string;
  /** Best effort from the listing; the caller may override when building the adapter. */
  features: ModelFeatures;
  /** Max input context when the provider reports it. */
  contextTokens?: number;
  maxOutputTokens?: number;
  pricing?: { inputPerMillion: number; outputPerMillion: number; currency: 'USD' };
}

/**
 * A catalog plus an adapter factory for one endpoint. A host lists providers, calls listModels(),
 * lets the user pick, then model({ id }) → createAgent({ model }). The core never calls it.
 */
export interface ModelProvider {
  /** Stable id, e.g. 'openai-compat:lmstudio'. */
  id: string;
  listModels(args?: { signal?: AbortSignal }): Promise<ModelInfo[]>;
  model(args: { id: string; features?: Partial<ModelFeatures>; params?: ModelParams }): ModelAdapter;
}
