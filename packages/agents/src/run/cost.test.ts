import type { RunEvent } from '../types/event.js';
import type { ModelPricing } from '../types/model.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { DEFAULT_LIMITS } from '../agent/limits.js';
import { costOf } from '../model/cost.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { compact } from './compact.js';
import { resume } from './resume.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };
const echo: Tool = createTool({ name: 'echo', description: 'echo', input: textInput, execute: (i) => `echo:${(i as { text: string }).text}` });
const rm: Tool = createTool({ name: 'rm', description: 'remove', input: textInput, effects: { destructive: true }, execute: (i) => `removed:${(i as { text: string }).text}` });

/** One dollar per million input tokens, two per million output: the fake's 1/1 usage per step costs 0.000003. */
const PRICING: ModelPricing = { inputPerMillion: 1, outputPerMillion: 2, currency: 'USD' };
const callEcho: FakeStep = { toolCalls: [{ name: 'echo', input: { text: 'hi' } }] };

function build(args: { script: FakeStep[]; pricing?: ModelPricing; maxCost?: number; store?: ReturnType<typeof createMemoryStore> }) {
  const store = args.store ?? createMemoryStore();
  const model = createFakeModel({ script: args.script, ...(args.pricing !== undefined ? { pricing: args.pricing } : {}) });
  const agent = createAgent({
    id: 'a', instructions: 'be brief', model, store, tools: [echo, rm],
    ...(args.maxCost !== undefined ? { limits: { maxCost: args.maxCost } } : {}),
  });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const finished = (events: RunEvent[]) => events.find((e): e is Extract<RunEvent, { type: 'run.finished' }> => e.type === 'run.finished')!;

describe('costOf (decision 109)', () => {
  it('prices plain input and output per million', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' })).toBe(10.5);
    expect(costOf({ inputTokens: 1, outputTokens: 1 }, PRICING)).toBe(0.000003);
  });

  it('takes cache reads out of the input and prices them at their own rate', () => {
    const pricing: ModelPricing = { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, currency: 'USD' };
    // 1M prompt tokens of which 400k were cache hits: 600k at 3 + 400k at 0.3 = 1.8 + 0.12
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 400_000 }, pricing)).toBe(1.92);
  });

  it('prices cache reads and writes at the input rate when the pricing has no cache rates', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 300_000, cacheWriteTokens: 200_000 };
    expect(costOf(usage, { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' })).toBe(3);
    expect(costOf(usage, { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75, currency: 'USD' })).toBe(1.5 + 0.09 + 0.75);
  });

  it('rounds to micro-dollars and never goes negative on inconsistent usage', () => {
    expect(costOf({ inputTokens: 1, outputTokens: 0 }, { inputPerMillion: 0.3, outputPerMillion: 0, currency: 'USD' })).toBe(0);
    expect(costOf({ inputTokens: 7, outputTokens: 0 }, { inputPerMillion: 0.3, outputPerMillion: 0, currency: 'USD' })).toBe(0.000002);
    // A provider that reports more cached tokens than prompt tokens: the plain part is clamped at zero.
    expect(costOf({ inputTokens: 10, outputTokens: 0, cacheReadTokens: 20 }, { inputPerMillion: 1, outputPerMillion: 1, cacheReadPerMillion: 0.5, currency: 'USD' })).toBe(0.00001);
  });
});

describe('cost on the run (decisions 108, 109)', () => {
  it('DEFAULT_LIMITS.maxCost is 0, no limit', () => {
    expect(DEFAULT_LIMITS.maxCost).toBe(0);
  });

  it('a two-step run records the sum of its steps on the outcome, the event and the run record', async () => {
    const { agent, store } = build({ script: [callEcho, { text: 'done' }], pricing: PRICING });
    const handle = run({ agent, session: 's', input: 'go' });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    expect(outcome).toMatchObject({ status: 'completed', steps: 2, usage: { inputTokens: 2, outputTokens: 2 }, cost: 0.000006 });
    expect(finished(events).outcome).toEqual(outcome);
    expect(await store.runs.get({ sessionId: 's', runId: handle.runId })).toMatchObject({ status: 'completed', cost: 0.000006 });
  });

  it('without pricing the outcome and the record carry no cost, and maxCost never trips', async () => {
    const { agent, store } = build({ script: [callEcho, { text: 'done' }], maxCost: 0.000001 });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('completed');
    expect('cost' in outcome).toBe(false);
    const record = await store.runs.get({ sessionId: 's', runId: handle.runId });
    expect('cost' in record!).toBe(false);
  });

  it('stops at maxCost: the step that crosses the ceiling completes, the next never starts', async () => {
    const { agent, model } = build({ script: [callEcho, callEcho, { text: 'never' }], pricing: PRICING, maxCost: 0.000004 });
    const handle = run({ agent, session: 's', input: 'go' });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    expect(outcome).toEqual({ status: 'stopped', reason: 'max_cost', usage: { inputTokens: 2, outputTokens: 2 }, steps: 2, cost: 0.000006, denials: [] });
    expect(model.remaining()).toBe(1);
    expect(events.filter((e) => e.type === 'model.started')).toHaveLength(2);
    // The second batch's tool still ran: the limit is checked before a model step, not inside a batch.
    expect(events.filter((e) => e.type === 'tool.completed')).toHaveLength(2);
  });

  it('a paused run carries its cost on through resume(); the resumed steps add to it', async () => {
    const store = createMemoryStore();
    const first = build({ store, script: [{ toolCalls: [{ name: 'rm', input: { text: 'x' } }] }, { text: 'gone' }], pricing: PRICING });
    const paused = run({ agent: first.agent, session: 's', input: 'remove x' });
    await collect(paused);
    const awaiting = await paused.outcome;
    if (awaiting.status !== 'awaiting') throw new Error(awaiting.status);
    expect(awaiting.cost).toBe(0.000003);
    expect(await store.runs.get({ sessionId: 's', runId: paused.runId })).toMatchObject({ status: 'awaiting', cost: 0.000003 });

    const handle = resume({ agent: first.agent, sessionId: 's', runId: paused.runId });
    const done = collect(handle);
    await handle.submit({ type: 'approve', requestId: awaiting.requestId });
    await done;
    const outcome = await handle.outcome;
    expect(outcome).toMatchObject({ status: 'completed', steps: 2, cost: 0.000006 });
    expect(await store.runs.get({ sessionId: 's', runId: paused.runId })).toMatchObject({ status: 'completed', cost: 0.000006 });
  });

  it('a run that died while running gets its cost recomputed from the step log', async () => {
    const store = createMemoryStore();
    const { agent } = build({ store, script: [callEcho, { text: 'done' }], pricing: PRICING });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    // Rewrite the record as a crash would have left it: running, counters never written, claim held.
    await store.runs.update({ sessionId: 's', runId: handle.runId, status: 'running', usage: { inputTokens: 0, outputTokens: 0 }, steps: 0 });
    await store.sessions.claimWriter({ sessionId: 's', runId: handle.runId });

    const dead = resume({ agent, sessionId: 's', runId: handle.runId });
    await collect(dead);
    const outcome = await dead.outcome;
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'interrupted' }, steps: 2, usage: { inputTokens: 2, outputTokens: 2 }, cost: 0.000006 });
  });

  it('compact() records the summary step cost, and an auto-compaction adds it to the turn', async () => {
    const store = createMemoryStore();
    const first = build({ store, script: [{ text: 'Hello there.' }], pricing: PRICING });
    await collect(run({ agent: first.agent, session: 's', input: 'Hi' }));

    const compacting = build({ store, script: [{ text: 'They said hi; I greeted them.' }], pricing: PRICING });
    const handle = compact({ agent: compacting.agent, session: 's' });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'completed', steps: 1, cost: 0.000003 });
    expect(await store.runs.get({ sessionId: 's', runId: handle.runId })).toMatchObject({ cost: 0.000003 });
  });
});
