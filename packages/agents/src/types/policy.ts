import type { Policy } from './agent.js';
import type { Tool } from './tool.js';

/** One permission rule (decision 117): a tool name or `*`, and an optional glob over the tool's subject. */
export interface Rule {
  tool: string;
  match?: string;
}

/** What `rules()` takes: the lists are evaluated `deny`, then `ask`, then `allow` (decision 117). */
export interface RulesOptions {
  deny?: Rule[];
  ask?: Rule[];
  allow?: Rule[];
  /** Decides when no rule matches; default: ask when destructive, allow otherwise (agent/04 task 01). */
  otherwise?: Policy['decide'];
}

/**
 * The modes a host may offer as an approvals setting.
 *
 * The four Claude Code names a person already knows, kept with their meaning, plus `plan` and
 * `auto`: a mode is what decides when no rule matches, so it is the harness's own vocabulary
 * rather than a surface's, and two hosts that offer it offer the same thing.
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions' | 'dontAsk';

/**
 * The two facts a mode needs from the host.
 *
 * A tool's effects travel with it, but where a session works and which of its tools count as
 * edits are the host's to say: a CLI's file tools are not a host tool registry's, and the
 * directory is the one the session was opened in.
 */
export interface PermissionModeRules {
  /** Whether a path an edit names stays inside the workspace the session works in. */
  inside(path: string): boolean;
  /** Whether a tool is one `acceptEdits` lets through when its target is inside. */
  isEdit(tool: Tool<any, any>): boolean;
}
