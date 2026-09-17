import type { RunEvent } from '../types/event.js';
import type { Denial } from '../types/store.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createAskUserTool } from '../tool/ask-user.js';
import { createTool } from '../tool/create-tool.js';
import { resume } from './resume.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };
const echo: Tool = createTool({ name: 'echo', description: 'echo', input: textInput, execute: (i) => `echo:${(i as { text: string }).text}` });
const rm: Tool = createTool({ name: 'rm', description: 'remove', input: textInput, effects: { destructive: true }, execute: (i) => `removed:${(i as { text: string }).text}` });
const forbidden: Tool = createTool({ name: 'forbidden', description: 'never', input: textInput, execute: () => 'ran' });

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}

describe('denials on the run record and the outcome (cli/03 F3)', () => {
  it('lists every refusal in order with who refused: the validator, a hook, the policy and a limit', async () => {
    const store = createMemoryStore();
    const script: FakeStep[] = [
      { toolCalls: [
        { name: 'nope', input: { text: 'a' }, callId: 'c-unknown' },
        { name: 'echo', input: { text: 3 }, callId: 'c-schema' },
        { name: 'echo', input: { text: 'hook' }, callId: 'c-hook' },
        { name: 'forbidden', input: { text: 'x' }, callId: 'c-policy' },
        { name: 'echo', input: { text: 'ok' }, callId: 'c-ok' },
        { name: 'echo', input: { text: 'over' }, callId: 'c-limit' },
      ] },
      { text: 'done' },
    ];
    const model = createFakeModel({ script });
    const agent = createAgent({
      id: 'a', instructions: 'be brief', model, store, tools: [echo, forbidden],
      hooks: { beforeTool: ({ call }) => ((call.input as { text?: string }).text === 'hook' ? { decision: 'deny', reason: 'hook says no' } : { decision: 'allow' }) },
      policy: { decide: ({ tool }) => (tool.name === 'forbidden' ? { behavior: 'deny', reason: 'rule: forbidden' } : { behavior: 'allow' }) },
      limits: { maxToolCalls: 1 },
    });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    const outcome = await handle.outcome;
    expect(outcome).toMatchObject({ status: 'stopped', reason: 'max_tool_calls' });

    const expected: Denial[] = [
      { callId: 'c-unknown', name: 'nope', input: { text: 'a' }, reason: 'Unknown tool "nope"', by: 'invalid' },
      { callId: 'c-schema', name: 'echo', input: { text: 3 }, reason: 'Invalid arguments: $.text expected string, got number', by: 'invalid' },
      { callId: 'c-hook', name: 'echo', input: { text: 'hook' }, reason: 'hook says no', by: 'hook' },
      { callId: 'c-policy', name: 'forbidden', input: { text: 'x' }, reason: 'rule: forbidden', by: 'policy' },
      { callId: 'c-limit', name: 'echo', input: { text: 'over' }, reason: 'Tool call limit reached', by: 'limit' },
    ];
    expect(outcome.denials).toEqual(expected);
    expect((await store.runs.get({ sessionId: 's', runId: handle.runId }))?.denials).toEqual(expected);
  });

  it('a call the model sent with arguments that are not JSON is refused by the validator', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ rawToolCall: { name: 'echo', raw: '{not json', callId: 'c-raw' } }, { text: 'done' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [echo] });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    expect((await handle.outcome).denials).toEqual([{ callId: 'c-raw', name: 'echo', input: undefined, reason: 'Invalid arguments: not valid JSON', by: 'invalid' }]);
  });

  it('a hook stop is recorded as a hook refusal', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'x' }, callId: 'c1' }] }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [echo], hooks: { beforeTool: () => ({ decision: 'stop', reason: 'all done' }) } });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    const outcome = await handle.outcome;
    expect(outcome).toMatchObject({ status: 'stopped', reason: 'hook', denials: [{ callId: 'c1', name: 'echo', input: { text: 'x' }, reason: 'all done', by: 'hook' }] });
  });

  it('the person denying a paused approval is recorded by: user, and the outcome, the record and a later resume() agree', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ toolCalls: [{ name: 'rm', input: { text: 'x' }, callId: 'c-rm' }] }, { text: 'not removed then' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [rm] });
    const paused = run({ agent, session: 's', input: 'remove x' });
    await collect(paused);
    const awaiting = await paused.outcome;
    if (awaiting.status !== 'awaiting') throw new Error(awaiting.status);
    expect(awaiting.denials).toEqual([]);

    const handle = resume({ agent, sessionId: 's', runId: paused.runId });
    const done = collect(handle);
    await handle.submit({ type: 'deny', requestId: awaiting.requestId, reason: 'not today' });
    await done;
    const outcome = await handle.outcome;
    const expected: Denial[] = [{ callId: 'c-rm', name: 'rm', input: { text: 'x' }, reason: 'not today', by: 'user' }];
    expect(outcome).toMatchObject({ status: 'completed', denials: expected });
    expect((await store.runs.get({ sessionId: 's', runId: paused.runId }))?.denials).toEqual(expected);

    const again = resume({ agent, sessionId: 's', runId: paused.runId });
    expect((await again.outcome).denials).toEqual(expected);
  });

  it('a declined input request is recorded by: user with the decline reason', async () => {
    const store = createMemoryStore();
    const ask = createAskUserTool();
    const questions = [{ id: 'q', question: 'Which?' }];
    const model = createFakeModel({ script: [{ toolCalls: [{ name: 'ask_user', input: { questions }, callId: 'c-ask' }] }, { text: 'fine' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [ask] });
    const paused = run({ agent, session: 's', input: 'ask me' });
    await collect(paused);
    const awaiting = await paused.outcome;
    if (awaiting.status !== 'awaiting') throw new Error(awaiting.status);

    const handle = resume({ agent, sessionId: 's', runId: paused.runId });
    const done = collect(handle);
    await handle.submit({ type: 'deny', requestId: awaiting.requestId });
    await done;
    expect((await handle.outcome).denials).toEqual([{ callId: 'c-ask', name: 'ask_user', input: { questions }, reason: 'The user declined to answer', by: 'user' }]);
  });

  it('a run with no refusal records [] on the outcome and the record, and resume() of a paused run carries the list on', async () => {
    const store = createMemoryStore();
    const model = createFakeModel({ script: [{ toolCalls: [{ name: 'echo', input: { text: 'a' } }] }, { text: 'done' }] });
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [echo] });
    const handle = run({ agent, session: 's', input: 'go' });
    await collect(handle);
    expect((await handle.outcome).denials).toEqual([]);
    expect((await store.runs.get({ sessionId: 's', runId: handle.runId }))?.denials).toEqual([]);

    // A refusal before the pause is on the record at the pause and still on the outcome after the resume.
    const paused = createFakeModel({ script: [{ toolCalls: [{ name: 'nope', input: {}, callId: 'c-x' }, { name: 'rm', input: { text: 'y' }, callId: 'c-rm' }] }, { text: 'ok' }] });
    const pausing = createAgent({ id: 'b', instructions: 'be brief', model: paused, store, tools: [rm] });
    const first = run({ agent: pausing, session: 't', input: 'go' });
    await collect(first);
    const awaiting = await first.outcome;
    if (awaiting.status !== 'awaiting') throw new Error(awaiting.status);
    const denial: Denial = { callId: 'c-x', name: 'nope', input: {}, reason: 'Unknown tool "nope"', by: 'invalid' };
    expect(awaiting.denials).toEqual([denial]);
    expect((await store.runs.get({ sessionId: 't', runId: first.runId }))?.denials).toEqual([denial]);

    const resumed = resume({ agent: pausing, sessionId: 't', runId: first.runId });
    const finished = collect(resumed);
    await resumed.submit({ type: 'approve', requestId: awaiting.requestId });
    await finished;
    expect(await resumed.outcome).toMatchObject({ status: 'completed', denials: [denial] });
  });
});
