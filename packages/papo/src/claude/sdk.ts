import type * as sdk from '@anthropic-ai/claude-agent-sdk';
import { AgentError } from '@doopx/agents';

/** The optional peer: what `createClaudeChat` needs of `@anthropic-ai/claude-agent-sdk`. */
export type ClaudeSdk = typeof sdk;

/**
 * The SDK, imported lazily (the runtime caches the module): it is 5 MB plus a native CLI per platform
 * under Anthropic's licence, so papo carries it only where the claude backend is asked for.
 * `importer` is the seam a test uses to stand in for a missing package.
 */
export function loadClaudeSdk(importer: () => Promise<ClaudeSdk> = () => import('@anthropic-ai/claude-agent-sdk')): Promise<ClaudeSdk> {
  return importer().catch((error: unknown) => {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new AgentError({ code: 'invalid_options', message: 'install @anthropic-ai/claude-agent-sdk to use the claude backend' });
    }
    throw error;
  });
}
