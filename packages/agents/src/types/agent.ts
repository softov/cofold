import type { Capability } from './capability.js';
import type { Hooks } from './hooks.js';
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

export interface AgentOptions<Resources = Record<string, unknown>> {
  id: string;
  instructions: string;
  model: ModelAdapter;
  tools?: Tool<any, Resources>[];
  /** Resolved per run; see types/capability.ts. Duplicate ids → invalid_options at createAgent. */
  capabilities?: Capability[];
  store?: Store;
  hooks?: Hooks;
  limits?: Partial<Limits>;
  context?: ContextOptions;
  params?: ModelParams;
  resources?: Resources;
}

/** Serializable view; what an adapter advertises. */
export interface AgentDefinition {
  id: string;
  instructions: string;
  model: { id: string; modelId: string };
  /** Names of AgentOptions.tools only; capability tools are per run and appear in the model step's request. */
  tools: string[];
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
  readonly limits: Limits;
  readonly context: Required<ContextOptions>;
  readonly params: ModelParams;
  readonly resources: Resources;
}
