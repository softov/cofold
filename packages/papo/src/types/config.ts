import type { Limits, ModelParams, RulesOptions } from '@cofold/agents';
import type { ProviderConfig } from '@cofold/model-openai-compat';
import type { SearchConfig, ToolsConfig } from '@cofold/tools';
import type { Reasoning, Settings } from './settings.js';

/** The provider entry, the search backends and the tools section are the library's shapes (decision 123). */
export type { ProviderConfig, SearchConfig, ToolsConfig };

/**
 * When a tool call stops to ask: Claude Code's modes (cli/03 F8), as papo's policy reads them.
 *
 * `default`: a tool that only reads (or declares no effect) runs, one that writes, destroys or reaches the network asks.
 * `acceptEdits`: as `default`, and `write_file` / `edit_file` inside the workspace run unasked (decision CLI-04.6).
 * `bypassPermissions`: everything runs; a deny or ask rule still wins.
 * `dontAsk`: as `default`, but what would ask is denied instead.
 * `plan` (a prompt-level mode in Claude) waits for a later plan; `auto` (a classifier behind a flag) is not offered.
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';

/**
 * Rule lists for `rules()` (`@cofold/agents`, decision 117), as the configuration and a session's settings hold them
 * (decision CLI-04.5): `deny`, then `ask`, then `allow`; a rule is `{ tool, match? }`, the glob over the tool's subject.
 */
export type RuleLists = Pick<RulesOptions, 'deny' | 'ask' | 'allow'>;

/** How much conversation a request may carry, and whether papo folds it before that runs out. */
export interface ContextConfig {
  /** Tokens for the instructions and the history, as the harness estimates them; default 32 000. */
  maxTokens: number;
  /** New sessions start with auto-compaction on; each session may switch it. Compaction runs at 80% of `maxTokens`. */
  autoCompact: boolean;
}

/** What runs the conversation: the harness in this process, or Claude Code's runtime through its SDK. */
export type Backend = 'cofold' | 'claude';

/** `~/.config/papo/config.json`, `.papo.json`, `PAPO_CONFIG`, `--config`, and the `PAPO_*` variables, merged. */
export interface PapoConfig {
  backend: Backend;
  providers: ProviderConfig[];
  /** `<providerId>/<modelId>`; the first listed model of the first provider when absent. */
  model?: string;
  permissions: PermissionMode;
  /** Rules every session runs under, after its own (decision CLI-04.5). */
  rules?: RuleLists;
  /** The thinking level new sessions start with. */
  reasoning: Reasoning;
  /** The system prompt. `<workspace>/AGENTS.md` is appended when present. */
  instructions: string;
  limits?: Partial<Limits>;
  /** Sampling; `reasoning` is a setting, not a param, so it is not here. */
  params?: Omit<ModelParams, 'reasoning'>;
  tools: ToolsConfig;
  context: ContextConfig;
  /** The textui theme and shell the screen opens with. */
  theme: string;
  shell: string;
}

/** The fields a person's choice is written back as (decision CLI-05.1). */
export type RememberedSettings = Partial<Pick<Settings, 'model' | 'permissions' | 'reasoning'>>;
