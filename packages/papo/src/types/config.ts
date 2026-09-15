import type { Limits, ModelParams } from '@facio/agents';

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

/** `~/.config/papo/config.json`, `.papo.json`, `PAPO_CONFIG`, `--config`, and the `PAPO_*` variables, merged. */
export interface PapoConfig {
  providers: ProviderConfig[];
  /** `<providerId>/<modelId>`; the first listed model of the first provider when absent. */
  model?: string;
  permissions: PermissionMode;
  /** The system prompt. `<workspace>/AGENTS.md` is appended when present. */
  instructions: string;
  limits?: Partial<Limits>;
  params?: ModelParams;
  /** The textui theme and shell the screen opens with. */
  theme: string;
  shell: string;
}
