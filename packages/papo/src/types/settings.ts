import type { PermissionMode } from './config.js';

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
  reasoning: Reasoning;
}

export const PERMISSION_MODES: readonly PermissionMode[] = ['destructive', 'ask', 'auto'];
export const REASONING_LEVELS: readonly Reasoning[] = ['off', 'low', 'medium', 'high'];
