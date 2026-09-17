import type { RunEvent } from '../types/event.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { compact } from './compact.js';
import { resume } from './resume.js';
import { run } from './run.js';

const echoInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };
const echo: Tool = createTool({ name: 'echo', description: 'echo', input: echoInput, execute: (i) => `echo:${(i as { text: string }).text}` });

function build(args: { script: FakeStep[]; stream?: boolean; store?: ReturnType<typeof createMemoryStore> }) {
  const store = args.store ?? createMemoryStore();
  const model = createFakeModel({ script: args.script, stream: args.stream ?? true });
  const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [echo] });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);
const deltas = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: 'model.delta' }> => e.type === 'model.delta');

describe('streaming (decisions 102, 104, 105)', () => {
  it('1. a streamed text answer is one persisted model.delta per chunk, in order, joining to the final text', async () => {
    const { agent, store } = build({ script: [{ text: 'one two three', chunks: ['one ', 'two ', 'three'] }] });
    const handle = run({ agent, session: 's', input: 'count' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(types(events)).toEqual(['run.started', 'model.started', 'model.delta', 'model.delta', 'model.delta', 'model.completed', 'run.finished']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(deltas(events)).toMatchObject([
      { step: 1, kind: 'text', text: 'one ' },
      { step: 1, kind: 'text', text: 'two ' },
      { step: 1, kind: 'text', text: 'three' },
    ]);
    if (outcome.status !== 'completed') throw new Error(outcome.status);
    expect(deltas(events).map((e) => e.text).join('')).toBe(textOf(outcome.message));

    const stored = await store.runs.listEvents({ sessionId: 's', runId: handle.runId });
    expect(types(stored)).toEqual(types(events));
    expect(deltas(stored)).toEqual(deltas(events));
    // The step record carries the request and the whole reply; deltas live in the event log only.
    const steps = await store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'model', status: 'completed', reply: { message: outcome.message } });
  });

  it('2. a tool step streams no delta, the tool runs, and the next step streams its text', async () => {
    const { agent, store } = build({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'hi' } }] }, { text: 'echoed hi' }] });
    const handle = run({ agent, session: 's', input: 'echo hi' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(types(events)).toEqual([
      'run.started', 'model.started', 'model.completed',
      'tool.proposed', 'tool.started', 'tool.completed',
      'model.started', 'model.delta', 'model.delta', 'model.completed', 'run.finished',
    ]);
    expect(deltas(events)).toMatchObject([{ step: 2, kind: 'text', text: 'echoed ' }, { step: 2, kind: 'text', text: 'hi' }]);
    expect(outcome).toMatchObject({ status: 'completed', steps: 2 });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(transcript[2]!.parts).toMatchObject([{ type: 'toolResult', name: 'echo', content: 'echo:hi', isError: false }]);
  });

  it('3. reasoning streams first as kind reasoning, then the text as kind text', async () => {
    const { agent } = build({ script: [{ text: 'yes', reasoning: 'thinking hard' }] });
    const handle = run({ agent, session: 's', input: '?' });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    expect(deltas(events)).toMatchObject([{ kind: 'reasoning', text: 'thinking hard' }, { kind: 'text', text: 'yes' }]);
    if (outcome.status !== 'completed') throw new Error(outcome.status);
    expect(outcome.message.parts).toEqual([{ type: 'reasoning', text: 'thinking hard' }, { type: 'text', text: 'yes' }]);
  });

  it('4. an interrupted stream fails the step and the run; nothing was executed and the next run has a valid history', async () => {
    const store = createMemoryStore();
    const first = build({ store, script: [{ text: 'let me call', chunks: ['let me ', 'call'], interrupt: true }] });
    const handle = run({ agent: first.agent, session: 's', input: 'go' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(types(events)).toEqual(['run.started', 'model.started', 'model.delta', 'model.delta', 'run.finished']);
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'invalid_response', message: 'the stream ended before the reply was complete' }, steps: 1 });
    const steps = await store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps.map((s) => [s.kind, s.status])).toEqual([['model', 'failed']]);
    // The failed step wrote no assistant message: the transcript is the input alone.
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.role)).toEqual(['user']);

    const second = build({ store, script: [{ text: 'again' }] });
    const retry = run({ agent: second.agent, session: 's', input: 'go again' });
    await collect(retry);
    expect(await retry.outcome).toMatchObject({ status: 'completed' });
    expect(second.model.requests[0]!.messages.map((m) => [m.role, textOf(m)])).toEqual([['user', 'go'], ['user', 'go again']]);
  });

  it('5. a fake without stream uses complete() and publishes no delta', async () => {
    const { agent, model } = build({ stream: false, script: [{ text: 'plain answer' }] });
    expect(model.stream).toBeUndefined();
    expect(model.features.streaming).toBe(false);
    const handle = run({ agent, session: 's', input: 'hi' });
    const events = await collect(handle);
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'run.finished']);
    expect(await handle.outcome).toMatchObject({ status: 'completed' });
  });

  it('5b. features.streaming false turns a streaming adapter off (decision 104)', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ text: 'quiet' }], stream: true, features: { streaming: false } });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store });
    const handle = run({ agent, session: 's', input: 'hi' });
    const events = await collect(handle);
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'run.finished']);
  });

  it('6. the summary step of compact() never streams (decision 104)', async () => {
    const store = createMemoryStore();
    const first = build({ store, script: [{ text: 'Hello there.' }] });
    await collect(run({ agent: first.agent, session: 's', input: 'Hi' }));

    const compacting = build({ store, script: [{ text: 'They said hi; I greeted them.' }] });
    const handle = compact({ agent: compacting.agent, session: 's' });
    const events = await collect(handle);
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'context.compacted', 'run.finished']);
    expect(await handle.outcome).toMatchObject({ status: 'completed', steps: 1 });
  });

  it('7. resume() on a finished streamed run replays the deltas in order (decision 102)', async () => {
    const { agent, store } = build({ script: [{ text: 'a b c', chunks: ['a ', 'b ', 'c'] }] });
    const first = run({ agent, session: 's', input: 'abc' });
    const live = await collect(first);
    await first.outcome;

    const again = resume({ agent, sessionId: 's', runId: first.runId });
    const replayed = await collect(again);
    expect(replayed).toEqual(live);
    expect(deltas(replayed).map((e) => e.text)).toEqual(['a ', 'b ', 'c']);
    expect(await again.outcome).toEqual(await first.outcome);
    expect(store).toBeDefined();
  });
});
