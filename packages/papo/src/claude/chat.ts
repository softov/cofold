import { randomUUID } from 'node:crypto';
import type { CanUseTool, Options, SDKMessage, SDKResultMessage, SDKSessionInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RunOutcome, RunUsage, SessionUsage, SkillIndexEntry, Usage } from '@cofold/agents';
import { AgentError, ZERO_USAGE, addUsage, newId } from '@cofold/agents';
import { createFileStore } from '@cofold/store-file';
import { settingsKey } from '../chat.js';
import { DEFAULT_INSTRUCTIONS } from '../config.js';
import { createQueues } from '../queue.js';
import { checkRules } from '../rules.js';
import { COMPACTED_INPUT, shortTitle } from '../turns.js';
import type { Chat, ChatListener, ClaudeChatOptions, ModelRow, Started } from '../types/chat.js';
import type { ClaudeDecision, ClaudeMessage, ClaudeQuery, ClaudeSdkSubset, ClaudeSessionMessage } from '../types/claude.js';
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
  mode: Settings['permissions'];
  running: boolean;
  decision: ClaudeDecision | null;
  /** The turn in flight is the CLI's `/compact`. */
  compacting: boolean;
  /** The turn in flight: what `wait` resolves to, settled by a decision to make or the CLI's result. */
  turn: { runId: string; inputId: string; resolve(outcome: RunOutcome): void; outcome: Promise<RunOutcome> } | undefined;
  /** The uuids pushed while the turn ran (steers, decision 95); the CLI takes them into the turn, or runs each as the next one. */
  pushed: string[];
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
 * waiting on. Every read projects `getSessionMessages` plus what is live here. A session's settings
 * are the one thing kept on papo's side, in the file store's kv under `home`, where the harness
 * backend keeps its own (CLI-03 decision 6).
 */
export function createClaudeChat(options: ClaudeChatOptions): Chat {
  const { config, workspace, home } = options;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`papo: ${message}\n`));
  const listeners = new Set<ChatListener>();
  const live = new Map<string, Live>();
  /** Per-session choices, under the same key the harness backend writes, so `session set` reads one thing on both. */
  const kv = createFileStore({ root: home }).kv({ kind: 'workspace', workspace });
  /** Failed turns by session, keyed by the turn's input uuid; the CLI's store keeps no trace of them. */
  const errors = new Map<string, Record<string, string>>();
  const errorsOf = (sessionId: string): Record<string, string> => { let held = errors.get(sessionId); if (held === undefined) { held = {}; errors.set(sessionId, held); } return held; };
  let sdkLoaded: Promise<ClaudeSdkSubset> | undefined;
  const sdk = (): Promise<ClaudeSdkSubset> => (sdkLoaded ??= options.sdk !== undefined ? Promise.resolve(options.sdk) : loadClaudeSdk());
  const notify = (sessionId: string): void => { for (const listener of listeners) listener(sessionId); };
  /** The next turns, in memory (CLI-04.1), the same list the harness backend keeps; the head is sent when a turn settles, or at once while idle. */
  const queues = createQueues({
    start: (sessionId, head) => send(sessionId, head.text, head.settings),
    idle: async (sessionId) => { const held = live.get(sessionId); return held === undefined || (!held.running && held.decision === null); },
    warn,
    notify,
  });

  // A configured model of another provider is not for this backend: the CLI's default is used. Read each time it is
  // needed, not once: a pick on the model chip changes `config.model` while papo runs (decision CLI-05.1).
  const configured = (): string => (config.model !== undefined && config.model.startsWith(`${CLAUDE_PROVIDER}/`) ? config.model : '');
  if (config.model !== undefined && configured() === '') warn(`model "${config.model}" is not written ${CLAUDE_PROVIDER}/<model>; the claude backend uses the CLI's default`);
  const defaults = (): Settings => ({ model: configured(), permissions: config.permissions, reasoning: config.reasoning, autoCompact: true });

  /** The defaults under the session's own choices, read from the kv; nothing is cached, so a restart reads the same. */
  async function settingsOf(sessionId: string | undefined): Promise<Settings> {
    const own = sessionId === undefined ? undefined : await kv.get<Partial<Settings>>(settingsKey(sessionId));
    return { ...defaults(), ...own };
  }

  async function patchSettings(sessionId: string, patch: Partial<Settings>): Promise<Settings> {
    checkSettings(patch);
    const held = (await kv.get<Partial<Settings>>(settingsKey(sessionId))) ?? {};
    await kv.set(settingsKey(sessionId), { ...held, ...patch });
    return settingsOf(sessionId);
  }

  function checkSettings(patch: Partial<Settings>): void {
    // The screen sends every setting it shows; only turning the CLI's compaction off is refused.
    if (patch.autoCompact === false) {
      throw new AgentError({ code: 'invalid_options', message: 'the claude backend compacts on its own; autocompact cannot be turned off there' });
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
    // Kept and listed like the harness backend's; the CLI applies its own settings files, not these.
    if (patch.rules !== undefined) checkRules(patch.rules);
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
      // The four names are the CLI's own (cli/03 F8), passed through; papo's rule lists are the harness backend's,
      // the CLI reads its own settings files (`settingSources`). `bypassPermissions` needs the flag the SDK asks for.
      permissionMode: chosen.permissions,
      ...(chosen.permissions === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      canUseTool,
      systemPrompt: { type: 'preset', preset: 'claude_code', ...(append !== undefined ? { append } : {}) },
      settingSources: ['user', 'project'],
    };
  }

  /** Starts the process for a session and reads it to its end in the background. */
  async function start(sessionId: string, chosen: Settings, resume: boolean): Promise<Live> {
    const feed = createFeed();
    const entry: Live = { query: undefined as unknown as ClaudeQuery, feed, effort: chosen.reasoning, mode: chosen.permissions, running: false, decision: null, compacting: false, turn: undefined, pushed: [], seen: [] };
    const canUseTool: CanUseTool = async (toolName, input, opts) => {
      return new Promise((resolve) => {
        const requestId = opts.requestId ?? newId();
        entry.decision = {
          requestId,
          toolUseId: opts.toolUseID ?? requestId,
          toolName,
          input,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          suggestions: opts.suggestions ?? [],
          suppressAlways: opts.suppressAlwaysAllowRule === true,
          resolve: (result) => { entry.decision = null; resolve(result); notify(sessionId); },
        };
        // As the harness pauses: whoever waits on the turn learns it needs a decision, and waits again after.
        if (entry.turn !== undefined) {
          const { runId, inputId, resolve: pause } = entry.turn;
          entry.turn = deferred(runId, inputId);
          pause({ status: 'awaiting', sessionId, runId, requestId, kind: toolName === ASK_TOOL ? 'input' : 'approval', usage: ZERO, steps: 0 });
        }
        notify(sessionId);
      });
    };
    entry.query = (await sdk()).query({ prompt: feed, options: optionsFor(sessionId, chosen, resume, canUseTool) });
    live.set(sessionId, entry);
    /**
     * A process that ends mid-turn fails that turn; the store keeps no trace, so the error is kept
     * here. A process this service already let go of (`remove`, or replaced for a new effort) records
     * nothing: its turn is settled so a waiter wakes, and the session has no failed turn to show.
     * Returns the outcome a turn in flight ended with, for the queue to act on.
     */
    const ended = (code: 'interrupted' | 'internal', message: string): RunOutcome | undefined => {
      if (live.get(sessionId) !== entry) { settle(entry, { status: 'cancelled', reason: 'the session was removed', usage: ZERO, steps: 0 }); return undefined; }
      const turn = entry.turn;
      if (turn !== undefined) errorsOf(sessionId)[turn.inputId] = message;
      const outcome: RunOutcome = { status: 'failed', error: { code, message }, usage: ZERO, steps: 0 };
      settle(entry, outcome);
      return turn !== undefined ? outcome : undefined;
    };
    void (async () => {
      let outcome: RunOutcome | undefined;
      try {
        for await (const message of entry.query) handle(sessionId, entry, message);
        outcome = ended('interrupted', 'the claude process ended');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`session ${sessionId}: ${message}`);
        outcome = ended('internal', message);
      } finally {
        if (live.get(sessionId) === entry) live.delete(sessionId);
        notify(sessionId);
      }
      // After the process is let go of, so the head's `send` starts a fresh one.
      if (outcome !== undefined) await queues.settled(sessionId, outcome.status);
    })();
    return entry;
  }

  function handle(sessionId: string, entry: Live, message: SDKMessage): void {
    if ((message.type === 'assistant' || message.type === 'user') && 'uuid' in message && typeof message.uuid === 'string') {
      // The prompt comes back with the uuid `send` gave it: what is already here is not shown twice.
      const uuid = message.uuid;
      if (!entry.seen.some((held) => held.uuid === uuid)) {
        entry.seen.push({ type: message.type, uuid, session_id: sessionId, message: message.message as ClaudeMessage, parent_tool_use_id: message.parent_tool_use_id, timestamp: new Date().toISOString() });
      }
    } else if (message.type === 'result') {
      const outcome = outcomeOf(message);
      if (outcome.status === 'failed' && entry.turn !== undefined) errorsOf(sessionId)[entry.turn.inputId] = outcome.error.message;
      // After a compaction the store's view is the only true one: what was seen before it is gone from it.
      if (entry.turn !== undefined && entry.compacting) entry.seen = [];
      settle(entry, outcome);
      // A message pushed mid-turn that the CLI kept for after this turn: another result follows without further
      // input (`queued_turn_count`), so the process is still answering and whoever waits learns to wait again.
      const next = (message.queued_turn_count ?? 0) > 0 ? entry.pushed.shift() : undefined;
      if (next !== undefined) {
        entry.turn = deferred(newId(), next);
        entry.running = true;
        notify(sessionId);
        return;
      }
      entry.pushed = [];
      notify(sessionId);
      void queues.settled(sessionId, outcome.status);
      return;
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
      // The effort and the permission mode are process options: a change means a new process on the same session.
      if (held.effort !== chosen.reasoning || held.mode !== chosen.permissions) { held.feed.end(); held.query.close(); live.delete(sessionId); }
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
    // A person spoke: whatever a cancel held back may start again on the next settle (CLI-04.1).
    queues.release(id);
    const chosen = patch !== undefined ? await patchSettings(id, patch) : await settingsOf(id);
    if (held?.running && held.turn !== undefined) {
      // The prompt stays open for the life of the process, so a message pushed mid-turn is the CLI's to
      // take into the running turn, as the reference does (ahpd `steer`); shown here until the store has it.
      const uuid = randomUUID();
      held.pushed.push(uuid);
      held.seen.push({ type: 'user', uuid, session_id: id, message: { role: 'user', content: text }, parent_tool_use_id: null, timestamp: new Date().toISOString() });
      held.feed.push({ type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: id });
      notify(id);
      return { sessionId: id, runId: held.turn.runId, steered: true };
    }
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
    settings: settingsOf,

    async configure(sessionId, patch) {
      const next = await patchSettings(sessionId, patch);
      const held = live.get(sessionId);
      if (held !== undefined && !held.running) {
        const model = modelIdOf(next.model);
        await held.query.setModel(model === '' ? undefined : model);
      }
      notify(sessionId);
      return next;
    },

    providers: async () => [{ id: CLAUDE_PROVIDER, key: false, default: true }],

    async models({ provider } = {}) {
      if (provider !== undefined && provider !== CLAUDE_PROVIDER) {
        throw new AgentError({ code: 'invalid_options', message: `provider "${provider}" is not configured; configured: ${CLAUDE_PROVIDER}` });
      }
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
      const rows = listed.map((info): SessionRow => ({
        id: info.sessionId,
        title: titleOfInfo(info),
        activity: activityOf(live.get(info.sessionId)),
        workspace,
        createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
        updatedAt: new Date(info.lastModified).toISOString(),
      }));
      // A session started here that the CLI has not written yet (it writes after the first result, CLI-03 F5).
      const known = new Set(rows.map((row) => row.id));
      for (const [sessionId, held] of live) {
        if (known.has(sessionId) || held.seen.length === 0) continue;
        const first = held.seen[0]!;
        const text = typeof first.message.content === 'string' ? first.message.content : '';
        rows.push({ id: sessionId, title: shortTitle(text, sessionId), activity: activityOf(held), workspace, createdAt: first.timestamp ?? '', updatedAt: held.seen.at(-1)?.timestamp ?? '' });
      }
      return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    /**
     * What the CLI reported per turn, summed (CLI-06.1): its result frame's usage and `num_turns` are the
     * turn's tokens and steps, and every tool part is a call. A call the CLI refused comes back as a tool
     * result with an error, the same as a tool that ran and failed, so `denials` is 0 on this backend.
     */
    async usage(sessionId) {
      const messages = await messagesOf(sessionId);
      if (messages.length === 0) throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not there` });
      const held = live.get(sessionId);
      const { turns } = projectSession(messages, { running: held?.running === true, pending: null, errors: errorsOf(sessionId) });
      const runs: RunUsage[] = turns.map((turn) => {
        return {
          runId: turn.id,
          status: turn.state === 'running' ? 'running' : turn.state === 'complete' ? 'completed' : turn.state,
          createdAt: turn.startedAt,
          usage: turn.usage,
          steps: turn.steps,
          toolCalls: turn.parts.filter((part) => part.kind === 'tool').length,
          denials: 0,
        };
      });
      return {
        sessionId,
        runs,
        usage: runs.reduce((sum, run) => addUsage(sum, run.usage), ZERO_USAGE),
        steps: runs.reduce((sum, run) => sum + run.steps, 0),
        toolCalls: runs.reduce((sum, run) => sum + run.toolCalls, 0),
        denials: runs.reduce((sum, run) => sum + run.denials, 0),
      } satisfies SessionUsage;
    },

    /** One session's file, not the folder: the row is read off the messages themselves (CLI-03 decision 4). */
    async snapshot(sessionId) {
      const messages = await messagesOf(sessionId);
      const held = live.get(sessionId);
      const running = held?.running === true;
      const { turns, pending } = projectSession(messages, {
        running,
        pending: held?.decision !== null && held?.decision !== undefined ? pendingOf(held.decision) : null,
        errors: errorsOf(sessionId),
      });
      const now = new Date().toISOString();
      const first = turns.find((turn) => turn.input !== COMPACTED_INPUT && turn.input.trim() !== '');
      const session: SessionRow = {
        id: sessionId,
        title: shortTitle(first?.input ?? '', sessionId),
        activity: activityOf(held),
        workspace,
        createdAt: messages[0]?.timestamp ?? now,
        updatedAt: messages.at(-1)?.timestamp ?? now,
      };
      return { session, settings: await settingsOf(sessionId), turns, pending, running, queued: queues.list(sessionId) } satisfies Snapshot;
    },

    say: ({ sessionId, text, settings: patch }) => send(sessionId, text, patch),

    wait: async (sessionId) => {
      // Taken now, before any await: a `remove` or `cancel` issued right after must still settle this waiter.
      const current = live.get(sessionId)?.turn?.outcome;
      if (current !== undefined) return current;
      // Nothing in flight yet: a queued head may be starting (its `send` awaits the settings first).
      await queues.starting(sessionId);
      return live.get(sessionId)?.turn?.outcome;
    },

    async queue({ sessionId, text, settings: patch, id }) {
      if (patch !== undefined) checkSettings(patch);
      return queues.add(sessionId, { text, ...(patch !== undefined ? { settings: patch } : {}), ...(id !== undefined ? { id } : {}) });
    },

    unqueue: async (sessionId, id) => { queues.remove(sessionId, id); },

    queued: async (sessionId) => queues.list(sessionId),

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

    /**
     * Stop the turn, as the reference host does (ahpd's cancel, decision 120): a decision the turn waits on is denied
     * with the same words the harness uses, then the CLI is interrupted, so the turn ends cancelled with its marker.
     * Nothing queued starts after a cancel, until the person says something (CLI-04.1).
     */
    async cancel(sessionId) {
      queues.hold(sessionId);
      const held = live.get(sessionId);
      if (held === undefined) return;
      if (held.decision !== null) held.decision.resolve(denial('The turn was stopped'));
      if (held.running) await held.query.interrupt();
    },

    async compact(sessionId) {
      // The CLI's command is a turn of its own, never a steer into a running one.
      if (live.get(sessionId)?.running) throw new AgentError({ code: 'writer_busy', message: `session ${sessionId} is still answering; wait or cancel it` });
      return send(sessionId, COMPACT_COMMAND);
    },

    async remove(sessionId) {
      const held = live.get(sessionId);
      if (held !== undefined) { held.feed.end(); held.query.close(); live.delete(sessionId); }
      queues.clear(sessionId);
      errors.delete(sessionId);
      await kv.delete(settingsKey(sessionId));
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
    // The SDK's doc: `success` with `is_error` is a turn that ended on an API error, its text in `result` (review R2).
    if (result.is_error) return { status: 'failed', error: { code: 'api_error', message: result.result }, usage, steps: result.num_turns };
    return { status: 'completed', message: { id: result.uuid, role: 'assistant', source: 'model', parts: [{ type: 'text', text: result.result }], createdAt: new Date().toISOString() }, usage, steps: result.num_turns };
  }
  return { status: 'failed', error: { code: result.subtype, message: result.errors.join('; ') || result.subtype }, usage, steps: result.num_turns };
}

function titleOfInfo(info: SDKSessionInfo): string {
  return info.customTitle || info.summary || info.firstPrompt || info.sessionId;
}
