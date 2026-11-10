import { isAbsolute } from 'node:path';
import type { RunOutcome } from '@cofold/agents';
import { AgentError } from '@cofold/agents';
import type { ChatPendingInput } from '@textui/chat';
import type {
  AcpServer, AcpServerOptions, ClientCapabilities, ContentBlock, ElicitationResponse, RequestPermissionOutcome, SessionInfo, SessionSetup, SessionUpdate, StopReason,
} from '../types/acp.js';
import type { Chat, ModelRow } from '../types/chat.js';
import type { Settings } from '../types/settings.js';
import type { Turn } from '../types/turn.js';
import { answersOf, decisionOf, formOf, permissionOf } from './pending.js';
import { baseline, emptySent, project } from './project.js';
import type { Sent } from './project.js';
import { INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, RESOURCE_NOT_FOUND, RpcError, createPeer } from './rpc.js';
import { configOptionsOf, patchOf, setupOf } from './settings.js';

export const PROTOCOL_VERSION = 1;

/** What a prompt is answered with. */
interface PromptAnswer {
  stopReason: StopReason;
  usage?: { totalTokens: number; inputTokens: number; outputTokens: number; thoughtTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number };
}

/** A `session/prompt` waiting on the turn it started or steered; `queued` waits one turn longer, a slash line said during a turn. */
interface Waiter {
  queued: boolean;
  resolve(answer: PromptAnswer): void;
  reject(error: unknown): void;
}

/** One session a client opened here, and what it has been told of it. */
interface Open {
  sessionId: string;
  cwd: string;
  chat: Chat;
  sent: Sent;
  /** The pending block put to the client, so the same one is not asked twice. */
  asked: string | undefined;
  waiters: Waiter[];
  watching: boolean;
  flushing: Promise<void> | undefined;
  dirty: boolean;
  /** Woken on each change of the session. */
  wakers: (() => void)[];
  /** What the client was last told, so a change made elsewhere is sent and its own is not echoed. */
  settings: Settings | undefined;
  title: string | undefined;
  steps: number;
  /** The newest turn the last projection saw, and the turns whose prompts were answered. */
  newest: string | undefined;
  answered: Set<string>;
  closed: boolean;
}

/**
 * `copapo acp`: an ACP agent on stdin and stdout, over copapo's `Chat` on either backend.
 *
 * The service is a front like the screen: it reads the snapshot on each change and tells the client what
 * is new, as `session/update`; a block waiting on a person becomes a request to the client, and the
 * answer goes back to the service. Nothing is kept on disk here.
 */
export function serveAcp(options: AcpServerOptions): AcpServer {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`copapo acp: ${message}\n`));
  const peer = createPeer({ input: options.stdin ?? process.stdin, output: options.stdout ?? process.stdout, warn });
  /** One service per `cwd`, built when a session there is first named. */
  const chats = new Map<string, Chat>();
  const opened = new Map<string, Open>();
  /** The models each service offers, asked once: a listing may reach the network. */
  const listed = new Map<Chat, Promise<ModelRow[]>>();
  let client: ClientCapabilities = {};

  function chatOf(cwd: unknown): Chat {
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new RpcError(INVALID_PARAMS, 'cwd must be an absolute path');
    let chat = chats.get(cwd);
    if (chat !== undefined) return chat;
    try { chat = options.chatFor(cwd); } catch (error: unknown) { throw new RpcError(INVALID_PARAMS, error instanceof Error ? error.message : String(error)); }
    const owner = chat;
    chats.set(cwd, owner);
    owner.subscribe((sessionId) => {
      const open = opened.get(sessionId);
      if (open === undefined || open.chat !== owner) return;
      schedule(open);
      for (const wake of open.wakers.splice(0)) wake();
    });
    return owner;
  }

  const modelsOf = (chat: Chat): Promise<ModelRow[]> => {
    let held = listed.get(chat);
    if (held === undefined) { held = chat.models().catch(() => []); listed.set(chat, held); }
    return held;
  };

  function need(sessionId: unknown): Open {
    const open = typeof sessionId === 'string' ? opened.get(sessionId) : undefined;
    if (open === undefined) throw new RpcError(RESOURCE_NOT_FOUND, `session ${String(sessionId)} is not open here; send session/new, session/load or session/resume first`);
    return open;
  }

  const update = (open: Open, change: SessionUpdate): void => { peer.notify('session/update', { sessionId: open.sessionId, update: change }); };

  async function openSession(sessionId: string, cwd: string, chat: Chat, sent: Sent): Promise<{ open: Open; setup: SessionSetup }> {
    const settings = await chat.settings(sessionId);
    const open: Open = {
      sessionId, cwd, chat, sent, asked: undefined, waiters: [], watching: false, flushing: undefined, dirty: false,
      wakers: [], settings, title: undefined, steps: 0, newest: undefined, answered: new Set(), closed: false,
    };
    try {
      const snapshot = await chat.snapshot(sessionId);
      open.title = snapshot.session.title;
      open.steps = snapshot.turns.reduce((sum, turn) => sum + turn.steps, 0);
      for (const turn of snapshot.turns) open.answered.add(turn.id);
    } catch { /* a session the runtime has not written yet */ }
    opened.set(sessionId, open);
    // After the answer: a client learns the id from it before any update about the session.
    setImmediate(() => { void sendCommands(open); schedule(open); });
    return { open, setup: setupOf(settings, await modelsOf(chat)) };
  }

  async function sendCommands(open: Open): Promise<void> {
    try {
      const commands = await open.chat.commands();
      update(open, {
        sessionUpdate: 'available_commands_update',
        availableCommands: commands.map((command) => ({ name: command.name, description: command.description, ...(command.argumentHint !== undefined ? { input: { hint: command.argumentHint } } : {}) })),
      });
    } catch (error: unknown) {
      warn(`session ${open.sessionId}: the commands could not be listed: ${messageOf(error)}`);
    }
  }

  /** A projection of the session soon; one at a time, and once more if it changed meanwhile. */
  function schedule(open: Open): void {
    if (open.closed) return;
    if (open.flushing !== undefined) { open.dirty = true; return; }
    open.flushing = (async () => {
      do { open.dirty = false; await flushOnce(open); } while (open.dirty && !open.closed);
    })().catch((error: unknown) => warn(`session ${open.sessionId}: ${messageOf(error)}`)).finally(() => { open.flushing = undefined; });
  }

  /** Resolves once a projection that started after this call has finished. */
  async function flush(open: Open): Promise<void> {
    schedule(open);
    while (open.flushing !== undefined) await open.flushing;
  }

  async function flushOnce(open: Open): Promise<void> {
    let snapshot;
    try { snapshot = await open.chat.snapshot(open.sessionId); } catch { return; }
    const projected = project(snapshot, open.sent);
    open.sent = projected.sent;
    open.newest = snapshot.turns.at(-1)?.id;
    for (const change of projected.updates) update(open, change);

    const told = open.settings;
    if (told !== undefined) {
      if (snapshot.settings.permissions !== told.permissions) update(open, { sessionUpdate: 'current_mode_update', currentModeId: snapshot.settings.permissions });
      if (snapshot.settings.model !== told.model || snapshot.settings.reasoning !== told.reasoning) {
        update(open, { sessionUpdate: 'config_option_update', configOptions: configOptionsOf(snapshot.settings, await modelsOf(open.chat)) });
      }
    }
    open.settings = snapshot.settings;

    if (snapshot.session.title !== open.title) {
      open.title = snapshot.session.title;
      update(open, { sessionUpdate: 'session_info_update', title: snapshot.session.title, updatedAt: snapshot.session.updatedAt });
    }

    const steps = snapshot.turns.reduce((sum, turn) => sum + turn.steps, 0);
    if (steps !== open.steps) {
      open.steps = steps;
      const fill = await open.chat.context(open.sessionId).catch(() => undefined);
      if (fill !== undefined) update(open, { sessionUpdate: 'usage_update', used: fill.used, size: fill.size });
    }

    const { pending } = snapshot;
    if (pending === null) open.asked = undefined;
    else if (pending.id !== open.asked) {
      open.asked = pending.id;
      void ask(open, pending);
    }
  }

  /** The block, put to the client; its answer goes to the service. A client that cannot answer gets the call denied, so no turn waits forever. */
  async function ask(open: Open, pending: ChatPendingInput): Promise<void> {
    const { chat, sessionId } = open;
    try {
      if (pending.kind === 'toolConfirmation') {
        const { toolCall, options: choices } = permissionOf(pending);
        const answer = (await peer.request('session/request_permission', { sessionId, toolCall, options: choices })) as { outcome?: RequestPermissionOutcome } | null;
        const decision = decisionOf(answer?.outcome);
        if (decision.approve) await chat.approve(sessionId, decision.always === true ? { always: true } : undefined);
        else await chat.deny(sessionId, { reason: answer?.outcome?.outcome === 'cancelled' ? 'The turn was stopped' : 'Rejected in the client' });
        return;
      }
      if (client.elicitation?.form === undefined || client.elicitation.form === null) {
        await chat.deny(sessionId, { reason: 'The client cannot show a question form' });
        return;
      }
      const form = formOf(pending);
      const response = (await peer.request('elicitation/create', { mode: 'form', sessionId, message: form.message, requestedSchema: form.requestedSchema })) as ElicitationResponse | null;
      const answers = answersOf(response ?? undefined, form.keys);
      if (answers !== undefined) await chat.answer(sessionId, answers);
      else await chat.deny(sessionId, { reason: 'Declined in the client' });
    } catch (error: unknown) {
      // Answered elsewhere already (a cancel denies what waits): nothing is left to decide.
      if (error instanceof AgentError && error.code === 'not_found') return;
      warn(`session ${sessionId}: the question could not be answered: ${messageOf(error)}`);
      await chat.deny(sessionId, { reason: 'The client could not answer' }).catch(() => {});
    }
  }

  /** Follows the session's turns while prompts wait on them, answering each as its turn ends. */
  async function watch(open: Open): Promise<void> {
    if (open.watching) return;
    open.watching = true;
    let last: RunOutcome | undefined;
    try {
      while (open.waiters.length > 0 && !open.closed) {
        const outcome = await open.chat.wait(open.sessionId);
        if (outcome === undefined) {
          // Nothing attached: the turn may have ended between two waits, and only the store says how.
          const snapshot = await open.chat.snapshot(open.sessionId).catch(() => undefined);
          const turn = snapshot?.turns.at(-1);
          if (snapshot !== undefined && !snapshot.running && turn !== undefined && !open.answered.has(turn.id)) {
            await flush(open);
            settle(open, outcomeOf(turn), turn.id);
            continue;
          }
          await changed(open);
          continue;
        }
        if (outcome === last) { await changed(open); continue; }
        last = outcome;
        // The block goes to the client; the next wait follows the turn past it, whoever answers and however.
        if (outcome.status === 'awaiting') { await flush(open); continue; }
        await flush(open);
        settle(open, outcome, open.newest);
      }
    } finally {
      open.watching = false;
    }
  }

  /** The next change of the session, or a second, whichever is first: a missed wake costs a second, not the prompt. */
  const changed = (open: Open): Promise<void> => new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    open.wakers.push(() => { clearTimeout(timer); resolve(); });
  });

  function settle(open: Open, outcome: RunOutcome, turnId: string | undefined): void {
    if (turnId !== undefined) open.answered.add(turnId);
    const answer = answerOf(outcome);
    // A cancel holds the queue, so nothing waits one turn longer after it.
    const settled = outcome.status === 'cancelled' ? open.waiters.splice(0) : open.waiters.filter((waiter) => !waiter.queued);
    open.waiters = open.waiters.filter((waiter) => !settled.includes(waiter));
    for (const waiter of open.waiters) waiter.queued = false;
    for (const waiter of settled) {
      if (answer instanceof RpcError) waiter.reject(answer);
      else waiter.resolve(answer);
    }
  }

  function closeSession(open: Open, reason: StopReason | RpcError): void {
    open.closed = true;
    opened.delete(open.sessionId);
    for (const waiter of open.waiters.splice(0)) {
      if (reason instanceof RpcError) waiter.reject(reason);
      else waiter.resolve({ stopReason: reason });
    }
    for (const wake of open.wakers.splice(0)) wake();
  }

  peer.handle('initialize', (params) => {
    client = (params['clientCapabilities'] as ClientCapabilities | undefined) ?? {};
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { list: {}, delete: {}, fork: {}, resume: {}, close: {} },
      },
      authMethods: [],
      agentInfo: options.agentInfo,
    };
  });

  // copapo's keys are in its configuration; there is nothing to sign in to.
  peer.handle('authenticate', () => ({}));

  peer.handle('session/new', (params) => rpc(async () => {
    const chat = chatOf(params['cwd']);
    const sessionId = await chat.create();
    const { setup } = await openSession(sessionId, params['cwd'] as string, chat, emptySent());
    return { sessionId, ...setup };
  }));

  peer.handle('session/load', (params) => rpc(async () => {
    const chat = chatOf(params['cwd']);
    const sessionId = stringOf(params['sessionId'], 'sessionId');
    const snapshot = await chat.snapshot(sessionId);
    // The transcript first, as the person's and the agent's messages, then the answer.
    const replayed = project(snapshot, emptySent(), { replay: true });
    const open = opened.get(sessionId);
    if (open !== undefined) closeSession(open, 'cancelled');
    for (const change of replayed.updates) peer.notify('session/update', { sessionId, update: change });
    const { setup } = await openSession(sessionId, params['cwd'] as string, chat, replayed.sent);
    return setup;
  }));

  peer.handle('session/resume', (params) => rpc(async () => {
    const chat = chatOf(params['cwd']);
    const sessionId = stringOf(params['sessionId'], 'sessionId');
    const snapshot = await chat.snapshot(sessionId);
    const held = opened.get(sessionId);
    if (held !== undefined && held.chat === chat) return setupOf(await chat.settings(sessionId), await modelsOf(chat));
    if (held !== undefined) closeSession(held, 'cancelled');
    const { setup } = await openSession(sessionId, params['cwd'] as string, chat, baseline(snapshot));
    return setup;
  }));

  peer.handle('session/fork', (params) => rpc(async () => {
    const chat = chatOf(params['cwd']);
    const row = await chat.fork(stringOf(params['sessionId'], 'sessionId'));
    const { setup } = await openSession(row.id, params['cwd'] as string, chat, baseline(await chat.snapshot(row.id)));
    return { sessionId: row.id, ...setup };
  }));

  peer.handle('session/list', (params) => rpc(async () => {
    const cwd = typeof params['cwd'] === 'string' ? params['cwd'] : options.workspace;
    const rows = await chatOf(cwd).sessions();
    return {
      sessions: rows.map((row): SessionInfo => ({ sessionId: row.id, cwd: row.workspace ?? cwd, title: row.title, updatedAt: row.updatedAt })),
    };
  }));

  peer.handle('session/close', (params) => rpc(async () => {
    const open = opened.get(stringOf(params['sessionId'], 'sessionId'));
    if (open === undefined) return {};
    if (open.waiters.length > 0) await open.chat.cancel(open.sessionId).catch(() => {});
    closeSession(open, 'cancelled');
    return {};
  }));

  peer.handle('session/delete', (params) => rpc(async () => {
    const sessionId = stringOf(params['sessionId'], 'sessionId');
    const open = opened.get(sessionId);
    const chat = open?.chat ?? chatOf(options.workspace);
    if (open !== undefined) closeSession(open, 'cancelled');
    await chat.remove(sessionId);
    return {};
  }));

  peer.handle('session/set_mode', (params) => rpc(async () => {
    const open = need(params['sessionId']);
    open.settings = await open.chat.configure(open.sessionId, { permissions: stringOf(params['modeId'], 'modeId') as Settings['permissions'] });
    return {};
  }));

  peer.handle('session/set_config_option', (params) => rpc(async () => {
    const open = need(params['sessionId']);
    const configId = stringOf(params['configId'], 'configId');
    const patch = patchOf(configId, params['value']);
    if (patch === undefined) throw new RpcError(INVALID_PARAMS, `copapo has no config option ${configId}`);
    open.settings = await open.chat.configure(open.sessionId, patch);
    return { configOptions: configOptionsOf(open.settings, await modelsOf(open.chat)) };
  }));

  peer.handle('session/prompt', (params) => rpc(async () => {
    const open = need(params['sessionId']);
    const text = textOf(params['prompt']);
    if (text === '') throw new RpcError(INVALID_PARAMS, 'the prompt has no text');
    const started = await open.chat.say({ sessionId: open.sessionId, text });
    const answer = new Promise<PromptAnswer>((resolve, reject) => { open.waiters.push({ queued: started.queued === true, resolve, reject }); });
    schedule(open);
    void watch(open);
    return answer;
  }));

  peer.on('session/cancel', (params) => {
    const open = typeof params['sessionId'] === 'string' ? opened.get(params['sessionId']) : undefined;
    if (open === undefined) return;
    void open.chat.cancel(open.sessionId).catch((error: unknown) => warn(`session ${open.sessionId}: ${messageOf(error)}`));
  });

  const closed = peer.closed.then(async () => {
    for (const open of [...opened.values()]) closeSession(open, 'cancelled');
    await Promise.allSettled([...chats.values()].map((chat) => chat.close()));
  });

  return { closed };
}

/** The service's refusals as JSON-RPC errors a client can show. */
async function rpc<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof AgentError) {
      if (error.code === 'not_found') throw new RpcError(RESOURCE_NOT_FOUND, error.message);
      if (error.code === 'invalid_options') throw new RpcError(INVALID_PARAMS, error.message);
      if (error.code === 'writer_busy') throw new RpcError(INVALID_REQUEST, error.message);
    }
    throw error;
  }
}

function stringOf(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new RpcError(INVALID_PARAMS, `${name} must be a string`);
  return value;
}

/** The prompt's text: its text blocks, and a linked resource as its URI. Images and embedded resources are not offered. */
function textOf(prompt: unknown): string {
  if (!Array.isArray(prompt)) throw new RpcError(INVALID_PARAMS, 'prompt must be a list of content blocks');
  return (prompt as ContentBlock[]).map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'resource_link') return block.uri;
    return '';
  }).filter((line) => line !== '').join('\n');
}

/** How the turn ended, as ACP says it, or the error that carries why it did not finish. */
function answerOf(outcome: RunOutcome): PromptAnswer | RpcError {
  const usage = {
    totalTokens: outcome.usage.inputTokens + outcome.usage.outputTokens,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    ...(outcome.usage.reasoningTokens !== undefined ? { thoughtTokens: outcome.usage.reasoningTokens } : {}),
    ...(outcome.usage.cacheReadTokens !== undefined ? { cachedReadTokens: outcome.usage.cacheReadTokens } : {}),
    ...(outcome.usage.cacheWriteTokens !== undefined ? { cachedWriteTokens: outcome.usage.cacheWriteTokens } : {}),
  };
  switch (outcome.status) {
    case 'completed': return { stopReason: 'end_turn', usage };
    case 'cancelled': return { stopReason: 'cancelled', usage };
    case 'stopped':
      if (outcome.reason === 'hook') return { stopReason: 'end_turn', usage };
      if (outcome.reason === 'max_steps') return { stopReason: 'max_turn_requests', usage };
      return new RpcError(INTERNAL_ERROR, `stopped: ${outcome.reason}`);
    case 'failed': return new RpcError(INTERNAL_ERROR, outcome.error.message, { code: outcome.error.code });
    case 'awaiting': return new RpcError(INTERNAL_ERROR, 'the turn is waiting on a decision');
  }
}

/** A turn the store holds as ended, as the outcome it ended with; enough for `answerOf`. */
function outcomeOf(turn: Turn): RunOutcome {
  const tally = { usage: turn.usage, steps: turn.steps };
  if (turn.state === 'cancelled') return { status: 'cancelled', ...tally };
  if (turn.state === 'failed') {
    const why = turn.parts.find((part) => part.kind === 'error');
    return { status: 'failed', error: { code: 'failed', message: why?.kind === 'error' ? why.message : 'The turn failed.' }, ...tally };
  }
  return { status: 'completed', message: { id: turn.id, role: 'assistant', source: 'model', createdAt: turn.endedAt ?? turn.startedAt, parts: [] }, ...tally };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
