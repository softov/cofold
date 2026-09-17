import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { FakeStep } from '../types/testing.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { assembleRequest, contextOf } from './context.js';
import { compact } from './compact.js';
import { run } from './run.js';

const estimate = (text: string) => Math.ceil(text.length / 4);

/** `compactKeepTokens` defaults to 0 here so the cases about coverage see every message summarized; the tail has its own cases. */
function build(args: { script: FakeStep[]; store?: ReturnType<typeof createMemoryStore>; autoCompactTokens?: number; compactKeepTokens?: number }) {
  const store = args.store ?? createMemoryStore();
  const model = createFakeModel({ script: args.script });
  const agent = createAgent({
    id: 'a', instructions: 'be brief', model, store,
    context: { maxTokens: 10_000, compactKeepTokens: args.compactKeepTokens ?? 0, ...(args.autoCompactTokens !== undefined ? { autoCompactTokens: args.autoCompactTokens } : {}) },
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
    expect(events[3]).toMatchObject({ type: 'context.compacted', messageId: outcome.message.id, summarized: 3, kept: 0, estimatedTokens: expect.any(Number), afterTokens: expect.any(Number) });
    const compacted = events[3] as Extract<RunEvent, { type: 'context.compacted' }>;
    expect(compacted.afterTokens).toBeLessThan(compacted.estimatedTokens + 40);

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
    expect(events[3]).toMatchObject({ type: 'context.compacted', summarized: 2, kept: 0 });
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

describe('compactKeepTokens (cli/03 F1, F7)', () => {
  it('defaults to 20% of maxTokens and refuses a negative value', () => {
    const model = createFakeModel({ script: [] });
    expect(createAgent({ id: 'a', instructions: 'x', model, context: { maxTokens: 10_000 } }).context.compactKeepTokens).toBe(2_000);
    expect(createAgent({ id: 'a', instructions: 'x', model }).context.compactKeepTokens).toBe(6_400);
    expect(() => createAgent({ id: 'a', instructions: 'x', model, context: { compactKeepTokens: -1 } })).toThrow('context.compactKeepTokens must not be negative');
  });

  it('keeps the newest unit verbatim, leaves it out of summarizes, and the next request carries summary, tail, input in that order', async () => {
    const store = createMemoryStore();
    const first = build({ store, script: [{ text: 'Hello.' }] });
    await collect(run({ agent: first.agent, session: 's', input: 'Hi' }));
    const second = build({ store, script: [{ text: 'Sure, again.' }] });
    await collect(run({ agent: second.agent, session: 's', input: 'Again' }));
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    // About 4 tokens of framing plus the text per message: the last exchange (6 + 7 tokens) fits in 14, the first does not.
    const compacting = build({ store, script: [{ text: 'They greeted twice.' }], compactKeepTokens: 14 });
    const handle = compact({ agent: compacting.agent, session: 's' });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    if (outcome.status !== 'completed') throw new Error(outcome.status);

    // Summarized: the first exchange and the ask; kept: the second exchange.
    expect(outcome.message.summarizes).toEqual([transcript[0]!.id, transcript[1]!.id, expect.any(String)]);
    expect(events[3]).toMatchObject({ type: 'context.compacted', summarized: 3, kept: 2 });
    const compacted = events[3] as Extract<RunEvent, { type: 'context.compacted' }>;
    expect(compacted.afterTokens).toBeLessThan(compacted.estimatedTokens);
    expect(await store.runs.listSteps({ sessionId: 's', runId: handle.runId })).toMatchObject([{ detail: { compacted: 3, kept: 2 } }]);
    // The summarizing request saw what it summarizes plus the ask, never the tail.
    expect(compacting.model.requests[0]!.messages.map((m) => textOf(m))).toEqual(['Hi', 'Hello.', 'Summarize the conversation so far.']);

    const after = await store.sessions.listMessages({ sessionId: 's' });
    expect(contextOf(after).map((m) => [m.source, textOf(m)])).toEqual([
      ['summary', 'Summary of the conversation so far:\n\nThey greeted twice.'],
      ['input', 'Again'],
      ['model', 'Sure, again.'],
    ]);
    const next = build({ store, script: [{ text: 'Still here.' }] });
    await collect(run({ agent: next.agent, session: 's', input: 'And now?' }));
    expect(next.model.requests[0]!.messages.map((m) => [m.source, textOf(m)])).toEqual([
      ['summary', 'Summary of the conversation so far:\n\nThey greeted twice.'],
      ['input', 'Again'],
      ['model', 'Sure, again.'],
      ['input', 'And now?'],
    ]);
  });

  it('never splits a unit: a tool call stays with its results even when only the result would fit', async () => {
    const tool = createTool({ name: 'echo', description: 'echo', input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, execute: (i) => `echo:${(i as { text: string }).text}` });
    async function session(compactKeepTokens: number) {
      const store = createMemoryStore();
      const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'a'.repeat(200) } }] }, { text: 'done' }] });
      const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool] });
      await collect(run({ agent, session: 's', input: 'go' }));
      const transcript = await store.sessions.listMessages({ sessionId: 's' });
      expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
      const compacting = build({ store, script: [{ text: 'S' }], compactKeepTokens });
      const handle = compact({ agent: compacting.agent, session: 's' });
      const events = await collect(handle);
      return { transcript, compacting, compacted: events[3] as Extract<RunEvent, { type: 'context.compacted' }> };
    }
    // 'done' (about 5 tokens) is kept; the call + result unit (about 120) is not, with a budget of 60.
    const small = await session(60);
    expect(small.compacted).toMatchObject({ kept: 1, summarized: 4 });
    expect(small.compacting.model.requests[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    // A budget that would fit 'done' plus the result alone still does not take the result without its call.
    const partial = await session(70);
    expect(partial.compacted).toMatchObject({ kept: 1, summarized: 4 });
    expect(partial.compacting.model.requests[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    // Enough for 'done' plus the whole unit (5 + 114) but not the input too: the call and the result are kept together.
    const whole = await session(120);
    expect(whole.compacted).toMatchObject({ kept: 3, summarized: 2 });
    expect(whole.compacting.model.requests[0]!.messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('compactKeepTokens: 0 covers everything, as before the tail existed', async () => {
    const store = createMemoryStore();
    await collect(run({ agent: build({ store, script: [{ text: 'Hello.' }] }).agent, session: 's', input: 'Hi' }));
    const handle = compact({ agent: build({ store, script: [{ text: 'Greeted.' }], compactKeepTokens: 0 }).agent, session: 's' });
    const events = await collect(handle);
    expect(events[3]).toMatchObject({ type: 'context.compacted', summarized: 3, kept: 0 });
    const after = await store.sessions.listMessages({ sessionId: 's' });
    expect(contextOf(after).map((m) => m.source)).toEqual(['summary']);
  });

  it('an auto-compaction keeps the tail too and answers with summary, tail, input in view', async () => {
    const store = createMemoryStore();
    const long = 'x'.repeat(400);
    const first = build({ store, script: [{ text: long }], autoCompactTokens: 150 });
    await collect(run({ agent: first.agent, session: 's', input: long }));
    // The reply (about 104 tokens) fits the tail; the first input does not once the reply is kept.
    const second = build({ store, script: [{ text: 'Folded.' }, { text: 'Then answered.' }], autoCompactTokens: 150, compactKeepTokens: 110 });
    const handle = run({ agent: second.agent, session: 's', input: 'short' });
    const events = await collect(handle);
    expect(events[3]).toMatchObject({ type: 'context.compacted', summarized: 1, kept: 1 });
    expect(second.model.requests[0]!.messages.map((m) => [m.source, textOf(m).slice(0, 5)])).toEqual([['input', 'xxxxx'], ['system', 'Summa']]);
    expect(second.model.requests[1]!.messages.map((m) => [m.source, textOf(m).slice(0, 5)])).toEqual([['summary', 'Summa'], ['model', 'xxxxx'], ['input', 'short']]);
  });
});
