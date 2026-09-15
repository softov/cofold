import type { ModelFeatures, ModelParams } from '@facio/agents';

export interface OpenAICompatProviderOptions {
  /** e.g. 'http://localhost:1234/v1' or 'https://openrouter.ai/api/v1' */
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
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
}
