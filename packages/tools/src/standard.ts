import type { Capability, JsonSchema } from '@cofold/agents';
import type { SearchConfig, ToolsConfig } from './types/standard.js';
import type { SearchProvider } from './types/web.js';
import { files } from './files.js';
import { shell } from './shell.js';
import { web } from './web.js';
import { memory } from './memory.js';
import { brave } from './search/brave.js';
import { tavily } from './search/tavily.js';
import { duckduckgo } from './search/duckduckgo.js';

/** The `tools` section of a program's configuration file, as papo wrote it (decision 123). */
export const TOOLS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    files: {
      anyOf: [
        { type: 'boolean' },
        {
          type: 'object',
          properties: { requireRead: { type: 'boolean' } },
          additionalProperties: false,
        },
      ],
    },
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
};

/**
 * The standard capabilities a program's `tools` section asks for (decision 123), in the order files, shell,
 * web, memory: a key that is absent is on, `false` turns one off, and search providers are asked in the order
 * the configuration writes them. Memory is left out unless the caller gives it a folder.
 *
 * The `args` object places the run: `workspace` is the folder it will be in, which the file and shell
 * capabilities read from the run itself rather than from here, and `memoryDir` is the memory folder.
 */
export function standardCapabilities(config: ToolsConfig, args: { workspace: string; memoryDir?: string }): Capability[] {
  return [
    ...(config.files !== false ? [files(config.files === true ? undefined : config.files)] : []),
    ...(config.shell !== false ? [shell()] : []),
    ...(config.web !== false ? [web({ search: searchProviders(config.web === true ? undefined : config.web?.search) })] : []),
    ...(config.memory !== false && args.memoryDir !== undefined ? [memory({ dir: args.memoryDir })] : []),
  ];
}

/** The providers the configuration lists, in the order of its keys (decision 123). */
function searchProviders(search: SearchConfig | undefined): SearchProvider[] {
  if (search === undefined) return [];
  const providers: SearchProvider[] = [];
  for (const key of Object.keys(search) as (keyof SearchConfig)[]) {
    if (key === 'brave' && search.brave !== undefined) providers.push(brave({ apiKey: search.brave.apiKey }));
    else if (key === 'tavily' && search.tavily !== undefined) providers.push(tavily({ apiKey: search.tavily.apiKey }));
    else if (key === 'duckduckgo' && search.duckduckgo === true) providers.push(duckduckgo());
  }
  return providers;
}
