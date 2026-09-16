import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { FakeStep } from '../types/testing.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { assembleRequest, contextOf } from './context.js';
import { compact } from './compact.js';
import { run } from './run.js';

const estimate = (text: string) => Math.ceil(text.length / 4);

function build(args: { script: FakeStep[]; store?: ReturnType<typeof createMemoryStore>; autoCompactTokens?: number }) {
  const store = args.store ?? createMemoryStore();
  const model = createFakeModel({ script: args.script });
  const agent = createAgent({
    id: 'a', instructions: 'be brief', model, store,
    context: { maxTokens: 10_000, ...(args.autoCompactTokens !== undefined ? { autoCompactTokens: args.autoCompactTokens } : {}) },
  });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);
const message = (text: string, source: Message['source'] = 'model', role: Message['role'] = 'assistant'): Message =>
  ({ id: text, role, source, parts: [{ type: 'text', text }], createdAt: 'now' });

describe('contextOf and the assembler', () => {
  it('puts the newest summary first and keeps only what no summary stands for', () => {
    const s1 = { ...message('s1', 'summary', 'user'), summarizes: ['a'] };
    const s2 = { ...message('s2', 'summary', 'user'), summarizes: ['s1', 'b'] };
    const history = [message('a'), s1, message('kept', 'input', 'user'), message('b'), s2, message('c')];
    expect(contextOf(history).map((m) => m.id)).toEqual(['s2', 'kept', 'c']);
    expect(contextOf([message('a')]).map((m) => m.id)).toEqual(['a']);
    const request = assembleRequest({ instructions: 'x', history, tools: [], params: {}, cacheKey: 's', maxTokens: 10_000, estimateTokens: estimate, signal: new AbortController().signal });
    expect(request.messages.map((m) => m.id)).toEqual(['s2', 'kept', 'c']);
  });
});

describe('compact()', () => {
  it('is a run of one summary step whose message stands for everything before it, and the next turn starts from it', async () => {
    const store = createMemoryStore();
    const first = build({ store, script: [{ text: 'Hello.' }] });
    await collect(run({ agent: first.agent, session: 's', input: 'Hi' }));

    const compacting = build({ store, script: [{ text: 'The person said hi; I greeted them.' }] });
    const handle = compact({ agent: compacting.agent, session: 's' });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'context.compacted', 'run.finished']);
    expect(outcome).toMatchObject({ status: 'completed', steps: 1 });
    if (outcome.status !== 'completed') throw new Error(outcome.status);
    expect(outcome.message).toMatchObject({ role: 'user', source: 'summary', summarizes: expect.any(Array) });
    expect(textOf(outcome.message)).toBe('Summary of the conversation so far:\n\nThe person said hi; I greeted them.');
    expect(events[3]).toMatchObject({ type: 'context.compacted', messageId: outcome.message.id, summarized: 3 });

    // The summarizing request carried the conversation and no tools; the ask is the run's own input, source system.
    const asked = compacting.model.requests[0]!;
    expect(asked.tools).toEqual([]);
    expect(asked.instructions).toContain('## summary');
    expect(asked.messages.map((m) => [m.source, textOf(m)])).toEqual([['input', 'Hi'], ['model', 'Hello.'], ['system', 'Summarize the conversation so far.']]);

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.source)).toEqual(['input', 'model', 'system', 'summary']);
    expect(outcome.message.summarizes).toEqual(transcript.slice(0, 3).map((m) => m.id));
    const steps = await store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'model', status: 'completed', detail: { compacted: 3 } });

    const next = build({ store, script: [{ text: 'Still here.' }] });
    await collect(run({ agent: next.agent, session: 's', input: 'Again?' }));
    expect(next.model.requests[0]!.messages.map((m) => [m.source, textOf(m)])).toEqual([
      ['summary', 'Summary of the conversation so far:\n\nThe person said hi; I greeted them.'],
      ['input', 'Again?'],
    ]);
  });

  it('fails the run when the model returns nothing, and reports a model error as its own', async () => {
    const store = createMemoryStore();
    await collect(run({ agent: build({ store, script: [{ text: 'Hello.' }] }).agent, session: 's', input: 'Hi' }));
    const empty = await compact({ agent: build({ store, script: [{ text: '' }] }).agent, session: 's' }).outcome;
    expect(empty).toMatchObject({ status: 'failed', error: { code: 'invalid_response', message: 'summary: the model returned no summary' } });
    const down = await compact({ agent: build({ store, script: [{ error: { code: 'network', message: 'gone' } }] }).agent, session: 's' }).outcome;
    expect(down).toMatchObject({ status: 'failed', error: { code: 'network', message: 'summary: gone' } });
    expect((await store.sessions.listMessages({ sessionId: 's' })).filter((m) => m.source === 'summary')).toHaveLength(0);
  });
});

describe('autoCompactTokens', () => {
  it('compacts in passing before the model step once the history is estimated past the threshold, then goes on', async () => {
    const store = createMemoryStore();
    const long = 'x'.repeat(400);
    const first = build({ store, script: [{ text: long }], autoCompactTokens: 150 });
    await collect(run({ agent: first.agent, session: 's', input: long }));
    expect(first.model.requests).toHaveLength(1);

    // history: input (100) + reply (100) + this input (100) > 150 → summary first, then the turn.
    const second = build({ store, script: [{ text: 'Folded.' }, { text: 'Then answered.' }], autoCompactTokens: 150 });
    const handle = run({ agent: second.agent, session: 's', input: long });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'context.compacted', 'model.started', 'model.completed', 'run.finished']);
    expect(outcome).toMatchObject({ status: 'completed', steps: 2 });
    expect(outcome.status === 'completed' && textOf(outcome.message)).toBe('Then answered.');
    // The summarizing request asked in passing; the turn's own request then started at the summary.
    expect(second.model.requests[0]!.messages.at(-1)).toMatchObject({ source: 'system' });
    expect(second.model.requests[0]!.tools).toEqual([]);
    expect(second.model.requests[1]!.messages.map((m) => m.source)).toEqual(['summary', 'input']);
    expect(events[3]).toMatchObject({ type: 'context.compacted', summarized: 2 });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.source)).toEqual(['input', 'model', 'input', 'summary', 'model']);
    expect((await store.runs.get({ sessionId: 's', runId: handle.runId }))?.steps).toBe(2);

    // Under the threshold now: nothing folded on the next turn.
    const third = build({ store, script: [{ text: 'ok' }], autoCompactTokens: 150 });
    const again = await collect(run({ agent: third.agent, session: 's', input: 'short' }));
    expect(types(again)).not.toContain('context.compacted');
  });

  it('refuses a non-positive threshold', () => {
    expect(() => build({ script: [], autoCompactTokens: 0 })).toThrow('context.autoCompactTokens must be positive');
  });
});
