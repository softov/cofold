/** One Chat Completions endpoint a program may talk to, as its configuration file writes it (decision 123). */
export interface ProviderConfig {
  /** How a model reference names it: `<id>/<modelId>`. No slash and no whitespace. */
  id: string;
  /** e.g. `http://localhost:1234/v1` or `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}
