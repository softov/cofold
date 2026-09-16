import { randomUUID } from 'node:crypto';
import type { CanUseTool, Options, SDKMessage, SDKResultMessage, SDKSessionInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RunOutcome, SkillIndexEntry, Usage } from '@facio/agents';
import { AgentError, newId } from '@facio/agents';
import { DEFAULT_INSTRUCTIONS } from '../config.js';
import { titleOf } from '../turns.js';
import type { Chat, ChatListener, ModelRow, Started } from '../types/chat.js';
import type { ClaudeDecision, ClaudeMessage, ClaudeQuery, ClaudeSdkSubset, ClaudeSessionMessage } from '../types/claude.js';
import type { PapoConfig } from '../types/config.js';
import type { Settings } from '../types/settings.js';
import { PERMISSION_MODES, REASONING_LEVELS } from '../types/settings.js';
import type { SessionRow, Snapshot } from '../types/turn.js';
import { ASK_TOOL, answered, approval, denial, pendingOf } from './permissions.js';
import { projectSession } from './project.js';
import { loadClaudeSdk } from './sdk.js';

/** The provider id papo shows Claude's models under: refs are `claude/<model>`. */
export const CLAUDE_PROVIDER = 'claude';
/** What `compact()` sends; the CLI's own command. */
export const COMPACT_COMMAND = '/compact';

export interface ClaudeChatOptions {
  config: PapoConfig;
  workspace: string;
  warn?: (message: string) => void;
  /** The SDK, when a test hands in a fake; otherwise the optional peer, loaded on first use. */
  sdk?: ClaudeSdkSubset;
}

/** A queue a `for await` reads from: what the CLI process takes its user messages through. */
interface Feed extends AsyncIterable<SDKUserMessage> {
  push(message: SDKUserMessage): void;
  end(): void;
}

function createFeed(): Feed {
  const queued: SDKUserMessage[] = [];
  let waiting: (() => void) | undefined;
  let ended = false;
  const wake = () => { waiting?.(); waiting = undefined; };
  return {
    push(message) { queued.push(message); wake(); },
    end() { ended = true; wake(); },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queued.shift();
        if (next !== undefined) { yield next; continue; }
        if (ended) return;
        await new Promise<void>((resolve) => { waiting = resolve; });
      }
    },
  };
}

/** One CLI process on one session: its query, its feed, and what this process knows of its turn. */
interface Live {
  query: ClaudeQuery;
  feed: Feed;
  /** What the process was started with; a change the query cannot take live means a new process. */
  effort: Settings['reasoning'];
  running: boolean;
  decision: ClaudeDecision | null;
  /** The turn in flight is the CLI's `/compact`. */
  compacting: boolean;
  /** The turn in flight: what `wait` resolves to, settled by a decision to make or the CLI's result. */
  turn: { runId: string; inputId: string; resolve(outcome: RunOutcome): void; outcome: Promise<RunOutcome> } | undefined;
  /**
   * What the stream delivered that the store may not hold yet: the CLI writes its transcript after
   * it answers, so a read right after the result can miss the turn. Dropped as the store catches up.
   */
  seen: ClaudeSessionMessage[];
}

function deferred(runId: string, inputId: string): NonNullable<Live['turn']> {
  let resolve!: (outcome: RunOutcome) => void;
  const outcome = new Promise<RunOutcome>((done) => { resolve = done; });
  return { runId, inputId, resolve, outcome };
}

/**
 * papo's `Chat` over Claude Code's runtime (CLI-03). Sessions, transcripts and compaction are the
 * CLI's own; this process holds one query per session in use and the block a `canUseTool` is
 * waiting on. Every read projects `getSessionMessages` plus what is live here.
 */
export function createClaudeChat(options: ClaudeChatOptions): Chat {
  const { config, workspace } = options;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`papo: ${message}\n`));
  const listeners = new Set<ChatListener>();
  const live = new Map<string, Live>();
  const settings = new Map<string, Settings>();
  /** Failed turns by session, keyed by the turn's input uuid; the CLI's store keeps no trace of them. */
  const errors = new Map<string, Record<string, string>>();
  const errorsOf = (sessionId: string): Record<string, string> => { let held = errors.get(sessionId); if (held === undefined) { held = {}; errors.set(sessionId, held); } return held; };
  let sdkLoaded: Promise<ClaudeSdkSubset> | undefined;
  const sdk = (): Promise<ClaudeSdkSubset> => (sdkLoaded ??= options.sdk !== undefined ? Promise.resolve(options.sdk) : loadClaudeSdk());
  const notify = (sessionId: string): void => { for (const listener of listeners) listener(sessionId); };

  // A configured model of another provider is not for this backend: the CLI's default is used.
  const configured = config.model !== undefined && config.model.startsWith(`${CLAUDE_PROVIDER}/`) ? config.model : '';
  if (config.model !== undefined && configured === '') warn(`model "${config.model}" is not written ${CLAUDE_PROVIDER}/<model>; the claude backend uses the CLI's default`);
  if (config.permissions === 'ask') warn('permissions "ask" has no equivalent on the claude backend: the CLI decides what asks, as in its default mode');
  const defaults = (): Settings => ({ model: configured, permissions: config.permissions, reasoning: config.reasoning, autoCompact: true });
  const settingsOf = (sessionId: string | undefined): Settings => (sessionId !== undefined ? settings.get(sessionId) : undefined) ?? defaults();

  function checkSettings(patch: Partial<Settings>): void {
    if (patch.autoCompact !== undefined) {
      throw new AgentError({ code: 'invalid_options', message: 'the claude backend compacts on its own; autocompact is not a setting there' });
    }
    if (patch.model !== undefined && patch.model !== '' && !patch.model.startsWith(`${CLAUDE_PROVIDER}/`)) {
      throw new AgentError({ code: 'invalid_options', message: `model "${patch.model}" must be written ${CLAUDE_PROVIDER}/<model> on the claude backend` });
    }
    if (patch.permissions !== undefined && !PERMISSION_MODES.includes(patch.permissions)) {
      throw new AgentError({ code: 'invalid_options', message: `permissions must be one of ${PERMISSION_MODES.join(', ')}` });
    }
    if (patch.reasoning !== undefined && !REASONING_LEVELS.includes(patch.reasoning)) {
      throw new AgentError({ code: 'invalid_options', message: `reasoning must be one of ${REASONING_LEVELS.join(', ')}` });
    }
  }

  /** The options a process is started with, from the session's settings (CLI-03 decision 6). */
  function optionsFor(sessionId: string, chosen: Settings, resume: boolean, canUseTool: CanUseTool): Options {
    const model = modelIdOf(chosen.model);
    const append = config.instructions !== DEFAULT_INSTRUCTIONS ? config.instructions : undefined;
    return {
      cwd: workspace,
      ...(resume ? { resume: sessionId } : { sessionId }),
      ...(model !== '' ? { model } : {}),
      ...(chosen.reasoning !== 'off' ? { effort: chosen.reasoning } : {}),
      // Always `default`: `bypassPermissions` would answer AskUserQuestion too (the SDK says so), and
      // papo's `auto` is "tools run, questions ask"; the callback below is where `auto` is applied.
      permissionMode: 'default',
      canUseTool,
      systemPrompt: { type: 'preset', preset: 'claude_code', ...(append !== undefined ? { append } : {}) },
      settingSources: ['user', 'project'],
    };
  }

  /** Starts the process for a session and reads it to its end in the background. */
  async function start(sessionId: string, chosen: Settings, resume: boolean): Promise<Live> {
    const feed = createFeed();
    const entry: Live = { query: undefined as unknown as ClaudeQuery, feed, effort: chosen.reasoning, running: false, decision: null, compacting: false, turn: undefined, seen: [] };
    const canUseTool: CanUseTool = (toolName, input, opts) => new Promise((resolve) => {
      if (settingsOf(sessionId).permissions === 'auto' && toolName !== ASK_TOOL) { resolve({ behavior: 'allow', updatedInput: input }); return; }
      const requestId = opts.requestId ?? newId();
      entry.decision = { requestId, toolUseId: opts.toolUseID ?? requestId, toolName, input, suggestions: opts.suggestions ?? [], resolve: (result) => { entry.decision = null; resolve(result); notify(sessionId); } };
      // As the harness pauses: whoever waits on the turn learns it needs a decision, and waits again after.
      if (entry.turn !== undefined) {
        const { runId, inputId, resolve: pause } = entry.turn;
        entry.turn = deferred(runId, inputId);
        pause({ status: 'awaiting', sessionId, runId, requestId, kind: toolName === ASK_TOOL ? 'input' : 'approval', usage: ZERO, steps: 0 });
      }
      notify(sessionId);
    });
    entry.query = (await sdk()).query({ prompt: feed, options: optionsFor(sessionId, chosen, resume, canUseTool) });
    live.set(sessionId, entry);
    // A process that ends mid-turn fails that turn; the store keeps no trace, so the error is kept here.
    const ended = (code: 'interrupted' | 'internal', message: string): void => {
      if (entry.turn !== undefined) errorsOf(sessionId)[entry.turn.inputId] = message;
      settle(entry, { status: 'failed', error: { code, message }, usage: ZERO, steps: 0 });
    };
    void (async () => {
      try {
        for await (const message of entry.query) handle(sessionId, entry, message);
        ended('interrupted', 'the claude process ended');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`session ${sessionId}: ${message}`);
        ended('internal', message);
      } finally {
        if (live.get(sessionId) === entry) live.delete(sessionId);
        notify(sessionId);
      }
    })();
    return entry;
  }

  function handle(sessionId: string, entry: Live, message: SDKMessage): void {
    if ((message.type === 'assistant' || message.type === 'user') && 'uuid' in message && typeof message.uuid === 'string') {
      entry.seen.push({ type: message.type, uuid: message.uuid, session_id: sessionId, message: message.message as ClaudeMessage, parent_tool_use_id: message.parent_tool_use_id, timestamp: new Date().toISOString() });
    } else if (message.type === 'result') {
      const outcome = outcomeOf(message);
      if (outcome.status === 'failed' && entry.turn !== undefined) errorsOf(sessionId)[entry.turn.inputId] = outcome.error.message;
      // After a compaction the store's view is the only true one: what was seen before it is gone from it.
      if (entry.turn !== undefined && entry.compacting) entry.seen = [];
      settle(entry, outcome);
    }
    notify(sessionId);
  }

  function settle(entry: Live, outcome: RunOutcome): void {
    entry.running = false;
    entry.decision?.resolve(denial('the turn ended'));
    entry.turn?.resolve(outcome);
    entry.turn = undefined;
  }

  async function liveFor(sessionId: string, chosen: Settings, resume: boolean): Promise<Live> {
    const held = live.get(sessionId);
    if (held !== undefined) {
      if (held.effort !== chosen.reasoning) { held.feed.end(); held.query.close(); live.delete(sessionId); }
      else {
        const model = modelIdOf(chosen.model);
        await held.query.setModel(model === '' ? undefined : model);
        return held;
      }
    }
    return start(sessionId, chosen, resume);
  }

  /** The store's view plus what the stream delivered that it does not hold yet; not_found when neither knows the session. */
  async function messagesOf(sessionId: string): Promise<ClaudeSessionMessage[]> {
    const held = live.get(sessionId);
    let stored: ClaudeSessionMessage[];
    try { stored = (await (await sdk()).getSessionMessages(sessionId, { dir: workspace })) as ClaudeSessionMessage[]; }
    catch (error: unknown) {
      if (held !== undefined) stored = [];
      else throw new AgentError({ code: 'not_found', message: `session ${sessionId} not found`, cause: error });
    }
    if (held === undefined || held.seen.length === 0) return stored;
    const known = new Set(stored.map((message) => message.uuid));
    held.seen = held.seen.filter((message) => !known.has(message.uuid));
    return [...stored, ...held.seen];
  }

  async function send(sessionId: string | undefined, text: string, patch?: Partial<Settings>): Promise<Started> {
    const id = sessionId ?? randomUUID();
    const held = live.get(id);
    if (held?.decision !== null && held?.decision !== undefined) throw new AgentError({ code: 'writer_busy', message: `session ${id} is waiting on a decision; approve, deny or answer it first` });
    if (held?.running) throw new AgentError({ code: 'writer_busy', message: `session ${id} is still answering; wait or cancel it` });
    if (patch !== undefined) { checkSettings(patch); settings.set(id, { ...settingsOf(id), ...patch }); }
    const chosen = settingsOf(id);
    const entry = await liveFor(id, chosen, sessionId !== undefined);
    const runId = newId();
    // The prompt's uuid is the CLI's record of it: the store's user message, the turn's id here.
    const inputId = randomUUID();
    entry.turn = deferred(runId, inputId);
    entry.running = true;
    entry.compacting = text === COMPACT_COMMAND;
    entry.seen.push({ type: 'user', uuid: inputId, session_id: id, message: { role: 'user', content: text }, parent_tool_use_id: null, timestamp: new Date().toISOString() });
    entry.feed.push({ type: 'user', uuid: inputId, message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: id });
    notify(id);
    return { sessionId: id, runId };
  }

  async function withQuery<T>(use: (query: ClaudeQuery) => Promise<T>): Promise<T> {
    const feed = createFeed();
    const query = (await sdk()).query({ prompt: feed, options: { cwd: workspace } });
    try { return await use(query); }
    finally { feed.end(); query.close(); }
  }

  const chat: Chat = {
    settings: async (sessionId) => settingsOf(sessionId),

    async configure(sessionId, patch) {
      checkSettings(patch);
      const next = { ...settingsOf(sessionId), ...patch };
      settings.set(sessionId, next);
      const held = live.get(sessionId);
      if (held !== undefined && !held.running) {
        const model = modelIdOf(next.model);
        await held.query.setModel(model === '' ? undefined : model);
      }
      notify(sessionId);
      return next;
    },

    async models() {
      const listed = await withQuery((query) => query.supportedModels());
      return listed.map((model): ModelRow => ({
        id: model.value,
        name: model.displayName,
        features: { tools: true, streaming: true, images: true, structuredOutput: true, reasoning: true },
        provider: CLAUDE_PROVIDER,
        ref: `${CLAUDE_PROVIDER}/${model.value}`,
      }));
    },

    async skills() {
      const commands = await withQuery((query) => query.supportedCommands());
      return commands.map((command): SkillIndexEntry => ({ name: command.name, description: command.description, ref: command.name }));
    },

    async sessions() {
      const listed = await (await sdk()).listSessions({ dir: workspace });
      return listed.map((info): SessionRow => ({
        id: info.sessionId,
        title: titleOfInfo(info),
        activity: activityOf(live.get(info.sessionId)),
        workspace,
        createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
        updatedAt: new Date(info.lastModified).toISOString(),
      })).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    async snapshot(sessionId) {
      const messages = await messagesOf(sessionId);
      const held = live.get(sessionId);
      const running = held?.running === true;
      const { turns, pending } = projectSession(messages, {
        running,
        pending: held?.decision !== null && held?.decision !== undefined ? pendingOf(held.decision) : null,
        errors: errorsOf(sessionId),
      });
      const listed = (await (await sdk()).listSessions({ dir: workspace })).find((info) => info.sessionId === sessionId);
      const now = new Date().toISOString();
      const session: SessionRow = {
        id: sessionId,
        title: listed !== undefined ? titleOfInfo(listed) : titleOf([], turns[0]?.input.trim() || sessionId),
        activity: activityOf(held),
        workspace,
        createdAt: listed !== undefined ? new Date(listed.createdAt ?? listed.lastModified).toISOString() : now,
        updatedAt: listed !== undefined ? new Date(listed.lastModified).toISOString() : now,
      };
      return { session, settings: settingsOf(sessionId), turns, pending, running } satisfies Snapshot;
    },

    say: ({ sessionId, text, settings: patch }) => send(sessionId, text, patch),

    wait: async (sessionId) => live.get(sessionId)?.turn?.outcome,

    async approve(sessionId, args) {
      const decision = decisionOf(sessionId);
      decision.resolve(approval(decision, args?.always === true));
    },

    async deny(sessionId, args) {
      const decision = decisionOf(sessionId);
      decision.resolve(denial(args?.reason ?? (decision.toolName === ASK_TOOL ? 'The user declined to answer' : 'Denied by the user')));
    },

    async answer(sessionId, answers) {
      const decision = decisionOf(sessionId);
      if (decision.toolName !== ASK_TOOL) throw new AgentError({ code: 'invalid_options', message: `session ${sessionId} is waiting on an approval, not on answers` });
      decision.resolve(answered(decision, answers));
    },

    async cancel(sessionId) {
      const held = live.get(sessionId);
      if (held === undefined) return;
      if (held.decision !== null) { held.decision.resolve(denial('cancelled by the user')); return; }
      if (held.running) await held.query.interrupt();
    },

    compact: (sessionId) => send(sessionId, COMPACT_COMMAND),

    async remove(sessionId) {
      const held = live.get(sessionId);
      if (held !== undefined) { held.feed.end(); held.query.close(); live.delete(sessionId); }
      settings.delete(sessionId);
      errors.delete(sessionId);
      await (await sdk()).deleteSession(sessionId, { dir: workspace });
      notify(sessionId);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async close() {
      for (const [sessionId, held] of live) {
        held.decision?.resolve(denial('papo closed before the decision was made'));
        held.feed.end();
        held.query.close();
        live.delete(sessionId);
      }
    },
  };

  function decisionOf(sessionId: string): ClaudeDecision {
    const decision = live.get(sessionId)?.decision;
    if (decision === null || decision === undefined) throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not waiting on a decision` });
    return decision;
  }

  return chat;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };

/** `claude/<model>` → `<model>`; a bare id passes through. */
function modelIdOf(ref: string): string {
  return ref.startsWith(`${CLAUDE_PROVIDER}/`) ? ref.slice(CLAUDE_PROVIDER.length + 1) : ref;
}

function activityOf(held: Live | undefined): SessionRow['activity'] {
  if (held === undefined) return 'idle';
  if (held.decision !== null) return 'awaiting';
  return held.running ? 'running' : 'idle';
}

function outcomeOf(result: SDKResultMessage): RunOutcome {
  const usage: Usage = {
    inputTokens: result.usage.input_tokens + result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens,
    outputTokens: result.usage.output_tokens,
  };
  if (result.terminal_reason === 'aborted_streaming' || result.terminal_reason === 'aborted_tools') {
    return { status: 'cancelled', reason: 'interrupted', usage, steps: result.num_turns };
  }
  if (result.subtype === 'success') {
    return { status: 'completed', message: { id: result.uuid, role: 'assistant', source: 'model', parts: [{ type: 'text', text: result.result }], createdAt: new Date().toISOString() }, usage, steps: result.num_turns };
  }
  return { status: 'failed', error: { code: result.subtype, message: result.errors.join('; ') || result.subtype }, usage, steps: result.num_turns };
}

function titleOfInfo(info: SDKSessionInfo): string {
  return info.customTitle || info.summary || info.firstPrompt || info.sessionId;
}
