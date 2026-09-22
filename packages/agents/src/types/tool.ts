import type { KvScope } from './store.js';
import type { JsonSchema } from '@cofold/sdk';

export interface ToolEffects {
  reads?: boolean;
  writes?: boolean;
  network?: boolean;
  destructive?: boolean;
}

export interface ToolContext<Resources = Record<string, unknown>> {
  agentId: string;
  sessionId: string;
  runId: string;
  callId: string;
  /** Stable across retries of the same execution attempt; the step-log key. */
  invocationId: string;
  signal: AbortSignal;
  /** `workspace` is present only when the session has a workspace (SessionRecord.workspace). */
  kv: { agent: KvScope; shared: KvScope; workspace?: KvScope };
  /** Host-provided; credentials and handles live here, never in messages. */
  resources: Resources;
}

export type ToolOutput = string | { content: string; detail?: unknown };

/** Positional on purpose (decision 38): `(input) => ...` covers most tools; `ctx` is there when needed. */
export type ToolExecute<Input = unknown, Resources = Record<string, unknown>> =
  (input: Input, ctx: ToolContext<Resources>) => ToolOutput | Promise<ToolOutput>;

export interface ToolDefinition<Input = unknown, Resources = Record<string, unknown>> {
  name: string;
  description: string;
  input: JsonSchema;
  effects?: ToolEffects;
  /**
   * What a permission rule's `match` is checked against (decision 117): the command for a shell tool,
   * the path for a file tool. Absent: rules on this tool match by name only.
   */
  subject?(input: Input): string;
  /**
   * Known to the model by name and one line only, until it loads the definition with `load_tools`
   * or a run's session has loaded it before (AGENT-02). A capability's `defer` sets it wholesale.
   */
  deferred?: boolean;
  execute: ToolExecute<Input, Resources>;
}

/** Result of createTool(): the definition with effects filled and the schema pre-validated. */
export interface Tool<Input = unknown, Resources = Record<string, unknown>> extends ToolDefinition<Input, Resources> {
  effects: ToolEffects;
  /**
   * Who owns the tool (spec: a registry must not erase ownership). createTool sets 'agent';
   * run() re-stamps tools contributed by a capability with that capability's id (parent decision 31).
   */
  source: string;
  /** What an adapter sends to the model. */
  toModelDefinition(): ModelToolDefinition;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  input: JsonSchema;
}
