import type { RunEvent } from '../types/event.js';
import type { RunOutcome } from '../types/outcome.js';
import type { RunHandle } from '../types/run.js';
import type { FakeStep } from '../types/testing.js';
import type { Store } from '../types/store.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { liveRuns } from './answer.js';
import { resume } from './resume.js';
import { run } from './run.js';

/*
 * Three ways a handle outlives the run it answers, as the review of agent/05 found them: one left behind by another
 * process that answered the request, one whose pause could not be announced, and one a host let go of on purpose.
 */

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };

function rmTool(execute?: ToolDefinition['execute']): Tool {
  return createTool({ name: 'rm', description: 'remove', input: textInput, effects: { destructive: true }, execute: execute ?? ((i) => `removed:${(i as { text: string }).text}`) });
}

function build(opts: { tools?: Tool<any, any>[]; store?: Store } = {}) {
  const store = opts.store ?? createMemoryStore();
  const script: FakeStep[] = [{ toolCalls: [{ name: 'rm', input: { text: 'x' } }] }, { text: 'done' }];
  const agent = createAgent({ id: 'a', instructions: 'be brief', model: createFakeModel({ script }), store, tools: opts.tools ?? [rmTool()] });
  return { agent, store };
}

/** A tool call the test opens by hand, so a run can be caught in the middle of it. */
function gateTool(): { tool: Tool; execute: ReturnType<typeof vi.fn>; release: (output?: string) => void; entered: () => Promise<void> } {
  let release: ((output: string) => void) | undefined;
  let enter: (() => void) | undefined;
  const execute = vi.fn(() => new Promise<string>((resolve) => { release = resolve; if (enter) { enter(); enter = undefined; } }));
  return {
    tool: createTool({ name: 'rm', description: 'remove', input: textInput, effects: { destructive: true }, execute }),
    execute,
    release: (output = 'removed') => release?.(output),
    /** Resolves once the call is executing (at once when it already is). */
    entered: () => (release !== undefined ? Promise.resolve() : new Promise<void>((resolve) => { enter = resolve; })),
  };
}

/** A store that goes down as the pause is announced: every event write from `run.paused` on is refused. */
function diesAtThePause(store: Store): Store {
  let down = false;
  return {
    ...store,
    runs: {
      ...store.runs,
      async appendEvent(event) {
        if (event.type === 'run.paused') down = true;
        if (down) throw new Error(`the store is down: it refused the ${event.type} event`);
        return store.runs.appendEvent(event);
      },
    },
  };
}

/** A store where this process's write loses the race to another's: the request is answered elsewhere as the resolve
 * goes in, and the resolve is refused for it, as a store that finds the request no longer pending would. */
function answeredAsWeWrite(store: Store): Store {
  return {
    ...store,
    requests: {
      ...store.requests,
      async resolve(args) {
        await store.requests.resolve({ ...args, resolution: { type: 'deny', requestId: args.requestId, reason: 'answered elsewhere' } });
        throw new Error(`request ${args.requestId} is no longer pending`);
      },
    },
  };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}

function lastOutcome(events: RunEvent[]): RunOutcome {
  const last = events.at(-1);
  if (!last || last.type !== 'run.finished') throw new Error('the run did not finish');
  return last.outcome;
}

const ref = (handle: { sessionId: string; runId: string }) => ({ sessionId: handle.sessionId, runId: handle.runId });

/** Runs a turn to its pause and returns the id of the request it left open (decision 122). */
async function pausedAt(handle: RunHandle): Promise<string> {
  const events: RunEvent[] = [];
  for await (const e of handle.events) { events.push(e); if (e.type === 'run.finished') break; }
  const outcome = lastOutcome(events);
  if (outcome.status !== 'awaiting') throw new Error(`expected awaiting, got ${outcome.status}`);
  return outcome.requestId;
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; }
  catch (e) { return (e as { code?: string }).code; }
}

describe('a handle another process has moved past (review fix 1)', () => {
  it('writes nothing when the request was answered elsewhere, and ends with the outcome the store holds', async () => {
    const gate = gateTool();
    const { agent, store } = build({ tools: [gate.tool] });
    const first = run({ agent, session: 's', input: 'x' });
    const requestId = await pausedAt(first);
    // The process that paused the run is gone; this one takes it up and is in the middle of the call.
    liveRuns.delete(first.runId);
    const other = resume({ agent, ...ref(first) });
    await other.submit({ type: 'approve', requestId });
    await gate.entered();

    // The handle that paused the run never got its answer: its cancel answers nothing, updates nothing, finishes
    // nothing and releases nothing. What the store holds when it lets go is the pause the other process has taken
    // up and not yet finished, and that is the outcome its own stream ends with.
    const stale = collect(first);
    first.cancel({ reason: 'the process that paused it is leaving' });
    expect(lastOutcome(await stale)).toMatchObject({ status: 'awaiting', requestId });
    expect((await store.requests.get({ ...ref(first), requestId }))?.resolution).toEqual({ type: 'approve', requestId });
    expect((await store.runs.get(ref(first)))?.status).toBe('running');

    // The run the other process holds keeps its claim and its outcome: the stale handle took neither.
    gate.release('removed');
    expect((await other.outcome).status).toBe('completed');
    expect(gate.execute).toHaveBeenCalledTimes(1);
    expect(await store.runs.get(ref(first))).toMatchObject({ status: 'completed', steps: 2 });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
  });

  it('writes nothing when another process answers the request as the resolve goes in', async () => {
    const store = createMemoryStore();
    const { agent } = build({ store: answeredAsWeWrite(store) });
    const handle = run({ agent, session: 's', input: 'x' });
    const requestId = await pausedAt(handle);

    // The request is answered elsewhere in the moment between the check above the write and the write itself, so the
    // write is refused. The answer is that process's, and so is the run: this handle detaches as it does when the
    // request was answered before it looked, rather than finishing a run it does not hold.
    expect(await codeOf(handle.submit({ type: 'approve', requestId }))).toBe('not_found');
    expect(await handle.outcome).toMatchObject({ status: 'awaiting', requestId });
    expect((await store.requests.get({ ...ref(handle), requestId }))?.resolution).toMatchObject({ type: 'deny' });
    expect(await store.runs.get(ref(handle))).toMatchObject({ status: 'awaiting', pendingRequestId: requestId });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBe(handle.runId);
    const types = (await store.runs.listEvents(ref(handle))).map((e) => e.type);
    expect(types).not.toContain('run.resumed');
    expect(types).not.toContain('approval.resolved');
  });
});

describe('a pause that cannot be announced (review fix 3)', () => {
  it('drops the wait, so a late command is refused and the run is not finished twice', async () => {
    const store = createMemoryStore();
    const { agent } = build({ store: diesAtThePause(store) });
    const handle = run({ agent, session: 's', input: 'x' });
    const stream = collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'failed', error: { code: 'internal' } });
    expect(lastOutcome(await stream)).toMatchObject({ status: 'failed' });

    // The request the pause wrote stays open in the store, and this handle may not answer it any more: the run is
    // over, so the acceptor is gone with it and a command reaches no loop.
    const requestId = (await store.runs.get(ref(handle)))?.pendingRequestId as string;
    expect(requestId).toBeTruthy();
    expect(await codeOf(handle.submit({ type: 'approve', requestId }))).toBe('not_running');
    expect((await store.runs.get(ref(handle)))?.status).toBe('failed');
    expect((await store.requests.get({ ...ref(handle), requestId }))?.resolvedAt).toBeUndefined();
  });
});

describe('a host that lets a paused run go (review fix 4)', () => {
  it('detach leaves the request open in the store, and this process can take the run up again', async () => {
    const execute = vi.fn(() => 'removed');
    const { agent, store } = build({ tools: [rmTool(execute)] });
    const handle = run({ agent, session: 's', input: 'x' });
    const requestId = await pausedAt(handle);
    // Held here, the run refuses a second attach in this process; that is what a host detaches it for.
    expect(await (resume({ agent, ...ref(handle) }).outcome)).toMatchObject({ status: 'failed', error: { code: 'writer_busy' } });

    handle.detach();
    expect(await handle.outcome).toMatchObject({ status: 'awaiting', requestId });
    expect(handle.status()).toBe('awaiting');
    expect(await store.runs.get(ref(handle))).toMatchObject({ status: 'awaiting', pendingRequestId: requestId });
    expect((await store.requests.get({ ...ref(handle), requestId }))?.resolvedAt).toBeUndefined();

    const again = resume({ agent, ...ref(handle) });
    await again.submit({ type: 'approve', requestId });
    expect((await again.outcome).status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await store.runs.get(ref(handle))).toMatchObject({ status: 'completed', steps: 2 });
  });
});
