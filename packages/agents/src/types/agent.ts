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
  /**
   * Compact before a model step when the history since the newest summary is estimated above this
   * many tokens (AGENT-01-p5 Task 6). Absent: never; `compact()` is then the only way.
   */
  autoCompactTokens?: number;
  /** Newest messages kept verbatim after a summary, estimated; default 20% of maxTokens. 0 keeps nothing (cli/03 F1). */
  compactKeepTokens?: number;
}

/** `ContextOptions` with the defaults filled; what `Agent.context` holds. */
export interface ResolvedContext {
  maxTokens: number;
  estimateTokens(text: string): number;
  autoCompactTokens?: number;
  compactKeepTokens: number;
}

/** What the policy says about one call (cli/03 F3). `reason` is what the model and the person read on a deny. */
export interface PolicyDecision {
  behavior: 'allow' | 'ask' | 'deny';
  reason?: string;
}

/**
 * The run-level authorization policy (decisions 46, 119; cli/03 F3). A hook runs first and may raise a call to `ask`
 * or refuse it; the policy then decides on the possibly modified input, and its `deny` wins over the hook.
 * `Tool<any, any>` (decision 67): execute's input is contravariant, so a typed `Tool<{ text: string }>` is not a `Tool`.
 */
export interface Policy {
  decide(args: { tool: Tool<any, any>; input: unknown; run: RunInfo }): PolicyDecision | Promise<PolicyDecision>;
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
  /** Default: ask when tool.effects.destructive is true, allow otherwise (cli/03 F3). */
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
  readonly context: ResolvedContext;
  readonly params: ModelParams;
  readonly resources: Resources;
  readonly sharedNamespace: string;
  readonly warn: (message: string) => void;
}
