import { join } from 'node:path';
import type { Agent, ModelProvider, Rule, SkillSource, Store, Tool } from '@cofold/agents';
import { createAgent, createAskUserTool, effortOf, policyOf, rules, skills } from '@cofold/agents';
import { workspaceSlug } from '@cofold/store-file';
import { resolveWithin, standardCapabilities } from '@cofold/tools';
import type { PapoConfig, PermissionMode, RuleLists } from './types/config.js';
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

/** The session's rules before the configuration's, per list (decision CLI-04.5); what `rules()` is built from. */
export function mergedRules(session: RuleLists | undefined, config: RuleLists | undefined): Required<RuleLists> {
  const both = (list: 'deny' | 'ask' | 'allow'): Rule[] => [...(session?.[list] ?? []), ...(config?.[list] ?? [])];
  return { deny: both('deny'), ask: both('ask'), allow: both('allow') };
}

/**
 * The agent, as a value: rebuilt from the configuration for every turn, so a model or permission
 * change between two messages is honest without a session having to be reopened.
 */
export function buildAgent(args: AgentArgs): Agent {
  const { config, settings } = args;
  // The level is papo's setting; `effortOf` says which field, if any, the request carries (agent/06).
  const effort = effortOf(settings.reasoning);
  const params = {
    ...config.params,
    ...(effort !== undefined ? { reasoning: { effort } } : {}),
  };
  const { maxTokens } = config.context;
  return createAgent({
    id: AGENT_ID,
    instructions: args.instructions,
    model: args.provider.model({ id: args.modelId, params }),
    context: { maxTokens, ...(settings.autoCompact ? { autoCompactTokens: Math.floor(maxTokens * AUTO_COMPACT_AT) } : {}) },
    tools: [createAskUserTool(), ...(args.tools ?? [])],
    capabilities: [
      ...standardCapabilities(config.tools, {
        workspace: args.workspace,
        // The memory papo keeps today: under the store's root, one folder per workspace (decision 123).
        memoryDir: join(args.home, 'memory', workspaceSlug({ workspace: args.workspace })),
      }),
      skills({ sources: args.skills, warn: args.warn }),
    ],
    store: args.store,
    policy: rules({
      ...mergedRules(settings.rules, config.rules),
      // `acceptEdits` tells an edit by the file the tool says it writes, so papo keeps no list of tool names (decision CLI-04.6).
      otherwise: policyOf(settings.permissions, { inside: (path) => resolveWithin(args.workspace, path).inside }),
    }),
    ...(config.limits !== undefined ? { limits: config.limits } : {}),
    warn: args.warn,
  });
}
