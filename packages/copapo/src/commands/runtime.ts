import type { Message, SessionUsage, SkillIndexEntry, SlashCommand, SlashCommandContext } from '@cofold/agents';
import { AgentError, contextOf, sessionUsage } from '@cofold/agents';
import { renderTable } from '@cofold/terminal';
import { AUTO_COMPACT_AT } from '../agent.js';
import { formatRule } from '../rules.js';
import type { ModelRow } from '../types/chat.js';
import type { PapoConfig } from '../types/config.js';
import type { Settings } from '../types/settings.js';
import { PERMISSION_MODES, REASONING_LEVELS } from '../types/settings.js';

/** What papo's runtime commands read and write: the service's own settings record, so a command and a chip agree. */
export interface RuntimeDeps {
  config: PapoConfig;
  workspace: string;
  home: string;
  /** The session's settings, as the chips read them. */
  settings(sessionId: string): Promise<Settings>;
  /** Checks a patch and writes it over the session's settings, as `Chat.configure` does. */
  configure(sessionId: string, patch: Partial<Settings>): Promise<Settings>;
  skills(): Promise<SkillIndexEntry[]>;
  models(): Promise<ModelRow[]>;
}

/** The configuration as it may be shown: keys replaced, the two folders added. */
export function redactedConfig(papo: { config: PapoConfig; workspace: string; home: string }): Record<string, unknown> {
  return {
    ...papo.config,
    providers: papo.config.providers.map((provider) => ({ ...provider, ...(provider.apiKey !== undefined ? { apiKey: '[redacted]' } : {}) })),
    workspace: papo.workspace,
    home: papo.home,
  };
}

/**
 * The usage table: one row per run, the sums under it. A count the provider never reported (cache,
 * reasoning) is left out as a column rather than shown as zeros, so what is there is what was measured.
 */
export function renderUsage(used: SessionUsage): string {
  if (used.runs.length === 0) return 'Nothing said yet.\n';
  const maybe = (value: number | undefined): string => (value === undefined ? '' : String(value));
  const header = ['turn', 'state', 'in', 'out', 'cache read', 'cache write', 'reasoning', 'steps', 'tools', 'refused'];
  const rows = used.runs.map((run, index) => [
    String(index + 1), run.status, String(run.usage.inputTokens), String(run.usage.outputTokens),
    maybe(run.usage.cacheReadTokens), maybe(run.usage.cacheWriteTokens), maybe(run.usage.reasoningTokens),
    String(run.steps), String(run.toolCalls), String(run.denials),
  ]);
  rows.push([
    'total', '', String(used.usage.inputTokens), String(used.usage.outputTokens),
    maybe(used.usage.cacheReadTokens), maybe(used.usage.cacheWriteTokens), maybe(used.usage.reasoningTokens),
    String(used.steps), String(used.toolCalls), String(used.denials),
  ]);
  const kept = header.map((_name, column) => column < 4 || column > 6 || rows.some((row) => row[column] !== ''));
  const pick = (row: string[]): string[] => row.filter((_cell, column) => kept[column]);
  return renderTable(pick(header), rows.map(pick));
}

/** Where auto-compaction stands for a session, in one line. */
function autoCompactLine(config: PapoConfig, settings: Settings): string {
  const { maxTokens } = config.context;
  return settings.autoCompact ? `on, at ${Math.floor(maxTokens * AUTO_COMPACT_AT)} of ${maxTokens} tokens` : 'off';
}

/** A setting and its choices, as a setter with no argument answers. */
function choicesOf(name: string, current: string, choices: readonly string[]): string {
  return `${name}: ${current}\nchoices: ${choices.join(', ')}`;
}

/** The tokens a message costs in a request, by the agent's own estimate. */
function messageTokens(message: Message, estimate: (text: string) => number): number {
  let tokens = 4;
  for (const part of message.parts) {
    if (part.type === 'text') tokens += estimate(part.text);
    else if (part.type === 'toolCall') tokens += estimate(part.name) + estimate(part.raw);
    else if (part.type === 'toolResult') tokens += estimate(part.content);
    else if (part.type === 'image') tokens += 1_000;
  }
  return tokens;
}

/** A setter: no argument answers the current value and the choices; one is checked and written. */
function setter(args: {
  name: string;
  description: string;
  argumentHint: string;
  current(settings: Settings): string;
  choices(deps: RuntimeDeps): Promise<readonly string[]>;
  patch(value: string): Partial<Settings>;
}, deps: RuntimeDeps): SlashCommand {
  return {
    name: args.name,
    description: args.description,
    argumentHint: args.argumentHint,
    run: async (ctx: SlashCommandContext) => {
      const value = ctx.args.trim();
      if (value === '') return choicesOf(args.name, args.current(await deps.settings(ctx.sessionId)), await args.choices(deps));
      const next = await deps.configure(ctx.sessionId, args.patch(value));
      return `${args.name}: ${args.current(next)}`;
    },
  };
}

/** papo's runtime commands (AGENT-03.6): each reads or writes the session's settings and the store, never the model. */
export function runtimeCommands(deps: RuntimeDeps): SlashCommand[] {
  const { config } = deps;
  return [
    {
      name: 'status',
      description: 'Session, model, mode, rules, folders and tokens',
      run: async (ctx) => {
        const settings = await deps.settings(ctx.sessionId);
        const used = await sessionUsage({ store: ctx.store, sessionId: ctx.sessionId });
        const rules = (['deny', 'ask', 'allow'] as const).flatMap((list) =>
          [...(settings.rules?.[list] ?? []), ...(config.rules?.[list] ?? [])].map((rule) => `${list} ${formatRule(rule)}`));
        return [
          `session      ${ctx.sessionId}`,
          `model        ${settings.model || 'first listed model'}`,
          `permissions  ${settings.permissions}`,
          `reasoning    ${settings.reasoning}`,
          `auto-compact ${autoCompactLine(config, settings)}`,
          `rules        ${rules.length > 0 ? rules.join(', ') : 'none'}`,
          `workspace    ${deps.workspace}`,
          `home         ${deps.home}`,
          `tokens       ${used.usage.inputTokens} in, ${used.usage.outputTokens} out`,
        ].join('\n');
      },
    },
    {
      name: 'usage',
      description: 'Tokens by kind, steps, tool calls and refusals, per turn and in total',
      run: async (ctx) => renderUsage(await sessionUsage({ store: ctx.store, sessionId: ctx.sessionId })).trimEnd(),
    },
    {
      name: 'config',
      description: 'The configuration in force, keys redacted',
      run: async () => JSON.stringify(redactedConfig(deps), null, 2),
    },
    {
      name: 'skills',
      description: 'The skills the agent may read',
      run: async () => {
        const listed = await deps.skills();
        if (listed.length === 0) return 'No skills.';
        return listed.map((skill) => `/${skill.name}  ${skill.description}`).join('\n');
      },
    },
    {
      name: 'context',
      description: 'How much of the context the conversation fills',
      run: async (ctx) => {
        const settings = await deps.settings(ctx.sessionId);
        const all = await ctx.store.sessions.listMessages({ sessionId: ctx.sessionId });
        const view = contextOf(all);
        const { maxTokens, estimateTokens } = ctx.agent.context;
        const used = estimateTokens(ctx.agent.definition.instructions) + view.reduce((sum, message) => sum + messageTokens(message, estimateTokens), 0);
        return [
          `context      about ${used} of ${maxTokens} tokens (${Math.round((used / maxTokens) * 100)}%)`,
          `messages     ${view.length} in view, ${all.length} in the transcript`,
          `auto-compact ${autoCompactLine(config, settings)}`,
        ].join('\n');
      },
    },
    setter({
      name: 'model',
      description: 'Show or change the model',
      argumentHint: '<provider/model>',
      current: (settings) => settings.model || 'first listed model',
      choices: async (them) => (await them.models()).map((row) => row.ref),
      patch: (value) => ({ model: value }),
    }, deps),
    setter({
      name: 'reasoning',
      description: 'Show or change how much the model thinks first',
      argumentHint: `<${REASONING_LEVELS.join('|')}>`,
      current: (settings) => settings.reasoning,
      choices: async () => REASONING_LEVELS,
      patch: (value) => ({ reasoning: value as Settings['reasoning'] }),
    }, deps),
    setter({
      name: 'permissions',
      description: 'Show or change when a tool call stops to ask',
      argumentHint: `<${PERMISSION_MODES.join('|')}>`,
      current: (settings) => settings.permissions,
      choices: async () => PERMISSION_MODES,
      patch: (value) => ({ permissions: value as Settings['permissions'] }),
    }, deps),
    setter({
      name: 'autocompact',
      description: 'Show or change whether the conversation is folded before it outgrows the context',
      argumentHint: '<on|off>',
      current: (settings) => (settings.autoCompact ? 'on' : 'off'),
      choices: async () => ['on', 'off'],
      patch: (value) => {
        if (value !== 'on' && value !== 'off') throw new AgentError({ code: 'invalid_options', message: 'autocompact must be on or off' });
        return { autoCompact: value === 'on' };
      },
    }, deps),
  ];
}
