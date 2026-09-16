import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent, PendingRequest, RunHandle, RunRecord } from '@facio/agents';
import { AgentError, newId, resume, run } from '@facio/agents';
import { AGENT_ID, buildAgent } from './agent.js';
import { providerFor } from './config.js';
import { projectTurns, titleOf } from './turns.js';
import type { Chat, ChatListener, ChatOptions, ModelRow, Started } from './types/chat.js';
import type { Settings } from './types/settings.js';
import { PERMISSION_MODES, REASONING_LEVELS } from './types/settings.js';
import type { SessionActivity, SessionRow, Snapshot } from './types/turn.js';

interface Attached {
  handle: RunHandle;
  agent: Agent;
}

/**
 * The harness in this process, for both fronts.
 *
 * Nothing is cached but the attached run handles: every read projects the store, so the screen and
 * the shell agree by construction, and a session written by a process that died reads the same as
 * one written here. An attached run only wakes the listeners on each event.
 */
export function createChat(options: ChatOptions): Chat {
  const { store, config, providers, workspace, home } = options;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`papo: ${message}\n`));
  const attached = new Map<string, Attached>();
  const listeners = new Set<ChatListener>();
  let defaultModel = config.model;
  /** Per-session choices, beside the session's other client state. */
  const kv = store.kv({ kind: 'workspace', workspace });
  const settingsKey = (sessionId: string): string => `papo/session/${sessionId}/settings`;

  const notify = (sessionId: string): void => {
    for (const listener of listeners) listener(sessionId);
  };

  /** How long a provider gets to answer a listing before the screen is told it cannot be reached. */
  const LISTING_MS = 15_000;

  /** The configured model, or the first the first provider lists; asked once, and only when a turn needs it. */
  async function modelRef(): Promise<string> {
    if (defaultModel !== undefined) return defaultModel;
    const first = providers[0];
    const id = config.providers[0]?.id;
    if (first === undefined || id === undefined) {
      throw new AgentError({ code: 'invalid_options', message: 'no provider is configured: set PAPO_BASE_URL or add one to ~/.config/papo/config.json' });
    }
    const listed = await first.listModels({ signal: AbortSignal.timeout(LISTING_MS) });
    const chosen = listed[0];
    if (chosen === undefined) throw new AgentError({ code: 'invalid_options', message: `provider "${id}" lists no models; set model in the configuration` });
    defaultModel = `${id}/${chosen.id}`;
    return defaultModel;
  }

  async function instructions(): Promise<string> {
    let text = config.instructions;
    try {
      const notes = (await readFile(join(workspace, 'AGENTS.md'), 'utf8')).trim();
      if (notes !== '') text = `${text}\n\n${notes}`;
    } catch { /* no AGENTS.md is the common case */ }
    return text;
  }

  /** A patch, checked word by word; the model must name a configured provider. */
  function checkSettings(patch: Partial<Settings>): void {
    if (patch.model !== undefined) providerFor(providers, config, patch.model);
    if (patch.permissions !== undefined && !PERMISSION_MODES.includes(patch.permissions)) {
      throw new AgentError({ code: 'invalid_options', message: `permissions must be one of ${PERMISSION_MODES.join(', ')}` });
    }
    if (patch.reasoning !== undefined && !REASONING_LEVELS.includes(patch.reasoning)) {
      throw new AgentError({ code: 'invalid_options', message: `reasoning must be one of ${REASONING_LEVELS.join(', ')}` });
    }
  }

  /**
   * Reads the store only: an empty `model` means "whatever the first provider lists first", which is
   * asked of the provider when a turn starts, never when a screen opens.
   */
  async function settingsOf(sessionId: string | undefined): Promise<Settings> {
    const own = sessionId === undefined ? undefined : await kv.get<Partial<Settings>>(settingsKey(sessionId));
    return {
      model: own?.model ?? defaultModel ?? '',
      permissions: own?.permissions ?? config.permissions,
      reasoning: own?.reasoning ?? config.reasoning,
    };
  }

  async function agentFor(settings: Settings): Promise<Agent> {
    const model = settings.model === '' ? await modelRef() : settings.model;
    const { provider, modelId } = providerFor(providers, config, model);
    settings = { ...settings, model };
    return buildAgent({
      config, settings, provider, modelId, store, home, workspace, instructions: await instructions(), warn,
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
    });
  }

  /** Watches a handle to its end, waking the listeners on the way; detaches when it settles. */
  function attach(sessionId: string, entry: Attached): void {
    attached.set(sessionId, entry);
    void (async () => {
      try {
        for await (const _event of entry.handle.events) notify(sessionId);
      } catch (error: unknown) {
        warn(`session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    void entry.handle.outcome.finally(() => {
      if (attached.get(sessionId) === entry) attached.delete(sessionId);
      notify(sessionId);
    });
  }

  async function newest(sessionId: string): Promise<RunRecord | undefined> {
    return (await store.runs.list({ sessionId }))[0];
  }

  async function requireSession(sessionId: string): Promise<void> {
    if ((await store.sessions.get({ sessionId })) === undefined) {
      throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not there` });
    }
  }

  /**
   * The handle for the session's newest run, attaching one when this process has none: a run left
   * `awaiting` or `running` by a process that died is resumed here, which is also its recovery.
   */
  async function handleFor(sessionId: string): Promise<{ handle: RunHandle; run: RunRecord }> {
    const run = await newest(sessionId);
    if (run === undefined) throw new AgentError({ code: 'not_found', message: `session ${sessionId} has no run` });
    const held = attached.get(sessionId);
    if (held !== undefined && held.handle.runId === run.runId) return { handle: held.handle, run };
    if (run.status !== 'awaiting' && run.status !== 'running') {
      throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not waiting on anything` });
    }
    const agent = await agentFor(await settingsOf(sessionId));
    const handle = resume({ agent, sessionId, runId: run.runId });
    attach(sessionId, { handle, agent });
    return { handle, run };
  }

  async function submitTo(sessionId: string, build: (requestId: string) => Parameters<RunHandle['submit']>[0]): Promise<void> {
    await requireSession(sessionId);
    const { handle, run } = await handleFor(sessionId);
    if (run.status !== 'awaiting' || run.pendingRequestId === undefined) {
      throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not waiting on a decision` });
    }
    await handle.submit(build(run.pendingRequestId));
  }

  const chat: Chat = {
    settings: settingsOf,

    async configure(sessionId, patch) {
      await requireSession(sessionId);
      checkSettings(patch);
      const held = (await kv.get<Partial<Settings>>(settingsKey(sessionId))) ?? {};
      await kv.set(settingsKey(sessionId), { ...held, ...patch });
      notify(sessionId);
      return settingsOf(sessionId);
    },

    async models() {
      if (providers.length === 0) {
        throw new AgentError({ code: 'invalid_options', message: 'no provider is configured: set PAPO_BASE_URL or add one to ~/.config/papo/config.json' });
      }
      const rows: ModelRow[] = [];
      for (const [index, provider] of providers.entries()) {
        const id = config.providers[index]?.id ?? provider.id;
        for (const model of await provider.listModels({ signal: AbortSignal.timeout(LISTING_MS) })) rows.push({ ...model, provider: id, ref: `${id}/${model.id}` });
      }
      return rows;
    },

    async sessions() {
      const rows: SessionRow[] = [];
      for (const session of await store.sessions.list({ workspace, agentId: AGENT_ID })) {
        const run = await newest(session.sessionId);
        const messages = await store.sessions.listMessages({ sessionId: session.sessionId });
        rows.push({
          id: session.sessionId,
          title: titleOf(messages, session.sessionId),
          activity: activityOf(run),
          ...(session.workspace !== undefined ? { workspace: session.workspace } : {}),
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }
      return rows;
    },

    async snapshot(sessionId) {
      const session = await store.sessions.get({ sessionId });
      if (session === undefined) throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not there` });
      const messages = await store.sessions.listMessages({ sessionId });
      const runs = (await store.runs.list({ sessionId })).reverse();
      const last = runs[runs.length - 1];
      let pending: PendingRequest | undefined;
      if (last?.status === 'awaiting' && last.pendingRequestId !== undefined) {
        pending = await store.requests.get({ sessionId, runId: last.runId, requestId: last.pendingRequestId });
      }
      const errors: Record<string, string> = {};
      for (const failed of runs.filter((run) => run.status === 'failed')) {
        const events = await store.runs.listEvents({ sessionId, runId: failed.runId });
        const finished = events[events.length - 1];
        if (finished?.type === 'run.finished' && finished.outcome.status === 'failed') errors[failed.runId] = finished.outcome.error.message;
      }
      const projected = projectTurns({ messages, runs, pending, errors });
      return {
        settings: await settingsOf(sessionId),
        session: {
          id: sessionId,
          title: titleOf(messages, sessionId),
          activity: activityOf(last),
          ...(session.workspace !== undefined ? { workspace: session.workspace } : {}),
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
        turns: projected.turns,
        pending: projected.pending,
        running: last?.status === 'running' || last?.status === 'awaiting',
      } satisfies Snapshot;
    },

    async say({ sessionId, text, settings: patch }) {
      const id = sessionId ?? newId();
      if (sessionId !== undefined) {
        await requireSession(sessionId);
        const run = await newest(sessionId);
        if (run?.status === 'awaiting') {
          throw new AgentError({ code: 'writer_busy', message: `session ${sessionId} is waiting on a decision; approve, deny or answer it first` });
        }
        if (run?.status === 'running' && attached.has(sessionId)) {
          throw new AgentError({ code: 'writer_busy', message: `session ${sessionId} is still answering; wait or cancel it` });
        }
      }
      if (patch !== undefined) {
        checkSettings(patch);
        const held = (await kv.get<Partial<Settings>>(settingsKey(id))) ?? {};
        await kv.set(settingsKey(id), { ...held, ...patch });
      }
      const agent = await agentFor(await settingsOf(id));
      const handle = run({ agent, session: id, workspace, input: text });
      attach(id, { handle, agent });
      notify(id);
      return { sessionId: id, runId: handle.runId } satisfies Started;
    },

    wait: async (sessionId) => attached.get(sessionId)?.handle.outcome,

    approve: (sessionId, args) => submitTo(sessionId, (requestId) => ({ type: 'approve', requestId, ...(args?.always ? { alwaysApprove: true } : {}) })),
    deny: (sessionId, args) => submitTo(sessionId, (requestId) => ({ type: 'deny', requestId, ...(args?.reason !== undefined ? { reason: args.reason } : {}) })),
    answer: (sessionId, answers) => submitTo(sessionId, (requestId) => ({ type: 'answer', requestId, answers })),

    /**
     * Stop what the session is doing. A running turn is aborted; a waiting approval or question is
     * denied, which is the only way the harness ends one (a `cancel` command on a paused run merely
     * detaches, decision 86): the tool's result says the person declined, and the model goes on.
     */
    async cancel(sessionId) {
      await requireSession(sessionId);
      const held = attached.get(sessionId);
      if (held !== undefined && held.handle.status() === 'running') { held.handle.cancel({ reason: 'cancelled by the user' }); return; }
      const run = await newest(sessionId);
      if (run?.status !== 'awaiting') return;
      await chat.deny(sessionId, { reason: 'cancelled by the user' });
    },

    async remove(sessionId) {
      await requireSession(sessionId);
      const held = attached.get(sessionId);
      if (held !== undefined) {
        held.handle.cancel({ reason: 'session removed' });
        await held.handle.outcome;
      }
      await store.sessions.delete({ sessionId });
      await kv.delete(settingsKey(sessionId));
      notify(sessionId);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    async close() {
      const settling = [...attached.values()].map((entry) => { entry.handle.cancel({ reason: 'papo closed' }); return entry.handle.outcome; });
      await Promise.allSettled(settling);
    },
  };
  return chat;
}

function activityOf(run: RunRecord | undefined): SessionActivity {
  switch (run?.status) {
    case 'running': return 'running';
    case 'awaiting': return 'awaiting';
    case 'failed': return 'failed';
    default: return 'idle';
  }
}
