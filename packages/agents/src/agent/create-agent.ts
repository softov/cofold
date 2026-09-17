import type { Agent, AgentDefinition, AgentOptions, Policy, ResolvedContext } from '../types/agent.js';
import type { Capability } from '../types/capability.js';
import type { Limits } from '../types/limits.js';
import type { Tool } from '../types/tool.js';
import { AgentError } from '../errors.js';
import { DEFAULT_DECIDE } from '../policy/rules.js';
import { createMemoryStore } from '../store/memory.js';
import { DEFAULT_LIMITS } from './limits.js';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
// Function property, not a method: Required<ContextOptions> demands a value for estimateTokens.
// `compactKeepTokens` is filled per agent: its default is a share of the resolved maxTokens (cli/03 F1).
const DEFAULT_CONTEXT: Omit<ResolvedContext, 'compactKeepTokens'> = {
  maxTokens: 32_000,
  estimateTokens: (text) => Math.ceil(text.length / 4),
};
const DEFAULT_POLICY: Policy = { decide: DEFAULT_DECIDE };

let warnedMemoryStore = false;

export function createAgent<Resources = Record<string, unknown>>(options: AgentOptions<Resources>): Agent<Resources> {
  if (!ID_PATTERN.test(options.id)) {
    throw new AgentError({ code: 'invalid_options', message: `agent id "${options.id}" must match ${ID_PATTERN}` });
  }
  if (typeof options.instructions !== 'string' || !options.instructions.trim()) {
    throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}" needs instructions` });
  }
  if (!options.model || typeof options.model.complete !== 'function') {
    throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}" needs a model adapter` });
  }

  const tools = new Map<string, Tool<any, Resources>>();
  for (const tool of options.tools ?? []) {
    if (tools.has(tool.name)) {
      throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": duplicate tool "${tool.name}"` });
    }
    tools.set(tool.name, tool);
  }

  const capabilities: Capability[] = [];
  const capabilityIds = new Set<string>();
  for (const cap of options.capabilities ?? []) {
    if (!ID_PATTERN.test(cap.id)) {
      throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": capability id "${cap.id}" must match ${ID_PATTERN}` });
    }
    if (capabilityIds.has(cap.id)) {
      throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": duplicate capability "${cap.id}"` });
    }
    capabilityIds.add(cap.id);
    capabilities.push(cap);
  }

  const warn = options.warn ?? ((message: string) => console.warn(message));
  let store = options.store;
  if (!store) {
    store = createMemoryStore();
    if (!warnedMemoryStore) {
      warnedMemoryStore = true;
      warn(`@facio/agents: agent "${options.id}" has no store; using an in-memory store (nothing persists). Pass store: createFileStore(...) for anything but tests.`);
    }
  }

  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  const merged = { ...DEFAULT_CONTEXT, ...options.context };
  const context: ResolvedContext = { ...merged, compactKeepTokens: merged.compactKeepTokens ?? Math.floor(merged.maxTokens / 5) };
  if (context.autoCompactTokens !== undefined && context.autoCompactTokens <= 0) {
    throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": context.autoCompactTokens must be positive` });
  }
  if (context.compactKeepTokens < 0) {
    throw new AgentError({ code: 'invalid_options', message: `agent "${options.id}": context.compactKeepTokens must not be negative` });
  }
  const policy: Policy = { ...DEFAULT_POLICY, ...options.policy };
  const definition: AgentDefinition = {
    id: options.id,
    instructions: options.instructions,
    model: { id: options.model.id, modelId: options.model.modelId },
    tools: [...tools.keys()],
    deferred: [...tools.values()].filter((tool) => tool.deferred === true).map((tool) => tool.name),
    capabilities: [...capabilityIds],
    limits,
    context: { maxTokens: context.maxTokens },
  };

  return Object.freeze({
    definition,
    model: options.model,
    tools,
    capabilities,
    store,
    hooks: options.hooks ?? {},
    policy,
    limits,
    context,
    params: options.params ?? {},
    resources: (options.resources ?? {}) as Resources,
    sharedNamespace: options.sharedNamespace ?? 'default',
    warn,
  });
}
