import type { JsonSchema } from '@cofold/agents';
import type { McpServerConfig } from './types.js';

/**
 * `mcpServers` in a configuration: an object of entries by name, as Claude Code's `.mcp.json` holds them. Each entry
 * is checked by `serversOf`, since a schema here cannot describe the values of a map.
 */
export const MCP_SERVERS_SCHEMA: JsonSchema = { type: 'object' };

const COMMON = ['enabled', 'startupTimeoutSec', 'toolTimeoutSec'];
const STDIO = new Set(['type', 'command', 'args', 'env', 'cwd', ...COMMON]);
const HTTP = new Set(['type', 'url', 'headers', ...COMMON]);

/**
 * The entries of an `mcpServers` object that are well formed, by name; `wrong` hears of each one left out and why.
 * An entry with `url` and no `type` is wrong, as in Claude Code.
 */
export function serversOf(value: unknown, wrong: (name: string, why: string) => void): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  if (!isRecord(value)) return out;
  for (const [name, entry] of Object.entries(value)) {
    const why = problemOf(entry);
    if (why !== undefined) { wrong(name, why); continue; }
    out[name] = entry as McpServerConfig;
  }
  return out;
}

function problemOf(entry: unknown): string | undefined {
  if (!isRecord(entry)) return 'not an object';
  const type = entry['type'];
  if (type === 'http') {
    if (typeof entry['url'] !== 'string' || entry['url'] === '') return 'an http server needs a url';
    if (entry['headers'] !== undefined && !isStringMap(entry['headers'])) return 'headers must map names to strings';
    return extraOf(entry, HTTP) ?? commonProblem(entry);
  }
  if (type !== undefined && type !== 'stdio') return `type ${JSON.stringify(type)} is not stdio or http`;
  if (entry['url'] !== undefined) return 'a url needs "type": "http"';
  if (typeof entry['command'] !== 'string' || entry['command'] === '') return 'a stdio server needs a command';
  if (entry['args'] !== undefined && !(Array.isArray(entry['args']) && entry['args'].every((one) => typeof one === 'string'))) return 'args must be strings';
  if (entry['env'] !== undefined && !isStringMap(entry['env'])) return 'env must map names to strings';
  if (entry['cwd'] !== undefined && typeof entry['cwd'] !== 'string') return 'cwd must be a string';
  return extraOf(entry, STDIO) ?? commonProblem(entry);
}

function commonProblem(entry: Record<string, unknown>): string | undefined {
  if (entry['enabled'] !== undefined && typeof entry['enabled'] !== 'boolean') return 'enabled must be true or false';
  for (const key of ['startupTimeoutSec', 'toolTimeoutSec']) {
    const value = entry[key];
    if (value !== undefined && !(typeof value === 'number' && value > 0)) return `${key} must be a number above 0`;
  }
  return undefined;
}

function extraOf(entry: Record<string, unknown>, known: Set<string>): string | undefined {
  const extra = Object.keys(entry).find((key) => !known.has(key));
  return extra !== undefined ? `${extra} is not a key of this server type` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((one) => typeof one === 'string');
}
