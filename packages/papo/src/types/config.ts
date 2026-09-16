import type { Limits, ModelParams } from '@facio/agents';
import type { Reasoning } from './settings.js';

/** One Chat Completions endpoint papo may talk to. */
export interface ProviderConfig {
  /** How the model string names it: `<id>/<modelId>`. */
  id: string;
  /** e.g. `http://localhost:1234/v1` or `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * When a tool call stops to ask.
 *
 * `destructive` is the harness default: a tool that declares `effects.destructive` waits for approval.
 * `ask` waits on every tool; `auto` never waits.
 */
export type PermissionMode = 'ask' | 'destructive' | 'auto';

/** The search backends `web_search` may use, asked in this order: brave, tavily, duckduckgo. */
export interface SearchConfig {
  brave?: { apiKey: string };
  tavily?: { apiKey: string };
  /** The HTML results page, scraped; no key. */
  duckduckgo?: boolean;
}

/** How much conversation a request may carry, and whether papo folds it before that runs out. */
export interface ContextConfig {
  /** Tokens for the instructions and the history, as the harness estimates them; default 32 000. */
  maxTokens: number;
  /** New sessions start with auto-compaction on; each session may switch it. Compaction runs at 80% of `maxTokens`. */
  autoCompact: boolean;
}

/** Which `@facio/tools` capabilities the agent gets; all on by default. */
export interface ToolsConfig {
  files: boolean;
  shell: boolean;
  /** `true` is `web_fetch` alone; an object adds `web_search` over its providers. */
  web: boolean | { search?: SearchConfig };
  /** Files under `<home>/memory/<workspace slug>/`. */
  memory: boolean;
}

/** What runs the conversation: the harness in this process, or Claude Code's runtime through its SDK. */
export type Backend = 'facio' | 'claude';

/** `~/.config/papo/config.json`, `.papo.json`, `PAPO_CONFIG`, `--config`, and the `PAPO_*` variables, merged. */
export interface PapoConfig {
  backend: Backend;
  providers: ProviderConfig[];
  /** `<providerId>/<modelId>`; the first listed model of the first provider when absent. */
  model?: string;
  permissions: PermissionMode;
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
