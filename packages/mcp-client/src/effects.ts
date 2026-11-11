import type { ToolEffects } from '@cofold/agents';
import type { McpToolAnnotations } from './types.js';

/**
 * A tool's effects from its hints, so the host's permission mode decides on them as on any tool.
 *
 * A tool that says `readOnlyHint: true` reads, and reaches the network only when it says `openWorldHint: true`, so a
 * read-only tool runs without asking in a mode that asks on writes. Any other tool writes; it destroys and reaches
 * the network unless its hints say `false`, as the spec's defaults have it.
 */
export function effectsOf(hints: McpToolAnnotations | undefined): ToolEffects {
  if (hints?.readOnlyHint === true) return { reads: true, ...(hints.openWorldHint === true ? { network: true } : {}) };
  return { writes: true, destructive: hints?.destructiveHint !== false, network: hints?.openWorldHint !== false };
}
