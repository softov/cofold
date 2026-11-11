import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServerConfig } from '@cofold/mcp-client';
import { serversOf } from '@cofold/mcp-client';
import type { CopapoConfig } from './types/config.js';

/**
 * The MCP servers a workspace's turns get, by name: the configuration's `mcpServers`, then, in a trusted folder,
 * the workspace's `.mcp.json` (Claude Code's project file), whose entry replaces one of the same name. An entry
 * that is not well formed is left out, and `warn` says why.
 */
export function serversFor(args: { config: CopapoConfig; workspace: string; trusted: boolean; warn(message: string): void }): Record<string, McpServerConfig> {
  const wrong = (from: string) => (name: string, why: string): void => args.warn(`mcp server "${name}" in ${from} is left out: ${why}`);
  const servers = serversOf(args.config.mcpServers, wrong('the configuration'));
  if (!args.trusted) return servers;
  const file = join(args.workspace, '.mcp.json');
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return servers; }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; } catch (error: unknown) {
    args.warn(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return servers;
  }
  const project = typeof parsed === 'object' && parsed !== null ? (parsed as { mcpServers?: unknown }).mcpServers : undefined;
  return { ...servers, ...serversOf(project, wrong(file)) };
}

/** The servers in the Claude Agent SDK's shape: what it does not take is dropped, and a disabled one is left out. */
export function claudeServersOf(servers: Record<string, McpServerConfig>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (server.enabled === false) continue;
    out[name] = server.type === 'http'
      ? { type: 'http', url: server.url, ...(server.headers !== undefined ? { headers: server.headers } : {}) }
      : { type: 'stdio', command: server.command, ...(server.args !== undefined ? { args: server.args } : {}), ...(server.env !== undefined ? { env: server.env } : {}) };
  }
  return out;
}
