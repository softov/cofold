import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { ModelAdapter } from '../types/model.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { ModelError } from '../errors.js';
import { textOf } from '../message/helpers.js';
import { INTERRUPTED, INTERRUPTED_TOOL } from '../message/markers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };
const tool = (name: string, execute: ToolDefinition['execute']): Tool => createTool({ name, description: name, input: textInput, execute });
const twoCalls: FakeStep = { toolCalls: [{ name: 'slow', input: { text: 'a' }, callId: 'c1' }, { name: 'echo', input: { text: 'b' }, callId: 'c2' }] };

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const shape = (transcript: Message[]) => transcript.map((m) => `${m.role}:${m.source}`);
const never = () => new Promise<string>(() => {});

describe('a cancel leaves the transcript model-valid and marked (cli/03 F4)', () => {
  it('cancel during the first of two calls: both calls answered, the marker written, the step uncertain, outcome cancelled', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')] });
    const handle = run({ agent, session: 's', input: 'go' });
    const eventsP = collect(handle);
    for await (const e of handle.events) if (e.type === 'tool.started') { handle.cancel({ reason: 'user' }); break; }
    const outcome = await handle.outcome;
    const events = await eventsP;
    expect(outcome).toMatchObject({ status: 'cancelled', reason: 'user', steps: 1 });
    expect(events.map((e) => e.type)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'run.finished']);

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(shape(transcript)).toEqual(['user:input', 'assistant:model', 'tool:tool', 'tool:tool', 'user:system']);
    expect(transcript[2]!.parts[0]).toEqual({ type: 'toolResult', callId: 'c1', name: 'slow', content: INTERRUPTED_TOOL, isError: true });
    expect(transcript[3]!.parts[0]).toEqual({ type: 'toolResult', callId: 'c2', name: 'echo', content: INTERRUPTED_TOOL, isError: true });
    expect(textOf(transcript[4]!)).toBe(INTERRUPTED);
    const steps = await store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps.map((s) => [s.kind, s.status])).toEqual([['model', 'completed'], ['tool', 'uncertain']]);
    expect(model.remaining()).toBe(1);

    // The next run assembles a valid history: every call answered, and the model sees the marker.
    const next = createFakeModel({ script: [{ text: 'ok' }] });
    const again = run({ agent: createAgent({ id: 'a', instructions: 'be brief', model: next, store, tools: [tool('slow', never), tool('echo', () => 'echo')] }), session: 's', input: 'and now' });
    await collect(again);
    expect(await again.outcome).toMatchObject({ status: 'completed' });
    expect(next.requests[0]!.messages.map((m) => `${m.role}:${textOf(m)}`)).toEqual([
      'user:go', 'assistant:', 'tool:', 'tool:', `user:${INTERRUPTED}`, 'user:and now',
    ]);
  });

  it('cancel between steps: the marker alone', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'x' } }] }, { text: 'never' }] });
    let handle!: ReturnType<typeof run>;
    // afterTool runs once the tool has answered; the cancel is seen at the loop top, before the next model step.
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('echo', () => 'echoed')], hooks: { afterTool: ({ output }) => { handle.cancel(); return { output }; } } });
    handle = run({ agent, session: 's', input: 'go' });
    const events = await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', steps: 1 });
    expect(events.map((e) => e.type)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'tool.completed', 'run.finished']);
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(shape(transcript)).toEqual(['user:input', 'assistant:model', 'tool:tool', 'user:system']);
    expect(transcript[2]!.parts[0]).toMatchObject({ content: 'echoed', isError: false });
    expect(textOf(transcript[3]!)).toBe(INTERRUPTED);
    expect(model.remaining()).toBe(1);
  });

  it('a timeout writes the same texts and finishes stopped { reason: timeout }', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')], limits: { timeoutMs: 30 } });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'stopped', reason: 'timeout', steps: 1 });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(shape(transcript)).toEqual(['user:input', 'assistant:model', 'tool:tool', 'tool:tool', 'user:system']);
    expect(transcript.slice(2, 4).map((m) => (m.parts[0] as { content: string }).content)).toEqual([INTERRUPTED_TOOL, INTERRUPTED_TOOL]);
    expect(textOf(transcript[4]!)).toBe(INTERRUPTED);
  });

  it('an abort already set when the turn starts: run.started, then the marker alone', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store });
    const handle = run({ agent, session: 's', input: 'go', signal: AbortSignal.abort() });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'signal' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    // The abort was already set at the loop top, so the model was never called; the transcript still says what happened.
    expect(shape(transcript)).toEqual(['user:input', 'user:system']);
    expect(textOf(transcript[1]!)).toBe(INTERRUPTED);
    expect(model.requests).toHaveLength(0);
  });

  it('cancel while the model is answering: the step fails, no assistant message, the marker alone', async () => {
    const store = createMemoryStore();
    let handle!: ReturnType<typeof run>;
    // An adapter that is cancelled mid-call: it throws aborted once the signal fires, as a real one does when fetch is aborted.
    const model: ModelAdapter = {
      id: 'slow', modelId: 'slow', features: { tools: false, streaming: false, images: false, structuredOutput: false, reasoning: false },
      complete: (request) => new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => reject(new ModelError({ code: 'aborted', message: 'request aborted' })), { once: true });
        handle.cancel({ reason: 'user' });
      }),
    };
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store });
    handle = run({ agent, session: 's', input: 'go' });
    const events = await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'user', steps: 1 });
    expect(events.map((e) => e.type)).toEqual(['run.started', 'model.started', 'run.finished']);
    const steps = await store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps.map((s) => [s.kind, s.status])).toEqual([['model', 'failed']]);
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(shape(transcript)).toEqual(['user:input', 'user:system']);
    expect(textOf(transcript[1]!)).toBe(INTERRUPTED);
  });
});
