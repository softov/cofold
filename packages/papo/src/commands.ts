import { resolve } from 'node:path';
import type { RunOutcome } from '@facio/agents';
import { AgentError } from '@facio/agents';
import type { CommandContext, OptionSpec } from '@facio/commands';
import { ArgumentError, createRegistry, output } from '@facio/commands';
import { createFileStore, resolveHome } from '@facio/store-file';
import { renderTable } from '@facio/terminal';
import { createChat } from './chat.js';
import { loadConfig, providersOf } from './config.js';
import { parseAnswers } from './questions.js';
import type { Chat } from './types/chat.js';
import type { PapoConfig } from './types/config.js';
import type { Snapshot, Turn } from './types/turn.js';

/** What every command shares: where the agent works, where sessions live, which file, which model. */
export const GLOBALS: readonly OptionSpec[] = [
  { name: '--workspace', short: '-w', value: 'DIR', description: 'Where the agent works; sessions are kept per workspace', env: 'PAPO_WORKSPACE' },
  { name: '--home', value: 'DIR', description: 'Where sessions and skills are stored (default ~/.facio)', env: 'FACIO_HOME' },
  { name: '--config', short: '-c', value: 'FILE', description: 'Read this configuration file on top of the others' },
  { name: '--model', short: '-m', value: 'PROVIDER/MODEL', description: 'The model new turns use', env: 'PAPO_MODEL' },
];

/** Everything a front needs, built once from the program-wide options. */
export interface Papo {
  chat: Chat;
  config: PapoConfig;
  workspace: string;
  home: string;
}

export function openPapo(globals: Readonly<Record<string, unknown>>): Papo {
  const workspace = resolve(typeof globals['workspace'] === 'string' ? globals['workspace'] : process.cwd());
  const home = typeof globals['home'] === 'string' ? resolve(globals['home']) : resolveHome({ name: 'facio' });
  const config = loadConfig({ cwd: workspace, ...(typeof globals['config'] === 'string' ? { path: globals['config'] } : {}) });
  if (typeof globals['model'] === 'string' && globals['model'] !== '') config.model = globals['model'];
  const store = createFileStore({ root: home });
  const chat = createChat({ store, config, providers: providersOf(config), workspace, home });
  return { chat, config, workspace, home };
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
    },
    required: ['text'],
    surfaces: { cli: { pattern: ['say', ':text'] }, mcp: true },
    examples: [
      { command: 'papo say "What does this repository build?"', description: 'A new session' },
      { command: 'papo say -s 01J... "And how is it tested?"', description: 'The next turn of it' },
    ],
    run: async ({ input, papo }) => {
      const started = await withAgentErrors(() => papo.chat.say({ text: input.text, ...(input.session !== undefined ? { sessionId: input.session } : {}) }));
      const outcome = await papo.chat.wait(started.sessionId);
      const snapshot = await papo.chat.snapshot(started.sessionId);
      return output({ sessionId: started.sessionId, runId: started.runId, outcome, pending: snapshot.pending }, () => renderOutcome(snapshot, outcome));
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
    summary: 'Refuse the waiting tool call',
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
    summary: 'Stop the turn a session is on',
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
    needs: ['papo'],
    input: { session: { type: 'string', description: 'The session', minLength: 1 } },
    required: ['session'],
    surfaces: { cli: { pattern: ['session', 'show', ':session'] }, mcp: true },
    run: async ({ input, papo }) => {
      const snapshot = await withAgentErrors(() => papo.chat.snapshot(input.session));
      return output(snapshot, () => renderTranscript(snapshot));
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
    id: 'models',
    group: 'setup',
    summary: 'The models the configured providers offer',
    needs: ['papo'],
    surfaces: { cli: { pattern: ['models'] }, mcp: true },
    run: async ({ papo }) => {
      const rows = await withAgentErrors(() => papo.chat.models());
      return output(rows, () => renderTable(['model', 'name', 'context', 'tools', 'reasoning'],
        rows.map((row) => [row.ref, row.name, row.contextTokens ?? '', row.features.tools ? 'yes' : 'no', row.features.reasoning ? 'yes' : 'no'])));
    },
  });

  registry.action({
    id: 'config.show',
    group: 'setup',
    summary: 'The configuration in force, keys redacted',
    needs: ['papo'],
    surfaces: { cli: { pattern: ['config'] } },
    run: ({ papo }) => {
      const shown = {
        ...papo.config,
        providers: papo.config.providers.map((provider) => ({ ...provider, ...(provider.apiKey !== undefined ? { apiKey: '[redacted]' } : {}) })),
        workspace: papo.workspace,
        home: papo.home,
      };
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
  return output({ sessionId, outcome, pending: snapshot.pending }, () => renderOutcome(snapshot, outcome));
}

function renderOutcome(snapshot: Snapshot, outcome: RunOutcome | undefined): string {
  const lines: string[] = [];
  const last = snapshot.turns[snapshot.turns.length - 1];
  if (last !== undefined) lines.push(...renderTurn(last, { toolCalls: true }));
  if (outcome?.status === 'awaiting' || snapshot.pending !== null) {
    lines.push(...renderPending(snapshot));
  } else if (outcome?.status === 'stopped') {
    lines.push(`Stopped: ${outcome.reason}`);
  } else if (outcome?.status === 'cancelled') {
    lines.push(`Cancelled${outcome.reason !== undefined ? `: ${outcome.reason}` : ''}`);
  } else if (outcome?.status === 'failed') {
    lines.push(`Failed: ${outcome.error.message}`);
  }
  lines.push(`session ${snapshot.session.id}`);
  return `${lines.join('\n')}\n`;
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
  }
  return lines;
}

function renderTranscript(snapshot: Snapshot): string {
  const lines: string[] = [`${snapshot.session.title}  (${snapshot.session.activity})`, ''];
  for (const turn of snapshot.turns) {
    lines.push(`> ${turn.input}`);
    lines.push(...renderTurn(turn, { toolCalls: true }).map((line) => `  ${line.replace(/\n/g, '\n  ')}`));
    lines.push('');
  }
  lines.push(...renderPending(snapshot));
  return `${lines.join('\n').trimEnd()}\n`;
}
