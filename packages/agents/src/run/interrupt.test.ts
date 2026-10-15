import type { AbortReason } from '../types/abort.js';
import type { RunEvent } from '../types/event.js';
import type { Message } from '../types/message.js';
import type { ModelAdapter } from '../types/model.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { ModelError } from '../errors.js';
import { textOf } from '../message/helpers.js';
import { INTERRUPTED, INTERRUPTED_TOOL, interruptedText } from '../message/markers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { compact } from './compact.js';
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
    expect(transcript[2]!.parts[0]).toEqual({ type: 'toolResult', callId: 'c1', name: 'slow', content: '[Request interrupted for tool use: user]', isError: true });
    expect(transcript[3]!.parts[0]).toEqual({ type: 'toolResult', callId: 'c2', name: 'echo', content: '[Request interrupted for tool use: user]', isError: true });
    expect(textOf(transcript[4]!)).toBe('[Request interrupted: user]');
    const steps = await store.runs.listSteps({ sessionId: 's', runId: handle.runId });
    expect(steps.map((s) => [s.kind, s.status])).toEqual([['model', 'completed'], ['tool', 'uncertain']]);
    expect(model.remaining()).toBe(1);

    // The next run assembles a valid history: every call answered, and the model sees the marker.
    const next = createFakeModel({ script: [{ text: 'ok' }] });
    const again = run({ agent: createAgent({ id: 'a', instructions: 'be brief', model: next, store, tools: [tool('slow', never), tool('echo', () => 'echo')] }), session: 's', input: 'and now' });
    await collect(again);
    expect(await again.outcome).toMatchObject({ status: 'completed' });
    expect(next.requests[0]!.messages.map((m) => `${m.role}:${textOf(m)}`)).toEqual([
      'user:go', 'assistant:', 'tool:', 'tool:', 'user:[Request interrupted: user]', 'user:and now',
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

  it('a timeout says so and finishes stopped { reason: timeout }', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')], limits: { timeoutMs: 30 } });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'stopped', reason: 'timeout', steps: 1 });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(shape(transcript)).toEqual(['user:input', 'assistant:model', 'tool:tool', 'tool:tool', 'user:system']);
    expect(transcript.slice(2, 4).map((m) => (m.parts[0] as { content: string }).content)).toEqual(['[Request interrupted for tool use: timeout]', '[Request interrupted for tool use: timeout]']);
    expect(textOf(transcript[4]!)).toBe('[Request interrupted: timeout]');
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
    expect(textOf(transcript[1]!)).toBe('[Request interrupted: user]');
  });
});

describe('the caller chooses what a cut turn says (agent/09)', () => {
  it('a cancel with no reason writes INTERRUPTED and INTERRUPTED_TOOL', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')] });
    const handle = run({ agent, session: 's', input: 'go' });
    for await (const e of handle.events) if (e.type === 'tool.started') { handle.cancel(); break; }
    expect(await handle.outcome).toMatchObject({ status: 'cancelled' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.slice(2, 4).map((m) => (m.parts[0] as { content: string }).content)).toEqual([INTERRUPTED_TOOL, INTERRUPTED_TOOL]);
    expect(textOf(transcript[4]!)).toBe(INTERRUPTED);
  });

  it('a cancel with a reason names it, in the turn text and the tool text', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')] });
    const handle = run({ agent, session: 's', input: 'go' });
    for await (const e of handle.events) if (e.type === 'tool.started') { await handle.submit({ type: 'cancel', reason: 'restart' }); break; }
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'restart' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect((transcript[2]!.parts[0] as { content: string }).content).toBe('[Request interrupted for tool use: restart]');
    expect(textOf(transcript[4]!)).toBe('[Request interrupted: restart]');
  });

  it('a cancel from the caller\'s AbortSignal reads as a plain cancel', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')] });
    const controller = new AbortController();
    const handle = run({ agent, session: 's', input: 'go', signal: controller.signal });
    for await (const e of handle.events) if (e.type === 'tool.started') { controller.abort(); break; }
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'signal' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect((transcript[2]!.parts[0] as { content: string }).content).toBe(INTERRUPTED_TOOL);
    expect(textOf(transcript[4]!)).toBe(INTERRUPTED);
  });

  it('interruptedText gives the defaults for every abort', () => {
    expect(interruptedText({ kind: 'cancel' })).toEqual({ turn: INTERRUPTED, tool: INTERRUPTED_TOOL });
    expect(interruptedText({ kind: 'cancel', reason: 'signal' })).toEqual({ turn: INTERRUPTED, tool: INTERRUPTED_TOOL });
    expect(interruptedText({ kind: 'cancel', reason: 'restart' })).toEqual({ turn: '[Request interrupted: restart]', tool: '[Request interrupted for tool use: restart]' });
    expect(interruptedText({ kind: 'timeout' })).toEqual({ turn: '[Request interrupted: timeout]', tool: '[Request interrupted for tool use: timeout]' });
  });

  it('interrupted on run replaces both texts and gets the abort reason', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [twoCalls, { text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [tool('slow', never), tool('echo', () => 'echo')] });
    const seen: AbortReason[] = [];
    const interrupted = (abort: AbortReason) => { seen.push(abort); return { turn: 'stopped by the daemon', tool: 'call stopped by the daemon' }; };
    const handle = run({ agent, session: 's', input: 'go', interrupted });
    for await (const e of handle.events) if (e.type === 'tool.started') { handle.cancel({ reason: 'restart' }); break; }
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'restart' });
    expect(seen).toEqual([{ kind: 'cancel', reason: 'restart' }]);
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.slice(2, 4).map((m) => (m.parts[0] as { content: string }).content)).toEqual(['call stopped by the daemon', 'call stopped by the daemon']);
    expect(textOf(transcript[4]!)).toBe('stopped by the daemon');
  });

  it('interrupted on compact replaces the marker', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ text: 'never' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store });
    const handle = compact({ agent, session: 's', signal: AbortSignal.abort(), interrupted: () => ({ turn: 'no summary', tool: 'unused' }) });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'cancelled' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(textOf(transcript.at(-1)!)).toBe('no summary');
  });
});
