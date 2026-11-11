import type { McpServerConfig } from './types.js';

/**
 * `${VAR}` and `${VAR:-default}` in a server's `command`, `args`, `env`, `url` and `headers`, as Claude Code expands
 * them. A name that is unset and has no default stays as written, and `unset` hears of it.
 */
export function expandServer(server: McpServerConfig, env: NodeJS.ProcessEnv, unset: (name: string) => void): McpServerConfig {
  const text = (value: string): string => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name: string, fallback: string | undefined) => {
    const value = env[name];
    if (value !== undefined) return value;
    if (fallback !== undefined) return fallback;
    unset(name);
    return whole;
  });
  const map = (values: Record<string, string> | undefined): Record<string, string> | undefined =>
    values === undefined ? undefined : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, text(value)]));
  if (server.type === 'http') {
    const headers = map(server.headers);
    return { ...server, url: text(server.url), ...(headers !== undefined ? { headers } : {}) };
  }
  const env2 = map(server.env);
  return { ...server, command: text(server.command), ...(server.args !== undefined ? { args: server.args.map(text) } : {}), ...(env2 !== undefined ? { env: env2 } : {}) };
}
