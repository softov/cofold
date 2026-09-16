import type { ModelProvider } from '@facio/agents';
import { AgentError } from '@facio/agents';
import { ArgumentError, ConfigurationError, check } from '@facio/commands';
import { resolveConfig } from '@facio/config';
import { openaiCompatProvider } from '@facio/model-openai-compat';
import type { JsonSchema } from '@facio/sdk';
import type { PapoConfig, ProviderConfig } from './types/config.js';

const PROVIDER: JsonSchema = {
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

/** The file's shape; `check` turns the first problem into a sentence naming the key. */
const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    providers: { type: 'array', items: PROVIDER },
    model: { type: 'string', minLength: 1 },
    permissions: { type: 'string', enum: ['ask', 'destructive', 'auto'] },
    reasoning: { type: 'string', enum: ['off', 'low', 'medium', 'high'] },
    instructions: { type: 'string' },
    limits: {
      type: 'object',
      properties: {
        maxSteps: { type: 'integer', minimum: 1 },
        maxToolCalls: { type: 'integer', minimum: 1 },
        maxToolOutputChars: { type: 'integer', minimum: 1 },
        timeoutMs: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    params: {
      type: 'object',
      properties: {
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        topP: { type: 'number', minimum: 0, maximum: 1 },
        maxOutputTokens: { type: 'integer', minimum: 1 },
        seed: { type: 'integer' },
        stop: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    tools: {
      type: 'object',
      properties: {
        files: { type: 'boolean' },
        shell: { type: 'boolean' },
        web: {
          anyOf: [
            { type: 'boolean' },
            {
              type: 'object',
              properties: {
                search: {
                  type: 'object',
                  properties: {
                    brave: { type: 'object', properties: { apiKey: { type: 'string', minLength: 1 } }, required: ['apiKey'], additionalProperties: false },
                    tavily: { type: 'object', properties: { apiKey: { type: 'string', minLength: 1 } }, required: ['apiKey'], additionalProperties: false },
                    duckduckgo: { type: 'boolean' },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          ],
        },
        memory: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    theme: { type: 'string', minLength: 1 },
    shell: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
};

export const DEFAULT_INSTRUCTIONS = 'You are a careful assistant working in the user\'s project. Answer plainly; use the tools you are given when they help.';

const BASE = {
  providers: [], permissions: 'destructive', reasoning: 'off', instructions: DEFAULT_INSTRUCTIONS,
  tools: { files: true, shell: true, web: true, memory: true },
  theme: 'paper', shell: 'workbench',
} as const;

/**
 * The configuration, from every place it may be written.
 *
 * `@facio/config` walks the layers (`~/.config/papo/config.json`, the nearest `.papo.json`,
 * `$PAPO_CONFIG`, `--config`); on top of them `PAPO_BASE_URL`, `PAPO_API_KEY` and `PAPO_MODEL` (or the
 * family's `FACIO_*`, which the examples read too) add or replace a provider called `default`, which
 * is how a first run needs no file at all. A `FACIO_MODEL` with no slash names a model of `default`.
 */
export function loadConfig(args: { cwd: string; env?: NodeJS.ProcessEnv; path?: string }): PapoConfig {
  const env = args.env ?? process.env;
  const resolved = resolveConfig({ name: 'papo', base: BASE, cwd: args.cwd, env, ...(args.path !== undefined ? { path: args.path } : {}) });
  try {
    check(resolved.values, SCHEMA, 'config');
  } catch (error: unknown) {
    if (!(error instanceof ArgumentError)) throw error;
    const files = resolved.layers.filter((layer) => layer.kind !== 'base').map((layer) => layer.path);
    throw new ConfigurationError(`${error.message}${files.length > 0 ? ` (read: ${files.join(', ')})` : ''}`);
  }
  const config = structuredClone(resolved.values) as unknown as PapoConfig;

  // `PAPO_*` over `FACIO_*`: the family's variables (what the examples read) reach papo too.
  const variable = (name: string): string | undefined => {
    const own = env[`PAPO_${name}`];
    const family = env[`FACIO_${name}`];
    return own !== undefined && own !== '' ? own : family !== undefined && family !== '' ? family : undefined;
  };
  const baseUrl = variable('BASE_URL');
  if (baseUrl !== undefined) {
    const apiKey = variable('API_KEY');
    const fromEnv: ProviderConfig = { id: 'default', baseUrl, ...(apiKey !== undefined ? { apiKey } : {}) };
    config.providers = [fromEnv, ...config.providers.filter((provider) => provider.id !== 'default')];
  }
  const model = variable('MODEL');
  if (model !== undefined) config.model = model.includes('/') ? model : `default/${model}`;
  return config;
}

export function providersOf(config: PapoConfig): ModelProvider[] {
  return config.providers.map((provider) => openaiCompatProvider({
    name: provider.id,
    baseUrl: provider.baseUrl,
    ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
    ...(provider.headers !== undefined ? { headers: provider.headers } : {}),
  }));
}

/** `<providerId>/<modelId>` split at the first slash; the model id may hold slashes of its own. */
export function splitModel(ref: string): { provider: string; modelId: string } {
  const at = ref.indexOf('/');
  if (at <= 0 || at === ref.length - 1) {
    throw new AgentError({ code: 'invalid_options', message: `model "${ref}" must be written <provider>/<model>` });
  }
  return { provider: ref.slice(0, at), modelId: ref.slice(at + 1) };
}

/** The provider a model ref names, faulted by name when there is none. */
export function providerFor(providers: ModelProvider[], config: PapoConfig, ref: string): { provider: ModelProvider; modelId: string } {
  const { provider: id, modelId } = splitModel(ref);
  const index = config.providers.findIndex((provider) => provider.id === id);
  const provider = providers[index];
  if (index === -1 || provider === undefined) {
    const known = config.providers.map((one) => one.id);
    throw new AgentError({
      code: 'invalid_options',
      message: known.length === 0
        ? `no provider is configured: set PAPO_BASE_URL or add one to ~/.config/papo/config.json`
        : `model "${ref}" names provider "${id}"; configured: ${known.join(', ')}`,
    });
  }
  return { provider, modelId };
}
