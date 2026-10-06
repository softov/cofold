import type { JsonSchema, ModelProvider } from '@cofold/agents';
import { AgentError } from '@cofold/agents';
import { openaiCompatProvider } from './index.js';
import type { ProviderConfig } from './types/config.js';

/** One provider entry as a configuration file writes it: the shape a program validates its `providers` array against (decision 123). */
export const PROVIDER_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, pattern: '^[^/\\s]+$' },
    baseUrl: { type: 'string', minLength: 1 },
    apiKey: { type: 'string' },
    headers: { type: 'object' },
  },
  required: ['id', 'baseUrl'],
  additionalProperties: false,
};

/** One `openaiCompatProvider` per entry, keyed by its `id`, in the configuration's order. */
export function providersOf(configs: readonly ProviderConfig[]): Map<string, ModelProvider> {
  return new Map(configs.map((provider) => [
    provider.id,
    openaiCompatProvider({
      name: provider.id,
      baseUrl: provider.baseUrl,
      ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
      ...(provider.headers !== undefined ? { headers: provider.headers } : {}),
    }),
  ]));
}

/**
 * `<providerId>/<modelId>` split at the first slash; the model id may hold slashes of its own.
 * `undefined` when the reference has no slash or nothing on one side of it, which is the answer a host
 * needs for "is this a reference at all" and what `providerFor` refuses.
 */
export function splitModel(ref: string): { provider: string; modelId: string } | undefined {
  const at = ref.indexOf('/');
  if (at <= 0 || at === ref.length - 1) return undefined;
  return { provider: ref.slice(0, at), modelId: ref.slice(at + 1) };
}

/** The provider a model reference names, faulted by name when the reference is malformed or no provider answers to it. */
export function providerFor(providers: ReadonlyMap<string, ModelProvider>, ref: string): { provider: ModelProvider; modelId: string } {
  const split = splitModel(ref);
  if (split === undefined) throw new AgentError({ code: 'invalid_options', message: `model "${ref}" must be written <provider>/<model>` });
  const provider = providers.get(split.provider);
  if (provider === undefined) {
    const known = [...providers.keys()];
    throw new AgentError({
      code: 'invalid_options',
      message: known.length === 0
        ? `no provider is configured`
        : `model "${ref}" names provider "${split.provider}"; configured: ${known.join(', ')}`,
    });
  }
  return { provider, modelId: split.modelId };
}
