import type { Capability } from './capability.js';
import type { Hooks, RunInfo } from './hooks.js';
import type { Limits } from './limits.js';
import type { ModelAdapter, ModelParams } from './model.js';
import type { Store } from './store.js';
import type { Tool } from './tool.js';

export interface ContextOptions {
  /** Budget for instructions + history; default 32_000. */
  maxTokens?: number;
  /** Default: Math.ceil(text.length / 4). */
  estimateTokens?(text: string): number;
}

/**
 * The run-level authorization floor (decision 46). A hook may escalate above it, never below.
 * `Tool<any, any>` (decision 67): execute's input is contravariant, so a typed `Tool<{ text: string }>` is not a `Tool`.
 */
export interface Policy {
  requireApproval(args: { tool: Tool<any, any>; input: unknown; run: RunInfo }): boolean | Promise<boolean>;
}

export interface AgentOptions<Resources = Record<string, unknown>> {
  id: string;
  instructions: string;
  model: ModelAdapter;
  tools?: Tool<any, Resources>[];
  /** Resolved per run; see types/capability.ts. Duplicate ids → invalid_options at createAgent. */
  capabilities?: Capability[];
  store?: Store;
  hooks?: Hooks;
  /** Default: approval required when tool.effects.destructive is true. */
  policy?: Partial<Policy>;
  limits?: Partial<Limits>;
  context?: ContextOptions;
  params?: ModelParams;
  resources?: Resources;
  /** Namespace for the shared kv scope; default 'default' (decision 51). */
  sharedNamespace?: string;
  /** Where one-time warnings go; default console.warn (decision 50). */
  warn?: (message: string) => void;
}

/** Serializable view; what an adapter advertises. */
export interface AgentDefinition {
  id: string;
  instructions: string;
  model: { id: string; modelId: string };
  /** Names of AgentOptions.tools only; capability tools are per run and appear in the model step's request. */
  tools: string[];
  /** The deferred ones among `tools`. */
  deferred: string[];
  capabilities: string[];
  limits: Limits;
  context: { maxTokens: number };
}

/**
 * What createAgent() returns: every option resolved, defaults filled, frozen.
 * A value, not an actor. run({ agent, ... }) executes it.
 */
export interface Agent<Resources = Record<string, unknown>> {
  readonly definition: AgentDefinition;
  readonly model: ModelAdapter;
  readonly tools: ReadonlyMap<string, Tool<any, Resources>>;
  readonly capabilities: readonly Capability[];
  readonly store: Store;
  readonly hooks: Hooks;
  readonly policy: Policy;
  readonly limits: Limits;
  readonly context: Required<ContextOptions>;
  readonly params: ModelParams;
  readonly resources: Resources;
  readonly sharedNamespace: string;
  readonly warn: (message: string) => void;
}
