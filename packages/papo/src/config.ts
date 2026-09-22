import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ModelProvider } from '@doopx/agents';
import { AgentError } from '@doopx/agents';
import { ArgumentError, ConfigurationError, check } from '@doopx/commands';
import { resolveConfig } from '@doopx/config';
import { openaiCompatProvider } from '@doopx/model-openai-compat';
import type { JsonSchema } from '@doopx/sdk';
import type { PapoConfig, ProviderConfig, RememberedSettings } from './types/config.js';

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

/** One permission rule as the file writes it: the tool (or `*`) and the glob over its subject (decision 117). */
const RULE: JsonSchema = {
  type: 'object',
  properties: { tool: { type: 'string', minLength: 1 }, match: { type: 'string', minLength: 1 } },
  required: ['tool'],
  additionalProperties: false,
};

/** The file's shape; `check` turns the first problem into a sentence naming the key. */
const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    backend: { type: 'string', enum: ['facio', 'claude'] },
    providers: { type: 'array', items: PROVIDER },
    model: { type: 'string', minLength: 1 },
    permissions: { type: 'string', enum: ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk'] },
    rules: {
      type: 'object',
      properties: { deny: { type: 'array', items: RULE }, ask: { type: 'array', items: RULE }, allow: { type: 'array', items: RULE } },
      additionalProperties: false,
    },
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
    context: {
      type: 'object',
      properties: {
        maxTokens: { type: 'integer', minimum: 1000 },
        autoCompact: { type: 'boolean' },
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
  backend: 'facio', providers: [], permissions: 'default', reasoning: 'off', instructions: DEFAULT_INSTRUCTIONS,
  tools: { files: true, shell: true, web: true, memory: true },
  context: { maxTokens: 32_000, autoCompact: true },
  theme: 'paper', shell: 'workbench',
} as const;

/**
 * The configuration, from every place it may be written.
 *
 * `@doopx/config` walks the layers (`~/.config/papo/config.json`, the nearest `.papo.json`,
 * `$PAPO_CONFIG`, `--config`); on top of them `PAPO_BASE_URL`, `PAPO_API_KEY` and `PAPO_MODEL` (or the
 * family's `FACIO_*`, which the examples read too) add or replace a provider called `default`, which
 * is how a first run needs no file at all. A `FACIO_MODEL` with no slash names a model of `default`.
 * `PAPO_BACKEND` picks the runtime.
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
  const backend = env['PAPO_BACKEND'];
  if (backend !== undefined && backend !== '') {
    if (backend !== 'facio' && backend !== 'claude') throw new ConfigurationError(`PAPO_BACKEND must be facio or claude, not "${backend}"`);
    config.backend = backend;
  }
  return config;
}

/** `~/.config/papo/config.json`, `$XDG_CONFIG_HOME` honoured: where a field no file sets is written. */
export function userConfigPath(env: NodeJS.ProcessEnv, home = homedir()): string {
  return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'papo', 'config.json');
}

/** The indentation a JSON file uses (its first indented line), two spaces when it has none. */
export function indentOf(text: string): string {
  const indented = /^([ \t]+)\S/mu.exec(text);
  return indented?.[1] ?? '  ';
}

/**
 * Writes each field of `patch` into the file that currently sets it, else the user file (decision CLI-05.1).
 * `model: ''` is skipped (unset is not a choice). Returns the files written, in order.
 *
 * The layers are resolved again with the arguments `loadConfig` had, so the file found is the one that was read;
 * the base layer (`(defaults)`) is not a file, and a field it alone sets goes to the user file like an unset one.
 */
export async function rememberConfig(args: { cwd: string; env?: NodeJS.ProcessEnv; path?: string; patch: RememberedSettings }): Promise<string[]> {
  const env = args.env ?? process.env;
  const fields = (Object.entries(args.patch) as [keyof RememberedSettings, string | undefined][])
    .filter((entry): entry is [keyof RememberedSettings, string] => entry[1] !== undefined && !(entry[0] === 'model' && entry[1] === ''));
  if (fields.length === 0) return [];
  const resolved = resolveConfig({ name: 'papo', base: BASE, cwd: args.cwd, env, ...(args.path !== undefined ? { path: args.path } : {}) });
  const files = new Map<string, Record<string, string>>();
  for (const [field, value] of fields) {
    const source = resolved.sourceOf(field);
    const target = source !== undefined && resolved.layers.some((layer) => layer.path === source && layer.kind !== 'base') ? source : userConfigPath(env);
    const held = files.get(target) ?? {};
    held[field] = value;
    files.set(target, held);
  }
  for (const [target, values] of files) {
    let text: string | undefined;
    try {
      text = await readFile(target, 'utf8');
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      await mkdir(dirname(target), { recursive: true });
    }
    let json: Record<string, unknown> = {};
    if (text !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch (error: unknown) {
        throw new ConfigurationError(`${target} is not valid JSON: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ConfigurationError(`${target} is not an object, so it is not a configuration file`);
      json = parsed as Record<string, unknown>;
    }
    Object.assign(json, values);
    await writeFile(target, JSON.stringify(json, null, text === undefined ? '  ' : indentOf(text)) + (text === undefined || text.endsWith('\n') ? '\n' : ''), 'utf8');
  }
  return [...files.keys()];
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
