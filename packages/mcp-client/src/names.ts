import { createHash } from 'node:crypto';

/** The harness's limit on a tool name. */
const MAX = 64;

/**
 * `mcp__<server>__<tool>`, as Claude Code names a server's tools, inside the harness's `^[a-zA-Z0-9_-]{1,64}$`:
 * any other character becomes `_`, and a name past 64 characters keeps its first 57 and ends in `_` and six
 * characters of a hash of the whole name, so two long names stay two names.
 */
export function toolNameOf(server: string, tool: string): string {
  const name = `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (name.length <= MAX) return name;
  const hash = createHash('sha256').update(`${server}\u0000${tool}`).digest('hex').slice(0, 6);
  return `${name.slice(0, MAX - 7)}_${hash}`;
}
