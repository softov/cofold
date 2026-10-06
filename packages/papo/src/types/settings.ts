import type { EffortLevel } from '@cofold/agents';
import { EFFORT_LEVELS, PERMISSION_MODES as HARNESS_PERMISSION_MODES } from '@cofold/agents';
import type { PermissionMode, RuleLists } from './config.js';

/** How much the model thinks before it answers; `off` sends no reasoning request at all. The levels are the harness's (agent/06). */
export type Reasoning = EffortLevel;

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

/** The four of the harness's modes papo offers (cli/03 F8), taken in the harness's order; `plan` and `auto` wait for a later plan. */
const OFFERED_MODES: ReadonlySet<string> = new Set<PermissionMode>(['default', 'acceptEdits', 'bypassPermissions', 'dontAsk']);
export const PERMISSION_MODES: readonly PermissionMode[] = HARNESS_PERMISSION_MODES.filter((mode): mode is PermissionMode => OFFERED_MODES.has(mode));

/** The levels papo offers, which are the harness's, `off` first. */
export const REASONING_LEVELS: readonly Reasoning[] = EFFORT_LEVELS;
