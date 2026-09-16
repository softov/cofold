import type { AgentOptions } from '../types/agent.js';
import type { RunEvent } from '../types/event.js';
import type { ModelAdapter } from '../types/model.js';
import type { RunHandle } from '../types/run.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { resume } from './resume.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };

function echoTool(execute?: ToolDefinition['execute'], over: Partial<ToolDefinition> = {}): Tool {
  return createTool({ name: 'echo', description: 'echo', input: textInput, execute: execute ?? ((i) => `echo:${(i as { text: string }).text}`), ...over });
}

const callEcho = (text = 'hi'): FakeStep => ({ toolCalls: [{ name: 'echo', input: { text } }] });

function build(opts: { script?: FakeStep[]; tools?: Tool<any, any>[]; model?: (fake: ModelAdapter) => ModelAdapter } & Omit<Partial<AgentOptions>, 'tools' | 'model'> = {}) {
  const { script, tools, model: wrap, ...rest } = opts;
  const store = rest.store ?? createMemoryStore();
  const fake = createFakeModel({ script: script ?? [callEcho(), { text: 'done' }] });
  const agent = createAgent({ id: 'a', instructions: 'be brief', model: wrap ? wrap(fake) : fake, store, tools: tools ?? [echoTool()], ...rest });
  return { agent, model: fake, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; }
  catch (e) { return (e as { code?: string }).code; }
}

describe('steering (decisions 95-96)', () => {
  it('1. a steer sent while a tool executes lands after its result and before the next model step', async () => {
    let handle!: RunHandle;
    let steered!: Promise<void>;
    const { agent, store, model } = build({ tools: [echoTool(() => { steered = handle.submit({ type: 'steer', text: 'and say bye' }); return 'echo'; })] });
    handle = run({ agent, session: 's', input: 'Say hi' });
    const events = await collect(handle);
    await steered;
    expect((await handle.outcome).status).toBe('completed');

    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'tool.completed', 'run.steered', 'model.started', 'model.completed', 'run.finished']);
    const steer = events.find((e) => e.type === 'run.steered');
    expect(steer && steer.type === 'run.steered' && steer.message).toMatchObject({ role: 'user', source: 'input', parts: [{ type: 'text', text: 'and say bye' }] });

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant']);
    expect(transcript[3]!.source).toBe('input');
    // The second model step sees the steer after the tool result.
    expect(model.requests[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(textOf(model.requests[1]!.messages[3]!)).toBe('and say bye');
    expect((await store.runs.listEvents({ sessionId: 's', runId: handle.runId })).map((e) => e.type)).toContain('run.steered');
  });

  it('2. two steers before the drain become two messages in order and both submits resolve', async () => {
    let handle!: RunHandle;
    const pending: Promise<void>[] = [];
    const { agent, store } = build({ tools: [echoTool(() => { pending.push(handle.submit({ type: 'steer', text: 'first' }), handle.submit({ type: 'steer', text: 'second' })); return 'echo'; })] });
    handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    await Promise.all(pending);
    expect(types(events).filter((t) => t === 'run.steered')).toHaveLength(2);
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.slice(3, 5).map((m) => textOf(m))).toEqual(['first', 'second']);
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'user', 'assistant']);
  });

  it('3. a steer after run.finished throws not_running', async () => {
    const { agent } = build({ script: [{ text: 'done' }] });
    const handle = run({ agent, session: 's', input: 'x' });
    await handle.outcome;
    expect(await codeOf(handle.submit({ type: 'steer', text: 'late' }))).toBe('not_running');
  });

  it('4. a steer queued while the last model step is in flight is rejected not_running and the transcript is unchanged', async () => {
    let handle!: RunHandle;
    let steered!: Promise<void>;
    const { agent, store } = build({
      script: [{ text: 'done' }],
      model: (fake) => ({ ...fake, complete: (request) => { steered = handle.submit({ type: 'steer', text: 'too late' }); return fake.complete(request); } }),
    });
    handle = run({ agent, session: 's', input: 'x' });
    expect((await handle.outcome).status).toBe('completed');
    expect(await codeOf(steered)).toBe('not_running');
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('5. a resumed handle refuses a steer while the request is open (invalid_options) and stays awaiting', async () => {
    const rm = createTool({ name: 'rm', description: 'rm', input: textInput, effects: { destructive: true }, execute: () => 'removed' });
    const { agent, store } = build({ script: [{ toolCalls: [{ name: 'rm', input: { text: 'x' } }] }, { text: 'done' }], tools: [rm] });
    const first = run({ agent, session: 's', input: 'x' });
    const paused = await first.outcome;
    if (paused.status !== 'awaiting') throw new Error(paused.status);

    const second = resume({ agent, sessionId: 's', runId: first.runId });
    expect(await codeOf(second.submit({ type: 'steer', text: 'nope' }))).toBe('invalid_options');
    expect(second.status()).toBe('running');
    expect((await store.runs.get({ sessionId: 's', runId: first.runId }))?.status).toBe('awaiting');
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.role)).toEqual(['user', 'assistant']);
    second.cancel();
    expect((await second.outcome).status).toBe('cancelled');
  });

  it('6. a resumed run takes a steer once the approval is applied', async () => {
    let second!: RunHandle;
    let steered: Promise<void> | undefined;
    const rm = createTool({ name: 'rm', description: 'rm', input: textInput, effects: { destructive: true }, execute: () => { steered = second.submit({ type: 'steer', text: 'now summarize' }); return 'removed'; } });
    const { agent, store, model } = build({ script: [{ toolCalls: [{ name: 'rm', input: { text: 'x' } }] }, { text: 'done' }], tools: [rm] });
    const first = run({ agent, session: 's', input: 'x' });
    const paused = await first.outcome;
    if (paused.status !== 'awaiting') throw new Error(paused.status);

    second = resume({ agent, sessionId: 's', runId: first.runId });
    await second.submit({ type: 'approve', requestId: paused.requestId });
    const events = await collect(second);
    expect((await second.outcome).status).toBe('completed');
    await steered;
    expect(types(events).slice(-5)).toEqual(['tool.completed', 'run.steered', 'model.started', 'model.completed', 'run.finished']);
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant']);
    expect(textOf(model.requests[1]!.messages.at(-1)!)).toBe('now summarize');
  });
});
