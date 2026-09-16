import type { AgentOptions } from '../types/agent.js';
import type { RunEvent } from '../types/event.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool } from '../types/tool.js';
import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };
const echo = createTool({ name: 'echo', description: 'echo', input: textInput, execute: (i) => `echo:${(i as { text: string }).text}` });
const notifyDone = createTool({ name: 'notify_done', description: 'the agent says it is finished', input: textInput, execute: (i) => `noted: ${(i as { text: string }).text}` });
const failing = createTool({ name: 'failing', description: 'throws', input: textInput, execute: () => { throw new Error('boom'); } });

const twoCalls: FakeStep = { toolCalls: [{ name: 'echo', input: { text: 'a' }, callId: 'c1' }, { name: 'echo', input: { text: 'b' }, callId: 'c2' }] };

function build(opts: { script: FakeStep[]; tools?: Tool<any, any>[]; hooks?: AgentOptions['hooks'] }) {
  const store = createMemoryStore();
  const model = createFakeModel({ script: opts.script });
  const agent = createAgent({ id: 'a', instructions: 'x', model, store, tools: opts.tools ?? [echo, notifyDone, failing], ...(opts.hooks ? { hooks: opts.hooks } : {}) });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);
const ref = (handle: { sessionId: string; runId: string }) => ({ sessionId: handle.sessionId, runId: handle.runId });

describe('a hook ends the run (decision 97)', () => {
  it('1. beforeTool stop on the first of two calls answers both "Not executed", executes nothing and finishes stopped { reason: hook }', async () => {
    const beforeTool = vi.fn(async () => ({ decision: 'stop' as const, reason: 'enough for today' }));
    const { agent, store } = build({ script: [twoCalls, { text: 'never' }], hooks: { beforeTool } });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'hook', steps: 1 });
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.denied', 'run.finished']);
    expect(events[4]).toMatchObject({ type: 'tool.denied', callId: 'c1', reason: 'enough for today' });
    expect(beforeTool).toHaveBeenCalledTimes(1);

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(transcript[2]!.parts).toEqual([{ type: 'toolResult', callId: 'c1', name: 'echo', content: 'Not executed: enough for today', isError: true }]);
    expect(transcript[3]!.parts).toEqual([{ type: 'toolResult', callId: 'c2', name: 'echo', content: 'Not executed: the run was stopped', isError: true }]);
    // Nothing executed: no tool step, the tool-call counter stays at zero (decision 56).
    expect((await store.runs.listSteps(ref(handle))).map((s) => s.kind)).toEqual(['model']);
    expect(await store.runs.get(ref(handle))).toMatchObject({ status: 'stopped' });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
  });

  it('2. afterTool stop on notify_done records its own result, marks the step, and finishes stopped { reason: hook }', async () => {
    const afterTool: NonNullable<AgentOptions['hooks']>['afterTool'] = async ({ tool, output }) =>
      tool.name === 'notify_done' ? { output, stop: { reason: 'the agent is done' } } : { output };
    const script: FakeStep[] = [{ toolCalls: [{ name: 'notify_done', input: { text: 'all set' }, callId: 'n1' }, { name: 'echo', input: { text: 'b' }, callId: 'c2' }] }, { text: 'never' }];
    const { agent, store } = build({ script, hooks: { afterTool } });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'hook', steps: 1 });
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'tool.completed', 'run.finished']);
    expect(events[5]).toMatchObject({ type: 'tool.completed', callId: 'n1', content: 'noted: all set', isError: false });

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript[2]!.parts).toEqual([{ type: 'toolResult', callId: 'n1', name: 'notify_done', content: 'noted: all set', isError: false }]);
    expect(transcript[3]!.parts).toEqual([{ type: 'toolResult', callId: 'c2', name: 'echo', content: 'Not executed: the run was stopped', isError: true }]);
    const steps = await store.runs.listSteps(ref(handle));
    expect(steps.map((s) => [s.kind, s.status])).toEqual([['model', 'completed'], ['tool', 'completed']]);
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'notify_done', detail: { stoppedBy: 'afterTool', reason: 'the agent is done' } });
  });

  it('3. the next run on the session assembles a model-valid history: every toolCall has a toolResult', async () => {
    const beforeTool = vi.fn(async () => ({ decision: 'stop' as const, reason: 'stop' }));
    const { agent, model } = build({ script: [twoCalls, { text: 'second turn' }], hooks: { beforeTool } });
    expect((await run({ agent, session: 's', input: 'x' }).outcome).status).toBe('stopped');

    const again = run({ agent, session: 's', input: 'y' });
    expect((await again.outcome).status).toBe('completed');
    const history = model.requests[1]!.messages;
    const calls = history.flatMap((m) => m.parts.filter((p) => p.type === 'toolCall').map((p) => p.callId));
    const results = history.flatMap((m) => m.parts.filter((p) => p.type === 'toolResult').map((p) => p.callId));
    expect(calls).toEqual(['c1', 'c2']);
    expect(results).toEqual(['c1', 'c2']);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user']);
  });

  it('4. an afterTool stop on a failed call still stops', async () => {
    const afterTool: NonNullable<AgentOptions['hooks']>['afterTool'] = async ({ output }) => ({ output, isError: true, stop: { reason: 'give up' } });
    const { agent, store } = build({ script: [{ toolCalls: [{ name: 'failing', input: { text: 'a' }, callId: 'f1' }] }, { text: 'never' }], hooks: { afterTool } });
    const handle = run({ agent, session: 's', input: 'x' });
    const outcome = await handle.outcome;
    expect(outcome).toMatchObject({ status: 'stopped', reason: 'hook' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript[2]!.parts).toEqual([{ type: 'toolResult', callId: 'f1', name: 'failing', content: 'boom', isError: true }]);
    const steps = await store.runs.listSteps(ref(handle));
    expect(steps[1]).toMatchObject({ kind: 'tool', status: 'failed', detail: { stoppedBy: 'afterTool', reason: 'give up' } });
  });
});
