import type { Agent, ModelProvider, Policy, Store, Tool } from '@facio/agents';
import { createAgent, createAskUserTool, skills } from '@facio/agents';
import { fileSkillSource } from '@facio/store-file';
import type { PapoConfig, PermissionMode } from './types/config.js';
import type { Settings } from './types/settings.js';

export const AGENT_ID = 'papo';

export interface AgentArgs {
  config: PapoConfig;
  settings: Settings;
  provider: ModelProvider;
  modelId: string;
  store: Store;
  /** `<root>` of the file store: global skills live under `<root>/skills`. */
  home: string;
  /** The system prompt, already joined with the workspace's AGENTS.md. */
  instructions: string;
  /** Beyond `ask_user`; a `--demo-tools` flag or a later plugin adds them. */
  tools?: Tool<any, any>[];
  warn(message: string): void;
}

/** The permission mode as the run-level authorization floor. */
export function policyOf(mode: PermissionMode): Partial<Policy> {
  switch (mode) {
    case 'ask': return { requireApproval: () => true };
    case 'auto': return { requireApproval: () => false };
    case 'destructive': return {};
  }
}

/**
 * The agent, as a value: rebuilt from the configuration for every turn, so a model or permission
 * change between two messages is honest without a session having to be reopened.
 */
export function buildAgent(args: AgentArgs): Agent {
  const { config, settings } = args;
  const params = {
    ...config.params,
    ...(settings.reasoning === 'off' ? {} : { reasoning: { effort: settings.reasoning } }),
  };
  return createAgent({
    id: AGENT_ID,
    instructions: args.instructions,
    model: args.provider.model({ id: args.modelId, params }),
    tools: [createAskUserTool(), ...(args.tools ?? [])],
    capabilities: [skills({ sources: [fileSkillSource({ root: args.home })], warn: args.warn })],
    store: args.store,
    policy: policyOf(settings.permissions),
    ...(config.limits !== undefined ? { limits: config.limits } : {}),
    warn: args.warn,
  });
}
