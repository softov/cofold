import type { PermissionMode, RuleLists } from './config.js';

/** How much the model thinks before it answers; `off` sends no reasoning request at all. */
export type Reasoning = 'off' | 'low' | 'medium' | 'high';

/**
 * What a session runs with, and what the composer's chips show and change.
 *
 * Kept per session in the workspace kv scope, defaulted from the configuration. Changing one between
 * two messages is honest because the agent is rebuilt for every turn.
 */
export interface Settings {
  /** `<providerId>/<modelId>`; empty means the first model the first provider lists, asked when a turn starts. */
  model: string;
  permissions: PermissionMode;
  /** The session's own rules, evaluated before the configuration's (decision CLI-04.5); `always` on a confirmation adds to `allow`. */
  rules?: RuleLists;
  reasoning: Reasoning;
  /** Fold the conversation into a summary before a turn once it nears the context budget (`/compact` does it by hand). */
  autoCompact: boolean;
}

export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk'];
export const REASONING_LEVELS: readonly Reasoning[] = ['off', 'low', 'medium', 'high'];
