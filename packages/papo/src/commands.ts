import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunOutcome, SessionUsage } from '@facio/agents';
import { AgentError } from '@facio/agents';
import type { CommandContext, OptionSpec } from '@facio/commands';
import { ArgumentError, createRegistry, output } from '@facio/commands';
import { createFileStore, resolveHome } from '@facio/store-file';
import { renderTable } from '@facio/terminal';
import { compactedNotice } from './blocks.js';
import { createChat } from './chat.js';
import { createClaudeChat } from './claude/chat.js';
import { loadConfig, providersOf, rememberConfig } from './config.js';
import { exportPath, toMarkdown } from './export.js';
import { parseAnswers } from './questions.js';
import { formatRule, parseRule } from './rules.js';
import type { Chat } from './types/chat.js';
import type { PapoConfig, RememberedSettings, RuleLists } from './types/config.js';
import type { Settings } from './types/settings.js';
import type { Snapshot, Turn } from './types/turn.js';

/** The three choices a session carries, as `say` and `session set` spell them. */
const SETTING_FIELDS = {
  model: { type: 'string', description: 'The model, as provider/model (see `papo models`)', cli: { short: '-m', value: 'PROVIDER/MODEL' } },
  permissions: { type: 'string', description: 'When a tool call stops to ask: default, acceptEdits, bypassPermissions or dontAsk', enum: ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk'], cli: { short: '-p', value: 'MODE' } },
  reasoning: { type: 'string', description: 'How much the model thinks first', enum: ['off', 'low', 'medium', 'high'], cli: { short: '-t', value: 'LEVEL' } },
  autocompact: { type: 'string', description: 'Fold the conversation into a summary before it outgrows the context', enum: ['on', 'off'], cli: { short: '-a', value: 'on|off' } },
} as const;

function settingsPatch(input: { model?: string; permissions?: string; reasoning?: string; autocompact?: string }): Partial<Settings> {
  return {
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.permissions !== undefined ? { permissions: input.permissions as Settings['permissions'] } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning as Settings['reasoning'] } : {}),
    ...(input.autocompact !== undefined ? { autoCompact: input.autocompact === 'on' } : {}),
  };
}

/** The part of a patch the configuration remembers (decision CLI-05.1): the model, the permission mode, the thinking level. */
export function rememberedOf(patch: Partial<Settings>): RememberedSettings {
  return {
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
    ...(patch.reasoning !== undefined ? { reasoning: patch.reasoning } : {}),
  };
}

/** The rule lists as `session set` adds to them: `Tool` or `Tool(match)`, each repeatable (decision CLI-04.5). */
const RULE_FIELDS = {
  deny: { type: 'array', description: 'Refuse these tool calls before anyone is asked, e.g. "shell_exec(rm *)"', items: { type: 'string' }, cli: { value: 'RULE' } },
  ask: { type: 'array', description: 'Ask before these, whatever the mode says', items: { type: 'string' }, cli: { value: 'RULE' } },
  allow: { type: 'array', description: 'Run these without asking, e.g. "web_fetch" or "edit_file(src/*)"', items: { type: 'string' }, cli: { value: 'RULE' } },
} as const;

/** The rules the flags name, parsed; `undefined` when no flag was given. Malformed text is an argument error. */
function rulesPatch(input: { deny?: string[]; ask?: string[]; allow?: string[] }): RuleLists | undefined {
  if (input.deny === undefined && input.ask === undefined && input.allow === undefined) return undefined;
  try {
    return {
      ...(input.deny !== undefined ? { deny: input.deny.map(parseRule) } : {}),
      ...(input.ask !== undefined ? { ask: input.ask.map(parseRule) } : {}),
      ...(input.allow !== undefined ? { allow: input.allow.map(parseRule) } : {}),
    };
  } catch (error: unknown) {
    if (error instanceof AgentError) throw new ArgumentError(error.message);
    throw error;
  }
}

/** The session's lists with the new rules appended, per list; a rule already there is not repeated. */
function appendRules(held: RuleLists | undefined, added: RuleLists): RuleLists {
  const merged: RuleLists = { ...held };
  for (const name of ['deny', 'ask', 'allow'] as const) {
    const more = added[name];
    if (more === undefined) continue;
    const list = [...(held?.[name] ?? [])];
    for (const rule of more) if (!list.some((one) => one.tool === rule.tool && one.match === rule.match)) list.push(rule);
    merged[name] = list;
  }
  return merged;
}

/** What every command shares: where the agent works, where sessions live, which file, which model. */
export const GLOBALS: readonly OptionSpec[] = [
  { name: '--workspace', short: '-w', value: 'DIR', description: 'Where the agent works; sessions are kept per workspace', env: 'PAPO_WORKSPACE' },
  { name: '--home', value: 'DIR', description: 'Where sessions and skills are stored (default ~/.facio)', env: 'FACIO_HOME' },
  { name: '--config', short: '-c', value: 'FILE', description: 'Read this configuration file on top of the others' },
  { name: '--backend', short: '-b', value: 'NAME', description: 'What runs the conversation: facio (the harness here) or claude (Claude Code, through its SDK)' },
];

/** Everything a front needs, built once from the program-wide options. */
export interface Papo {
  chat: Chat;
  config: PapoConfig;
  workspace: string;
  home: string;
  /**
   * Writes a person's choice into the configuration file that sets it (else the user file) and into `config` itself,
   * so the next new conversation in this process starts from it (decision CLI-05.1). Resolves to the files written.
   */
  remember(patch: RememberedSettings): Promise<string[]>;
}

/**
 * `Papo.remember` over `rememberConfig` with the arguments `loadConfig` had, so the file found is the one that was read.
 * The mutation of `config` is the point: both backends hold this one object and read `model`, `permissions` and
 * `reasoning` from it when a new conversation starts.
 */
export function rememberInto(args: { config: PapoConfig; cwd: string; env?: NodeJS.ProcessEnv; path?: string }): Papo['remember'] {
  return async (patch) => {
    const files = await rememberConfig({ cwd: args.cwd, ...(args.env !== undefined ? { env: args.env } : {}), ...(args.path !== undefined ? { path: args.path } : {}), patch });
    const { model, ...rest } = patch;
    Object.assign(args.config, rest, model !== undefined && model !== '' ? { model } : {});
    return files;
  };
}

/** The configuration as it may be shown: keys replaced, the two folders added. */
export function redactedConfig(papo: Papo): Record<string, unknown> {
  return {
    ...papo.config,
    providers: papo.config.providers.map((provider) => ({ ...provider, ...(provider.apiKey !== undefined ? { apiKey: '[redacted]' } : {}) })),
    workspace: papo.workspace,
    home: papo.home,
  };
}

export function openPapo(globals: Readonly<Record<string, unknown>>): Papo {
  const workspace = resolve(typeof globals['workspace'] === 'string' ? globals['workspace'] : process.cwd());
  // Checked here because the runtimes fail obscurely without it (the CLI reports a binary that "failed to launch").
  if (!isDirectory(workspace)) throw new ArgumentError(`workspace ${workspace} is not a directory`);
  const home = typeof globals['home'] === 'string' ? resolve(globals['home']) : resolveHome({ name: 'facio' });
  const path = typeof globals['config'] === 'string' ? globals['config'] : undefined;
  const config = loadConfig({ cwd: workspace, ...(path !== undefined ? { path } : {}) });
  if (typeof globals['backend'] === 'string') {
    if (globals['backend'] !== 'facio' && globals['backend'] !== 'claude') throw new ArgumentError(`--backend must be facio or claude, not "${globals['backend']}"`);
    config.backend = globals['backend'];
  }
  const chat = config.backend === 'claude'
    ? createClaudeChat({ config, workspace, home })
    : createChat({ store: createFileStore({ root: home }), config, providers: providersOf(config), workspace, home });
  return { chat, config, workspace, home, remember: rememberInto({ config, cwd: workspace, ...(path !== undefined ? { path } : {}) }) };
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/**
 * The shell. Every command here is an action, so the same declarations are an MCP tool set and an
 * HTTP surface the day the daemon wants them; only `chat`, which needs a terminal, is cli-only.
 */
export interface RegistryOptions {
  /** The screen; absent where there is no terminal to draw on. */
  openScreen?: (papo: Papo, sessionId: string | undefined) => Promise<void>;
  /** How the service is built from the program-wide options; a test hands in a fake model here. */
  open?: (globals: Readonly<Record<string, unknown>>) => Papo;
}

export function createPapoRegistry(options: RegistryOptions = {}) {
  const open = options.open ?? openPapo;
  let opened: Papo | undefined;
  const registry = createRegistry({
    groups: [
      { name: 'talk', title: 'Talking', agent: true },
      { name: 'sessions', title: 'Sessions', agent: true },
      { name: 'setup', title: 'Setup', agent: false },
    ],
  }).provide('papo', {
    description: 'The conversation service over the file store',
    resolve: (_deps, context: CommandContext) => {
      opened ??= open(context.globals);
      return opened;
    },
    dispose: async (papo) => { await papo.chat.close(); },
  });

  registry.action({
    id: 'say',
    group: 'talk',
    summary: 'Send one message and print the reply',
    description: 'Starts a session unless --session names one. Stops where the agent stops: a reply, or a decision to make.',
    needs: ['papo'],
    input: {
      text: { type: 'string', description: 'What to say', minLength: 1 },
      session: { type: 'string', description: 'Continue this session', cli: { short: '-s', value: 'ID' } },
      ...SETTING_FIELDS,
    },
    required: ['text'],
    surfaces: { cli: { pattern: ['say', ':text'] }, mcp: true },
    examples: [
      { command: 'papo say "What does this repository build?"', description: 'A new session' },
      { command: 'papo say -s 01J... "And how is it tested?"', description: 'The next turn of it' },
      { command: 'papo say -m or/qwen3 -t high "Plan the migration"', description: 'A new session on that model, thinking hard; the choices stay on the session' },
    ],
    run: async ({ input, papo }) => {
      const patch = settingsPatch(input);
      const started = await withAgentErrors(() => papo.chat.say({
        text: input.text,
        ...(input.session !== undefined ? { sessionId: input.session } : {}),
        ...(Object.keys(patch).length > 0 ? { settings: patch } : {}),
      }));
      let outcome = await papo.chat.wait(started.sessionId);
      let note: string | undefined;
      // The CLI's decision lives in the process that asked: this command cannot leave it for the next
      // one, so every decision the turn stops at is denied until the turn ends.
      while (outcome?.status === 'awaiting' && papo.config.backend === 'claude') {
        note = 'papo say cannot hold a decision on the claude backend: the tool was denied; use papo chat to approve tools';
        await papo.chat.deny(started.sessionId, { reason: 'papo say exited before the decision was made; open papo chat to approve tools' });
        outcome = await papo.chat.wait(started.sessionId);
      }
      // A choice made on a new session is the next one's default too (decision CLI-05.1); on a session that exists it stays
      // the session's. Written once the turn has settled, so a file that cannot be written does not leave a turn running unwatched.
      const remembered = input.session === undefined ? rememberedOf(patch) : {};
      const files = Object.keys(remembered).length > 0 ? await papo.remember(remembered) : [];
      const snapshot = await papo.chat.snapshot(started.sessionId);
      return output(
        { sessionId: started.sessionId, runId: started.runId, outcome, pending: snapshot.pending, ...(note !== undefined ? { note } : {}), ...(files.length > 0 ? { remembered: files } : {}) },
        () => renderOutcome(snapshot, outcome, { runId: started.runId, ...(note !== undefined ? { note } : {}), remembered: files }),
      );
    },
  });

  registry.action({
    id: 'queue',
    group: 'talk',
    summary: 'Hold a message to be the next turn of a session',
    description: 'Kept in this process only: it starts when the running turn ends (not after a cancel), or at once while nothing runs, and is gone with the process.',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session', minLength: 1 },
      text: { type: 'string', description: 'What to say next', minLength: 1 },
      id: { type: 'string', description: 'Replace the queued message with this id', cli: { short: '-i', value: 'ID' } },
      ...SETTING_FIELDS,
    },
    required: ['session', 'text'],
    surfaces: { cli: { pattern: ['queue', ':session', ':text'] }, mcp: true },
    run: async ({ input, papo }) => {
      const patch = settingsPatch(input);
      const queued = await withAgentErrors(() => papo.chat.queue({
        sessionId: input.session,
        text: input.text,
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(Object.keys(patch).length > 0 ? { settings: patch } : {}),
      }));
      return output(queued, `Queued ${queued.id}\n`);
    },
  });

  registry.action({
    id: 'unqueue',
    group: 'talk',
    summary: 'Drop a queued message',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session', minLength: 1 },
      id: { type: 'string', description: 'The queued message, as `session show` lists it', minLength: 1 },
    },
    required: ['session', 'id'],
    surfaces: { cli: { pattern: ['unqueue', ':session', ':id'] }, mcp: true },
    run: async ({ input, papo }) => {
      await withAgentErrors(() => papo.chat.unqueue(input.session, input.id));
      return output({ sessionId: input.session, id: input.id }, `Dropped ${input.id}\n`);
    },
  });

  registry.action({
    id: 'approve',
    group: 'talk',
    summary: 'Let the waiting tool call run',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session waiting on it', minLength: 1 },
      always: { type: 'boolean', description: 'And every later call of the same tool in this session', default: false },
    },
    required: ['session'],
    surfaces: { cli: { pattern: ['approve', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      await withAgentErrors(() => papo.chat.approve(input.session, { always: input.always }));
      return settle(papo, input.session);
    },
  });

  registry.action({
    id: 'deny',
    group: 'talk',
    summary: 'Refuse the waiting tool call, or decline the waiting questions',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session waiting on it', minLength: 1 },
      reason: { type: 'string', description: 'Told to the model', cli: { short: '-r', value: 'TEXT' } },
    },
    required: ['session'],
    surfaces: { cli: { pattern: ['deny', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      await withAgentErrors(() => papo.chat.deny(input.session, input.reason !== undefined ? { reason: input.reason } : {}));
      return settle(papo, input.session);
    },
  });

  registry.action({
    id: 'answer',
    group: 'talk',
    summary: 'Answer the questions the agent asked',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session waiting on them', minLength: 1 },
      answers: { type: 'array', description: 'id=value, one per question; repeat an id for a multi-select', items: { type: 'string' }, minItems: 1 },
    },
    required: ['session', 'answers'],
    surfaces: { cli: { pattern: ['answer', ':session', ':answers...'] }, mcp: true },
    examples: [{ command: 'papo answer 01J... scope=tests style=terse', description: 'Two answers' }],
    run: async ({ input, papo }) => {
      let answers;
      try { answers = parseAnswers(input.answers); } catch (error: unknown) { throw new ArgumentError((error as Error).message); }
      await withAgentErrors(() => papo.chat.answer(input.session, answers));
      return settle(papo, input.session);
    },
  });

  registry.action({
    id: 'cancel',
    group: 'talk',
    summary: 'Stop the turn a session is on, or deny what it waits on',
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 } },
    required: ['session'],
    surfaces: { cli: { pattern: ['cancel', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      await withAgentErrors(() => papo.chat.cancel(input.session));
      return output({ sessionId: input.session }, `Cancelled ${input.session}\n`);
    },
  });

  registry.action({
    id: 'compact',
    group: 'talk',
    summary: 'Fold the conversation so far into a summary the model continues from',
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 } },
    required: ['session'],
    surfaces: { cli: { pattern: ['compact', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      const started = await withAgentErrors(() => papo.chat.compact(input.session));
      const outcome = await papo.chat.wait(started.sessionId);
      const snapshot = await papo.chat.snapshot(started.sessionId);
      return output({ sessionId: started.sessionId, runId: started.runId, outcome }, () => renderOutcome(snapshot, outcome, { runId: started.runId }));
    },
  });

  registry.action({
    id: 'usage',
    group: 'sessions',
    summary: 'What a session used: tokens by kind, steps, tool calls and refusals, per turn and in total',
    description: 'From the runtime\'s own records; counts are what the provider reported, and there is no price here.',
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 } },
    required: ['session'],
    surfaces: { cli: { pattern: ['usage', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      const used = await withAgentErrors(() => papo.chat.usage(input.session));
      return output(used, () => renderUsage(used));
    },
  });

  registry.action({
    id: 'session.list',
    group: 'sessions',
    summary: 'The sessions of this workspace, newest first',
    needs: ['papo'],
    surfaces: { cli: { pattern: ['session', 'list'] }, mcp: true },
    run: async ({ papo }) => {
      const rows = await papo.chat.sessions();
      return output(rows, () => rows.length === 0
        ? `No sessions in ${papo.workspace}\n`
        : renderTable(['id', 'state', 'updated', 'title'], rows.map((row) => [row.id, row.activity, row.updatedAt, row.title])));
    },
  });

  registry.action({
    id: 'session.show',
    group: 'sessions',
    summary: 'The conversation of one session',
    description: 'What the model sees: after a compaction, the summary and what it did not cover. --all prints every turn, the compacted ones included.',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session', minLength: 1 },
      all: { type: 'boolean', description: 'Every message, the ones a compaction folded away included', default: false },
    },
    required: ['session'],
    surfaces: { cli: { pattern: ['session', 'show', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      const snapshot = await withAgentErrors(() => papo.chat.snapshot(input.session, { all: input.all }));
      return output(snapshot, () => renderTranscript(snapshot));
    },
  });

  registry.action({
    id: 'session.export',
    group: 'sessions',
    summary: 'Write the conversation as Markdown',
    needs: ['papo'],
    input: {
      session: { type: 'string', description: 'The session', minLength: 1 },
      out: { type: 'string', description: 'The file; default <workspace>/papo-<session>.md', cli: { short: '-o', value: 'FILE' } },
    },
    required: ['session'],
    surfaces: { cli: { pattern: ['session', 'export', ':session'] } },
    run: async ({ input, papo }) => {
      const snapshot = await withAgentErrors(() => papo.chat.snapshot(input.session));
      const path = resolve(papo.workspace, input.out ?? exportPath(papo.workspace, input.session));
      await writeFile(path, toMarkdown(snapshot), 'utf8');
      return output({ path }, `${path}\n`);
    },
  });

  registry.action({
    id: 'session.set',
    group: 'sessions',
    summary: 'Change what a session runs with',
    description: "The model, the permission mode, the thinking level and auto-compaction; each stays until changed again. --deny, --ask and --allow add rules to the session (the configuration's apply to every session); a rule is Tool or Tool(match), the match a glob over what the tool touches.",
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 }, ...SETTING_FIELDS, ...RULE_FIELDS },
    required: ['session'],
    surfaces: { cli: { pattern: ['session', 'set', ':session'] }, mcp: true },
    examples: [
      { command: 'papo session set 01J... -p bypassPermissions', description: 'Stop asking on this session' },
      { command: 'papo session set 01J... --deny "shell_exec(rm *)" --allow web_fetch', description: 'Two rules for this session' },
    ],
    run: async ({ input, papo }) => {
      const patch = settingsPatch(input);
      const added = rulesPatch(input);
      if (Object.keys(patch).length === 0 && added === undefined) throw new ArgumentError('nothing to set: give --model, --permissions, --reasoning, --autocompact, --deny, --ask or --allow');
      if (added !== undefined) patch.rules = appendRules((await withAgentErrors(() => papo.chat.settings(input.session))).rules, added);
      const settings = await withAgentErrors(() => papo.chat.configure(input.session, patch));
      // The session's write came first: a pick that failed to reach the file still holds on the session (decision CLI-05.1).
      const remembered = rememberedOf(patch);
      const files = Object.keys(remembered).length > 0 ? await papo.remember(remembered) : [];
      return output({ ...settings, ...(files.length > 0 ? { remembered: files } : {}) }, `${[renderSettings(settings), ...files.map((file) => `remembered in ${file}`)].join('\n')}
`);
    },
  });

  registry.action({
    id: 'session.rules',
    group: 'sessions',
    summary: 'The permission mode and every rule a session runs under, with where each comes from',
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 } },
    required: ['session'],
    surfaces: { cli: { pattern: ['session', 'rules', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      const settings = await withAgentErrors(() => papo.chat.settings(input.session));
      const rows = ruleRows(settings, papo.config.rules);
      return output({ sessionId: input.session, mode: settings.permissions, rules: rows }, () => [
        `mode ${settings.permissions}`,
        ...(rows.length === 0 ? ['no rules'] : rows.map((row) => `${row.list.padEnd(5)} ${row.origin.padEnd(7)} ${formatRule(row)}`)),
        '',
      ].join('\n'));
    },
  });

  registry.action({
    id: 'session.delete',
    group: 'sessions',
    summary: 'Remove a session and everything it holds',
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 } },
    required: ['session'],
    surfaces: { cli: { pattern: ['session', 'delete', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      await withAgentErrors(() => papo.chat.remove(input.session));
      return output({ sessionId: input.session }, `Removed ${input.session}\n`);
    },
  });

  registry.action({
    id: 'providers',
    group: 'setup',
    summary: 'The configured providers; the first answers when no model is chosen',
    description: 'From the configuration (`providers`, or PAPO_BASE_URL as `default`). A model is written provider/model; `papo models <provider>` lists what one offers. The key itself is never printed.',
    needs: ['papo'],
    surfaces: { cli: { pattern: ['providers'] }, mcp: true },
    run: async ({ papo }) => {
      const rows = await papo.chat.providers();
      const chosen = papo.config.model !== undefined;
      return output(rows, () => renderTable(['provider', 'base url', 'key', ''],
        rows.map((row) => [row.id, row.baseUrl ?? '', row.key ? 'yes' : 'no', row.default ? (chosen ? 'default' : 'first listed') : ''])));
    },
  });

  registry.action({
    id: 'models',
    group: 'setup',
    summary: "The models the configured providers offer, or one provider's",
    description: "Every provider in turn; one that cannot be reached is reported on stderr and skipped, so a provider that is down never hides the others. Named, a provider's own error is the answer.",
    needs: ['papo'],
    input: { provider: { type: 'string', description: 'One provider (see `papo providers`)', minLength: 1 } },
    surfaces: { cli: { pattern: ['models', ':provider?'] }, mcp: true },
    examples: [
      { command: 'papo models', description: 'Everything on offer' },
      { command: 'papo models open_router', description: 'One provider' },
    ],
    run: async ({ input, papo }) => {
      const rows = await withAgentErrors(() => papo.chat.models(input.provider !== undefined ? { provider: input.provider } : {}));
      return output(rows, () => renderTable(['model', 'name', 'context', 'tools', 'reasoning'],
        rows.map((row) => [row.ref, row.name, row.contextTokens ?? '', row.features.tools ? 'yes' : 'no', row.features.reasoning ? 'yes' : 'no'])));
    },
  });

  registry.action({
    id: 'skills',
    group: 'setup',
    summary: 'The skills the agent may read; send /<name> to invoke one',
    needs: ['papo'],
    surfaces: { cli: { pattern: ['skills'] }, mcp: true },
    run: async ({ papo }) => {
      const rows = await papo.chat.skills();
      return output(rows, () => renderTable(['skill', 'description'], rows.map((row) => [`/${row.name}`, row.description])));
    },
  });

  registry.action({
    id: 'config.show',
    group: 'setup',
    summary: 'The configuration in force, keys redacted',
    needs: ['papo'],
    surfaces: { cli: { pattern: ['config'] } },
    run: ({ papo }) => {
      const shown = redactedConfig(papo);
      return output(shown, `${JSON.stringify(shown, null, 2)}\n`);
    },
  });

  registry.action({
    id: 'chat',
    group: 'talk',
    summary: 'Open the screen',
    description: 'What `papo` with no command does. Needs a terminal.',
    needs: ['papo'],
    input: { session: { type: 'string', description: 'Open on this session', cli: { short: '-s', value: 'ID' } } },
    surfaces: { cli: { pattern: ['chat'] } },
    run: async ({ input, papo }) => {
      if (options.openScreen === undefined) throw new ArgumentError('the screen is not available here');
      await options.openScreen(papo, input.session);
    },
  });

  return registry;
}

/** The harness's refusals as the terminal's: a missing session is an argument problem, not a crash. */
async function withAgentErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AgentError && (error.code === 'not_found' || error.code === 'writer_busy' || error.code === 'invalid_options')) {
      throw new ArgumentError(error.message);
    }
    throw error;
  }
}

/** After a decision: wait for the run to settle and print where it got to. */
async function settle(papo: Papo, sessionId: string) {
  const outcome = await papo.chat.wait(sessionId);
  const snapshot = await papo.chat.snapshot(sessionId);
  return output({ sessionId, outcome, pending: snapshot.pending }, () => renderOutcome(snapshot, outcome, {}));
}

/**
 * The turn the command was about, then how it ended: by run id where the turns carry one (the compaction's turn
 * leads the view, so the last is not always it), else the last (the Claude backend's turns are named by the CLI).
 */
function renderOutcome(snapshot: Snapshot, outcome: RunOutcome | undefined, about: { runId?: string; note?: string; remembered?: string[] }): string {
  const lines: string[] = [];
  const turn = snapshot.turns.find((one) => one.id === about.runId) ?? snapshot.turns[snapshot.turns.length - 1];
  if (turn !== undefined) lines.push(...renderTurn(turn, { toolCalls: true }));
  if (about.note !== undefined) lines.push(`Note: ${about.note}`);
  for (const file of about.remembered ?? []) lines.push(`remembered in ${file}`);
  if (outcome?.status === 'awaiting' || snapshot.pending !== null) {
    lines.push(...renderPending(snapshot));
  } else if (outcome?.status === 'stopped' && outcome.reason !== 'hook') {
    // A hook stop ended the turn on purpose and reads as complete (decision 97); a limit says which.
    lines.push(`Stopped: ${outcome.reason}`);
  } else if (outcome?.status === 'cancelled') {
    lines.push(`Cancelled${outcome.reason !== undefined ? `: ${outcome.reason}` : ''}`);
  } else if (outcome?.status === 'failed') {
    lines.push(`Failed: ${outcome.error.message}`);
  }
  lines.push(`session ${snapshot.session.id}`);
  return `${lines.join('\n')}\n`;
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

function renderPending(snapshot: Snapshot): string[] {
  const pending = snapshot.pending;
  if (pending === null) return [];
  if (pending.kind === 'toolConfirmation') {
    return [
      `Waiting: ${pending.call.confirmationTitle ?? pending.call.name}`,
      `  ${pending.call.name} ${pending.call.input ?? ''}`,
      `  papo approve ${snapshot.session.id}   |   papo deny ${snapshot.session.id}`,
    ];
  }
  const lines = [`Waiting: ${pending.message}`];
  for (const question of pending.questions) {
    lines.push(`  ${question.id}: ${question.message}`);
    if (question.options !== undefined) lines.push(`    ${question.options.map((option) => option.label).join(' | ')}`);
  }
  lines.push(`  papo answer ${snapshot.session.id} ${pending.questions.map((question) => `${question.id}=...`).join(' ')}`);
  return lines;
}

function renderTurn(turn: Turn, options: { toolCalls: boolean }): string[] {
  const lines: string[] = [];
  for (const part of turn.parts) {
    if (part.kind === 'text') lines.push(part.text.trim());
    else if (part.kind === 'tool' && options.toolCalls) lines.push(`[${part.call.status}] ${part.call.name} ${part.call.input ?? ''}`);
    else if (part.kind === 'error') lines.push(`Failed: ${part.message}`);
    else if (part.kind === 'steer') lines.push(`> ${part.text}`);
    else if (part.kind === 'summary') lines.push(`[${compactedNotice(part)}]`, part.text.trim());
    else if (part.kind === 'notice') lines.push(`[${part.text}]`);
  }
  return lines;
}

function renderSettings(settings: Settings): string {
  const rules = ruleRows(settings, undefined);
  return `model ${settings.model} · permissions ${settings.permissions} · reasoning ${settings.reasoning} · autocompact ${settings.autoCompact ? 'on' : 'off'}${rules.length > 0 ? ` · rules ${rules.map((row) => `${row.list} ${formatRule(row)}`).join(', ')}` : ''}`;
}

/** Every rule in the order `rules()` reads them: deny, ask, allow; the session's before the configuration's (CLI-04.5). */
function ruleRows(settings: Settings, config: RuleLists | undefined): { list: 'deny' | 'ask' | 'allow'; origin: 'session' | 'config'; tool: string; match?: string }[] {
  const rows: { list: 'deny' | 'ask' | 'allow'; origin: 'session' | 'config'; tool: string; match?: string }[] = [];
  for (const list of ['deny', 'ask', 'allow'] as const) {
    for (const rule of settings.rules?.[list] ?? []) rows.push({ list, origin: 'session', ...rule });
    for (const rule of config?.[list] ?? []) rows.push({ list, origin: 'config', ...rule });
  }
  return rows;
}

function renderTranscript(snapshot: Snapshot): string {
  const lines: string[] = [`${snapshot.session.title}  (${snapshot.session.activity})`, renderSettings(snapshot.settings), ''];
  for (const turn of snapshot.turns) {
    lines.push(`> ${turn.input}`);
    lines.push(...renderTurn(turn, { toolCalls: true }).map((line) => `  ${line.replace(/\n/g, '\n  ')}`));
    lines.push('');
  }
  lines.push(...renderPending(snapshot));
  if (snapshot.queued.length > 0) lines.push('Queued:', ...snapshot.queued.map((waiting) => `  ${waiting.id}  ${waiting.text.replace(/\s+/g, ' ')}${waiting.steer === true ? '  (steer)' : ''}`));
  return `${lines.join('\n').trimEnd()}\n`;
}
