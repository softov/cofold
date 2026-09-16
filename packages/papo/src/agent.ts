import { join } from 'node:path';
import type { Agent, Capability, ModelProvider, Policy, SkillSource, Store, Tool } from '@facio/agents';
import { createAgent, createAskUserTool, skills } from '@facio/agents';
import { workspaceSlug } from '@facio/store-file';
import type { SearchProvider } from '@facio/tools';
import { brave, duckduckgo, files, memory, shell, tavily, web } from '@facio/tools';
import type { PapoConfig, PermissionMode, ToolsConfig } from './types/config.js';
import type { Settings } from './types/settings.js';

export const AGENT_ID = 'papo';
/** Where auto-compaction fires, as a share of `context.maxTokens`: room for the turn's own tool results. */
export const AUTO_COMPACT_AT = 0.8;

export interface AgentArgs {
  config: PapoConfig;
  settings: Settings;
  provider: ModelProvider;
  modelId: string;
  store: Store;
  /** `<root>` of the file store: memory lives under `<root>/memory/<slug>`. */
  home: string;
  workspace: string;
  /** The skills the agent may read, in order of precedence; the service lists the same sources for the slash menu. */
  skills: SkillSource[];
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

/** The `@facio/tools` capabilities the configuration turns on (decision 9), in a fixed order. */
export function capabilitiesOf(tools: ToolsConfig, args: { home: string; workspace: string }): Capability[] {
  const search: SearchProvider[] = [];
  if (typeof tools.web === 'object' && tools.web.search !== undefined) {
    const { search: config } = tools.web;
    if (config.brave !== undefined) search.push(brave({ apiKey: config.brave.apiKey }));
    if (config.tavily !== undefined) search.push(tavily({ apiKey: config.tavily.apiKey }));
    if (config.duckduckgo === true) search.push(duckduckgo());
  }
  return [
    ...(tools.files ? [files()] : []),
    ...(tools.shell ? [shell()] : []),
    ...(tools.web !== false ? [web({ search })] : []),
    ...(tools.memory ? [memory({ dir: join(args.home, 'memory', workspaceSlug({ workspace: args.workspace })) })] : []),
  ];
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
  const { maxTokens } = config.context;
  return createAgent({
    id: AGENT_ID,
    instructions: args.instructions,
    model: args.provider.model({ id: args.modelId, params }),
    context: { maxTokens, ...(settings.autoCompact ? { autoCompactTokens: Math.floor(maxTokens * AUTO_COMPACT_AT) } : {}) },
    tools: [createAskUserTool(), ...(args.tools ?? [])],
    capabilities: [
      ...capabilitiesOf(config.tools, { home: args.home, workspace: args.workspace }),
      skills({ sources: args.skills, warn: args.warn }),
    ],
    store: args.store,
    policy: policyOf(settings.permissions),
    ...(config.limits !== undefined ? { limits: config.limits } : {}),
    warn: args.warn,
  });
}
