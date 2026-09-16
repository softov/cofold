import type { RunAbort } from '../types/abort.js';
import type { Agent } from '../types/agent.js';
import type { ContentPart, Message } from '../types/message.js';
import type { RunOutcome } from '../types/outcome.js';
import type { CompactArgs, RunArgs, RunHandle } from '../types/run.js';
import type { SessionRecord } from '../types/store.js';
import type { InternalRunHandle, TurnContext } from '../types/turn.js';
import { AgentError } from '../errors.js';
import { newId } from '../ids.js';
import { ZERO_USAGE } from '../model/usage.js';
import { createRunAbort } from './abort.js';
import { COMPACT_INPUT } from './compact.js';
import { createEmitter } from './events.js';
import { createRunHandle } from './handle.js';
import {
  createTurnContext,
  fail,
  finishRun,
  resolveCapabilities,
  runTurn,
  settle,
  summarize,
} from './turn.js';

/** Writer lease refresh period while a run is `running` (decision 68). */
export const HEARTBEAT_MS = 10_000;

/** One turn. Returns synchronously; the loop runs in the background and settles `handle.outcome`. */
export function run<Resources = Record<string, unknown>>(args: RunArgs<Resources>): RunHandle {
  return start(args, false);
}

/**
 * A run whose only step folds the session so far into a summary message (AGENT-01-p5 Task 6): its
 * input is the ask, `source: 'system'`; its outcome's message is the summary. Later requests start
 * at that summary; nothing is deleted.
 */
export function compact<Resources = Record<string, unknown>>(args: CompactArgs<Resources>): RunHandle {
  return start({ agent: args.agent, session: args.session, input: [{ type: 'text', text: COMPACT_INPUT }], ...(args.signal ? { signal: args.signal } : {}) }, true);
}

function start<Resources>(args: RunArgs<Resources>, compacting: boolean): RunHandle {
  const runId = newId();
  const abort = createRunAbort({ ...(args.signal ? { external: args.signal } : {}), timeoutMs: args.agent.limits.timeoutMs });
  const handle = createRunHandle({ runId, sessionId: args.session, abort });
  void (async () => {
    const ctx = await setupRun(args, runId, abort, handle, compacting);
    if (!ctx) return;
    ctx.heartbeat = startHeartbeat(ctx.store, ctx.sessionId, runId);
    await runTurn(ctx, { kind: 'model' });
  })();
  return handle;
}

/** A failed beat is not the loop's problem: the store refuses it once the claim is gone, and the next beat retries. */
export function startHeartbeat(store: Agent['store'], sessionId: string, runId: string): ReturnType<typeof setInterval> {
  return setInterval(() => { void store.sessions.heartbeat({ sessionId, runId }).catch(() => {}); }, HEARTBEAT_MS);
}

/**
 * Steps 1-5 of a turn: session and run record (decision 53), writer claim (decision 47), capabilities,
 * input message, `run.started`. Returns undefined after finishing the handle on any failure.
 */
async function setupRun<Resources>(args: RunArgs<Resources>, runId: string, abort: RunAbort, handle: InternalRunHandle, compacting: boolean): Promise<TurnContext | undefined> {
  const { agent } = args;
  const { store } = agent;
  const sessionId = args.session;
  const agentId = agent.definition.id;
  const now = () => new Date().toISOString();
  let ctx: TurnContext | undefined;
  try {
    let session = await store.sessions.get({ sessionId });
    if (!session) {
      try {
        session = await store.sessions.create({ sessionId, agentId, ...(args.workspace !== undefined ? { workspace: args.workspace } : {}) });
      } catch (e) {
        if ((e as AgentError).code !== 'already_exists') throw e;
        session = (await store.sessions.get({ sessionId })) as SessionRecord;
      }
    }
    const parts: ContentPart[] = typeof args.input === 'string' ? [{ type: 'text', text: args.input }] : args.input;
    const input: Message = { id: newId(), role: 'user', source: compacting ? 'system' : 'input', parts, createdAt: now() };
    await store.runs.create({ runId, sessionId, agentId, status: 'running', createdAt: now(), updatedAt: now(), usage: ZERO_USAGE, steps: 0, inputMessageId: input.id });
    const emitter = createEmitter({ store, runId, sessionId, agentId, publish: handle.publish, onEvent: agent.hooks.onEvent?.bind(agent.hooks), warn: agent.warn });
    ctx = createTurnContext({ agent, store, session, runId, abort, emit: emitter.emit, handle, counters: { usage: ZERO_USAGE, steps: 0, stepIndex: 0, toolCalls: 0 }, claimed: false, compact: compacting, inputMessageId: input.id });

    ctx.claimed = await store.sessions.claimWriter({ sessionId, runId });
    if (!ctx.claimed) { await finishRun(ctx, fail(ctx, 'writer_busy', `session ${sessionId} is being written by another run`)); return undefined; }
    if (!(await resolveCapabilities(ctx))) return undefined;

    await store.sessions.appendMessages({ sessionId, runId, messages: [input] });
    await ctx.emit({ type: 'run.started', input });
    return ctx;
  } catch (e) {
    const outcome: RunOutcome = { status: 'failed', error: { code: e instanceof AgentError ? e.code : 'internal', message: (e as Error).message, detail: summarize(e) }, usage: ZERO_USAGE, steps: 0 };
    if (ctx) {
      try { await finishRun(ctx, outcome); return undefined; }
      catch { /* fall through to the last resort */ }
    }
    if (ctx) settle(ctx, outcome);
    else { abort.dispose(); handle.finish(outcome); }
    return undefined;
  }
}
