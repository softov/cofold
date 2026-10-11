import type { Agent } from './agent.js';
import type { KvScope, Store } from './store.js';

/** What a runtime command's `run` reaches: the same as `CapabilityArgs`, plus the agent, the store and the typed arguments. */
export interface SlashCommandContext {
  agent: Agent<any>;
  sessionId: string;
  runId: string;
  workspace?: string;
  /** What follows the name on the typed line, as typed; empty when nothing does. */
  args: string;
  store: Store;
  kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
  signal: AbortSignal;
}

/**
 * A runtime command (AGENT-03): `/<name> args` runs as a turn with no model step. The typed line is written as a
 * `command` message and the text `run` returns as a `notice` message; neither reaches the model.
 */
export interface SlashCommand {
  /** Matches /^[a-z][a-z0-9_-]{0,63}$/; unique within an agent. */
  name: string;
  /** One line for a command menu. */
  description: string;
  /** What the arguments look like, for a menu; absent when the command takes none. */
  argumentHint?: string;
  /** The output text, or undefined to write no notice. A throw ends the run `failed`. */
  run(ctx: SlashCommandContext): Promise<string | undefined>;
}

/** A prompt command (AGENT-03): `/<name> args` is expanded into text the model reads, as a `skill` message. */
export interface PromptCommand {
  name: string;
  description: string;
  argumentHint?: string;
  /** The text the model reads for `/<name> args`. */
  expand(args: string): Promise<string>;
}

/** One entry of a command list, as a client shows it. */
export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  /** `runtime`: the harness runs it; `prompt`: the harness expands it for the model. */
  kind: 'runtime' | 'prompt';
}
