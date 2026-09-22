import type { ModelFeatures, ModelParams, ModelPricing, ReasoningEffort } from '@cofold/agents';

export interface OpenAICompatProviderOptions {
  /** e.g. 'http://localhost:1234/v1' or 'https://openrouter.ai/api/v1' */
  baseUrl: string;
  /** A function is called once per request attempt and never cached, so an expired token is refreshed on retry (decision 99). */
  apiKey?: string | (() => string | Promise<string>);
  headers?: Record<string, string>;
  /** Token budget per effort, for providers that take max_tokens instead of a level (decision 98). */
  reasoningBudgets?: Partial<Record<ReasoningEffort, number>>;
  /** Provider id suffix; defaults to the URL host. */
  name?: string;
  /** Retries on 429, 5xx and network errors; default 2. */
  retries?: number;
  /** Injection for tests. */
  fetch?: typeof fetch;
}

export interface OpenAICompatOptions extends OpenAICompatProviderOptions {
  /** Provider model id. */
  model: string;
  features?: Partial<ModelFeatures>;
  params?: ModelParams;
  /** Becomes `adapter.pricing` (decision 108); pass the catalogue's `ModelInfo.pricing` through. Absent means unknown cost. */
  pricing?: ModelPricing;
}
