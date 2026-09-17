import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, ApprovalPayload, Message, ModelInfo, PendingRequest, RunHandle, RunRecord, StopReason } from '@facio/agents';
import { AgentError, compact, contextOf, listSkills, newId, resume, run } from '@facio/agents';
import { fileSkillSource } from '@facio/store-file';
import { AGENT_ID, buildAgent } from './agent.js';
import { providerFor, splitModel } from './config.js';
import { createQueues } from './queue.js';
import { checkRules } from './rules.js';
import { projectTurns, titleOf } from './turns.js';
import type { Chat, ChatListener, ChatOptions, ModelRow, ProviderRow, Started } from './types/chat.js';
import type { Settings } from './types/settings.js';
import { PERMISSION_MODES, REASONING_LEVELS } from './types/settings.js';
import type { Compaction, Draft, SessionActivity, SessionRow, Snapshot } from './types/turn.js';

interface Attached {
  handle: RunHandle;
  agent: Agent;
  /** The step being written, folded from `model.delta` (decision CLI-04.2); absent between steps. */
  draft?: Draft;
}

/** The package folder: `<here>/skills/<name>/SKILL.md` are the prompts papo ships. */
const SHIPPED_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where a session's own choices live in the workspace kv; the same key on both backends, so `session set` reads one thing. */
export function settingsKey(sessionId: string): string {
  return `papo/session/${sessionId}/settings`;
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
  // The person's skills first, then the ones papo ships (`/init`, `/review`), so a home skill of the same name wins.
  const skillSources = [fileSkillSource({ root: home }), fileSkillSource({ root: SHIPPED_ROOT })];
  const warn = options.warn ?? ((message: string) => process.stderr.write(`papo: ${message}\n`));
  const attached = new Map<string, Attached>();
  /**
   * What each compaction did, by its summary message's id (cli/03 F1, F7): read from `context.compacted` as the run
   * emits it here, or once from the compacting run's events when the summary was written by another process.
   */
  const compactions = new Map<string, Compaction>();
  const listeners = new Set<ChatListener>();
  /** The first model the first provider listed, asked once; `config.model` is read live, a pick may change it (CLI-05.1). */
  let listedModel: string | undefined;
  /** Per-session choices, beside the session's other client state. */
  const kv = store.kv({ kind: 'workspace', workspace });

  const notify = (sessionId: string): void => {
    for (const listener of listeners) listener(sessionId);
  };
  /** The next turns, in memory (CLI-04.1); the head is said through the service when a turn settles, or at once while idle. */
  const queues = createQueues({
    start: (sessionId, head) => chat.say({ sessionId, text: head.text, ...(head.settings !== undefined ? { settings: head.settings } : {}) }),
    // Idle as `say` reads it: no decision pending, and no turn running in this process.
    idle: async (sessionId) => {
      const run = await newest(sessionId);
      return run?.status !== 'awaiting' && !(run?.status === 'running' && attached.has(sessionId));
    },
    warn,
    notify,
  });

  /** How long a provider gets to answer a listing before the screen is told it cannot be reached. */
  const LISTING_MS = 15_000;

  /** The configured model, or the first the first provider lists; asked once, and only when a turn needs it. */
  async function modelRef(): Promise<string> {
    if (config.model !== undefined) return config.model;
    if (listedModel !== undefined) return listedModel;
    const first = providers[0];
    const id = config.providers[0]?.id;
    if (first === undefined || id === undefined) {
      throw new AgentError({ code: 'invalid_options', message: 'no provider is configured: set PAPO_BASE_URL or add one to ~/.config/papo/config.json' });
    }
    const listed = await first.listModels({ signal: AbortSignal.timeout(LISTING_MS) });
    const chosen = listed[0];
    if (chosen === undefined) throw new AgentError({ code: 'invalid_options', message: `provider "${id}" lists no models; set model in the configuration` });
    listedModel = `${id}/${chosen.id}`;
    return listedModel;
  }

  async function instructions(): Promise<string> {
    let text = config.instructions;
    try {
      const notes = (await readFile(join(workspace, 'AGENTS.md'), 'utf8')).trim();
      if (notes !== '') text = `${text}\n\n${notes}`;
    } catch { /* no AGENTS.md is the common case */ }
    return text;
  }

  /** A patch, checked word by word; the model must name a configured provider, or be `''`, the word `settingsOf` uses for "unset". */
  function checkSettings(patch: Partial<Settings>): void {
    if (patch.model !== undefined && patch.model !== '') providerFor(providers, config, patch.model);
    if (patch.permissions !== undefined && !PERMISSION_MODES.includes(patch.permissions)) {
      throw new AgentError({ code: 'invalid_options', message: `permissions must be one of ${PERMISSION_MODES.join(', ')}` });
    }
    if (patch.reasoning !== undefined && !REASONING_LEVELS.includes(patch.reasoning)) {
      throw new AgentError({ code: 'invalid_options', message: `reasoning must be one of ${REASONING_LEVELS.join(', ')}` });
    }
    if (patch.rules !== undefined) checkRules(patch.rules);
  }

  /**
   * Reads the store only: an empty `model` means "whatever the first provider lists first", which is
   * asked of the provider when a turn starts, never when a screen opens.
   */
  async function settingsOf(sessionId: string | undefined): Promise<Settings> {
    const own = sessionId === undefined ? undefined : await kv.get<Partial<Settings>>(settingsKey(sessionId));
    return {
      model: own?.model ?? config.model ?? listedModel ?? '',
      permissions: own?.permissions ?? config.permissions,
      ...(own?.rules !== undefined ? { rules: own.rules } : {}),
      reasoning: own?.reasoning ?? config.reasoning,
      autoCompact: own?.autoCompact ?? config.context.autoCompact,
    };
  }

  async function agentFor(settings: Settings): Promise<Agent> {
    const model = settings.model === '' ? await modelRef() : settings.model;
    const { provider, modelId } = providerFor(providers, config, model);
    settings = { ...settings, model };
    return buildAgent({
      config, settings, provider, modelId, store, home, workspace, skills: skillSources, instructions: await instructions(), warn,
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
    });
  }

  /**
   * Watches a handle to its end, waking the listeners on the way; detaches when it settles, and the queue's head starts.
   * Two payloads are read here: `model.delta`, folded into the entry's draft and dropped at `model.completed`, when
   * the store holds the whole message (decision CLI-04.2), and `context.compacted`, kept for the notice (cli/03 F1);
   * everything else only wakes.
   */
  function attach(sessionId: string, entry: Attached): void {
    attached.set(sessionId, entry);
    void (async () => {
      try {
        for await (const event of entry.handle.events) {
          if (event.type === 'model.delta') {
            const draft = entry.draft ??= { runId: event.runId, step: event.step, text: '', reasoning: '' };
            if (draft.step !== event.step) { draft.step = event.step; draft.text = ''; draft.reasoning = ''; }
            draft[event.kind] += event.text;
          } else if (event.type === 'model.completed') {
            delete entry.draft;
          } else if (event.type === 'context.compacted') {
            compactions.set(event.messageId, { runId: event.runId, before: event.estimatedTokens, after: event.afterTokens });
          }
          notify(sessionId);
        }
      } catch (error: unknown) {
        warn(`session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    // `outcome` never rejects: every failure is a `failed` outcome.
    void entry.handle.outcome.then((outcome) => {
      if (attached.get(sessionId) === entry) attached.delete(sessionId);
      notify(sessionId);
      return queues.settled(sessionId, outcome.status);
    });
  }

  /**
   * The run in force: the one holding the session's writer (running or paused on a decision, in this
   * process or another), else the newest. The newest alone would hide a paused turn behind a run that
   * failed after it, and a run refused `writer_busy` by that very pause is exactly such a run.
   */
  async function newest(sessionId: string): Promise<RunRecord | undefined> {
    return inForce(await store.runs.list({ sessionId }), (await store.sessions.get({ sessionId }))?.activeWriterRunId);
  }

  function inForce(runs: RunRecord[], holder: string | undefined): RunRecord | undefined {
    return (holder !== undefined ? runs.find((run) => run.runId === holder) : undefined) ?? runs[0];
  }

  /**
   * What each summary in the transcript did, from the cache or from the events of the run that wrote it (newest
   * run first; the event names the summary). A summary whose event is not there yet is asked about again next time.
   */
  async function compactionsOf(sessionId: string, messages: Message[], runs: RunRecord[]): Promise<Record<string, Compaction>> {
    const found: Record<string, Compaction> = {};
    for (const summary of messages.filter((message) => message.source === 'summary')) {
      let compaction = compactions.get(summary.id);
      for (let i = runs.length - 1; compaction === undefined && i >= 0; i -= 1) {
        const run = runs[i]!;
        for (const event of await store.runs.listEvents({ sessionId, runId: run.runId })) {
          if (event.type !== 'context.compacted' || event.messageId !== summary.id) continue;
          compaction = { runId: run.runId, before: event.estimatedTokens, after: event.afterTokens };
          compactions.set(summary.id, compaction);
          break;
        }
      }
      if (compaction !== undefined) found[summary.id] = compaction;
    }
    return found;
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
    steerHeld(sessionId, handle);
    return { handle, run };
  }

  /**
   * What was said while the turn paused (`Queued.steer`) goes into the resumed turn ahead of its next model
   * step. Refused `not_running` again (the turn paused once more, or ended, before that step) it waits on:
   * for the next resume, or as the next turn when the turn ended, as a steer the turn settled before does.
   */
  function steerHeld(sessionId: string, handle: RunHandle): void {
    for (const waiting of queues.list(sessionId)) {
      if (waiting.steer !== true) continue;
      queues.remove(sessionId, waiting.id);
      void handle.submit({ type: 'steer', text: waiting.text }).then(
        () => notify(sessionId),
        async (error: unknown) => {
          if (error instanceof AgentError && error.code === 'not_running') { await queues.add(sessionId, waiting); return; }
          warn(`session ${sessionId}: the held message did not go in: ${error instanceof Error ? error.message : String(error)}`);
        },
      );
    }
  }

  async function submitTo(sessionId: string, build: (requestId: string, run: RunRecord) => Parameters<RunHandle['submit']>[0] | Promise<Parameters<RunHandle['submit']>[0]>): Promise<void> {
    await requireSession(sessionId);
    const { handle, run } = await handleFor(sessionId);
    if (run.status !== 'awaiting' || run.pendingRequestId === undefined) {
      throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not waiting on a decision` });
    }
    await handle.submit(await build(run.pendingRequestId, run));
  }

  /**
   * "Always, this session" (decision CLI-04.5): the approved tool joins the session's allow list, where `session rules`
   * shows it and every later call of it runs unasked, as Claude's `updatedPermissions` does; the harness's own
   * remembered approval (`alwaysApprove`) is not written by papo.
   */
  async function allowAlways(sessionId: string, run: RunRecord, requestId: string): Promise<void> {
    const pending = await store.requests.get({ sessionId, runId: run.runId, requestId });
    if (pending?.kind !== 'approval') return;
    const { name } = pending.payload as ApprovalPayload;
    const held = (await kv.get<Partial<Settings>>(settingsKey(sessionId))) ?? {};
    const allow = held.rules?.allow ?? [];
    if (allow.some((rule) => rule.tool === name && rule.match === undefined)) return;
    await kv.set(settingsKey(sessionId), { ...held, rules: { ...held.rules, allow: [...allow, { tool: name }] } });
  }

  /** Writes a checked patch over the session's own settings; `model: ''` takes the session's own choice away rather than being one. */
  async function patchSettings(sessionId: string, patch: Partial<Settings>): Promise<void> {
    const held = (await kv.get<Partial<Settings>>(settingsKey(sessionId))) ?? {};
    const { model, ...rest } = patch;
    const next: Partial<Settings> = { ...held, ...rest };
    if (model === '') delete next.model;
    else if (model !== undefined) next.model = model;
    await kv.set(settingsKey(sessionId), next);
  }

  const chat: Chat = {
    settings: settingsOf,

    async configure(sessionId, patch) {
      await requireSession(sessionId);
      checkSettings(patch);
      await patchSettings(sessionId, patch);
      notify(sessionId);
      return settingsOf(sessionId);
    },

    async providers() {
      const chosen = config.model !== undefined ? splitModel(config.model).provider : undefined;
      return config.providers.map((provider, index): ProviderRow => ({
        id: provider.id,
        baseUrl: provider.baseUrl,
        key: provider.apiKey !== undefined,
        default: chosen !== undefined ? provider.id === chosen : index === 0,
      }));
    },

    async models({ provider: only } = {}) {
      if (providers.length === 0) {
        throw new AgentError({ code: 'invalid_options', message: 'no provider is configured: set PAPO_BASE_URL or add one to ~/.config/papo/config.json' });
      }
      const ids = config.providers.map((one) => one.id);
      if (only !== undefined && !ids.includes(only)) {
        throw new AgentError({ code: 'invalid_options', message: `provider "${only}" is not configured; configured: ${ids.join(', ')}` });
      }
      const rows: ModelRow[] = [];
      for (const [index, provider] of providers.entries()) {
        const id = ids[index] ?? provider.id;
        if (only !== undefined && id !== only) continue;
        let listed: ModelInfo[];
        try {
          listed = await provider.listModels({ signal: AbortSignal.timeout(LISTING_MS) });
        } catch (error: unknown) {
          // Asked about this one: the error is the answer. Asked about all: one that is down must not hide the rest.
          if (only !== undefined) throw error;
          warn(`provider "${id}": ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        for (const model of listed) rows.push({ ...model, provider: id, ref: `${id}/${model.id}` });
      }
      return rows;
    },

    skills: async () => [...(await listSkills({ sources: skillSources, workspace })).values()].map(({ entry }) => entry),

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

    async snapshot(sessionId, options) {
      const session = await store.sessions.get({ sessionId });
      if (session === undefined) throw new AgentError({ code: 'not_found', message: `session ${sessionId} is not there` });
      const all = await store.sessions.listMessages({ sessionId });
      // The screen shows what the model sees (cli/03 F1); `--all` shows the whole transcript.
      const messages = options?.all === true ? all : contextOf(all);
      const listed = await store.runs.list({ sessionId });
      const runs = [...listed].reverse();
      const last = inForce(listed, session.activeWriterRunId);
      let pending: PendingRequest | undefined;
      if (last?.status === 'awaiting' && last.pendingRequestId !== undefined) {
        pending = await store.requests.get({ sessionId, runId: last.runId, requestId: last.pendingRequestId });
      }
      // How a run ended, from its last event: why it failed, or which limit stopped it (decision 97).
      const errors: Record<string, string> = {};
      const stopped: Record<string, StopReason> = {};
      for (const ended of runs.filter((run) => run.status === 'failed' || run.status === 'stopped')) {
        const events = await store.runs.listEvents({ sessionId, runId: ended.runId });
        const finished = events[events.length - 1];
        if (finished?.type !== 'run.finished') continue;
        if (finished.outcome.status === 'failed') errors[ended.runId] = finished.outcome.error.message;
        else if (finished.outcome.status === 'stopped') stopped[ended.runId] = finished.outcome.reason;
      }
      const draft = attached.get(sessionId)?.draft;
      const projected = projectTurns({
        messages, runs, pending, errors, stopped,
        compactions: await compactionsOf(sessionId, all, runs),
        ...(draft !== undefined ? { draft } : {}),
      });
      return {
        settings: await settingsOf(sessionId),
        queued: queues.list(sessionId),
        session: {
          id: sessionId,
          title: titleOf(all, sessionId),
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
      if (patch !== undefined) checkSettings(patch);
      let running: Attached | undefined;
      if (sessionId !== undefined) {
        await requireSession(sessionId);
        const run = await newest(sessionId);
        if (run?.status === 'awaiting') {
          throw new AgentError({ code: 'writer_busy', message: `session ${sessionId} is waiting on a decision; approve, deny or answer it first` });
        }
        if (run?.status === 'running') running = attached.get(sessionId);
      }
      // A person spoke: whatever a cancel held back may start again on the next settle (CLI-04.1).
      queues.release(id);
      if (patch !== undefined) await patchSettings(id, patch);
      // A turn still running here takes the text as a steer (decision 95): it lands before the next
      // model step. A turn that settled first refuses it `not_running`, and the text starts a new one.
      if (running !== undefined) {
        try {
          await running.handle.submit({ type: 'steer', text });
          return { sessionId: id, runId: running.handle.runId, steered: true } satisfies Started;
        } catch (error: unknown) {
          if (!(error instanceof AgentError) || error.code !== 'not_running') throw error;
          // Refused because the turn paused on a decision, not because it ended: the turn still holds the
          // session, so a new run could not start; the text waits and goes in when the decision resumes it.
          if ((await newest(id))?.status === 'awaiting') {
            await queues.add(id, { text, steer: true });
            return { sessionId: id, runId: running.handle.runId, held: true } satisfies Started;
          }
        }
      }
      const agent = await agentFor(await settingsOf(id));
      const handle = run({ agent, session: id, workspace, input: text });
      attach(id, { handle, agent });
      notify(id);
      return { sessionId: id, runId: handle.runId } satisfies Started;
    },

    async compact(sessionId) {
      await requireSession(sessionId);
      const last = await newest(sessionId);
      if (last?.status === 'awaiting' || (last?.status === 'running' && attached.has(sessionId))) {
        throw new AgentError({ code: 'writer_busy', message: `session ${sessionId} is busy; wait, answer or cancel it first` });
      }
      const agent = await agentFor(await settingsOf(sessionId));
      const handle = compact({ agent, session: sessionId });
      attach(sessionId, { handle, agent });
      notify(sessionId);
      return { sessionId, runId: handle.runId } satisfies Started;
    },

    wait: async (sessionId) => {
      // Taken now, before any await: a `remove` or `cancel` issued right after must still settle this waiter.
      const current = attached.get(sessionId)?.handle.outcome;
      if (current !== undefined) return current;
      // Nothing attached yet: a queued head may be starting (its `say` awaits the settings first).
      await queues.starting(sessionId);
      return attached.get(sessionId)?.handle.outcome;
    },

    async queue({ sessionId, text, settings: patch, id }) {
      await requireSession(sessionId);
      if (patch !== undefined) checkSettings(patch);
      return queues.add(sessionId, { text, ...(patch !== undefined ? { settings: patch } : {}), ...(id !== undefined ? { id } : {}) });
    },

    async unqueue(sessionId, id) {
      await requireSession(sessionId);
      queues.remove(sessionId, id);
    },

    queued: async (sessionId) => queues.list(sessionId),

    approve: (sessionId, args) => submitTo(sessionId, async (requestId, run) => {
      if (args?.always === true) await allowAlways(sessionId, run, requestId);
      return { type: 'approve', requestId };
    }),
    deny: (sessionId, args) => submitTo(sessionId, (requestId) => ({ type: 'deny', requestId, ...(args?.reason !== undefined ? { reason: args.reason } : {}) })),
    answer: (sessionId, answers) => submitTo(sessionId, (requestId) => ({ type: 'answer', requestId, answers })),

    /**
     * Stop what the session is doing. A running turn is aborted; one waiting on an approval or a
     * question is cancelled on its handle (resumed here when another process left it), and the harness
     * denies the request itself and ends the turn cancelled with the interrupt marker (decision 120).
     * Nothing queued starts after a cancel, until the person says something (CLI-04.1).
     */
    async cancel(sessionId) {
      await requireSession(sessionId);
      queues.hold(sessionId);
      const held = attached.get(sessionId);
      if (held !== undefined && held.handle.status() === 'running') { held.handle.cancel({ reason: 'cancelled by the user' }); return; }
      const run = await newest(sessionId);
      if (run?.status !== 'awaiting') return;
      const { handle } = await handleFor(sessionId);
      handle.cancel({ reason: 'cancelled by the user' });
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
      queues.clear(sessionId);
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
