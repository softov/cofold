import type { AgentOptions } from '../types/agent.js';
import type { AskQuestion } from '../types/ask.js';
import type { RunEvent } from '../types/event.js';
import type { RunHandle } from '../types/run.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createAskUserTool, renderAnswers } from '../tool/ask-user.js';
import { createTool } from '../tool/create-tool.js';
import { resume } from './resume.js';
import { run } from './run.js';

const textInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };

function rmTool(execute?: ToolDefinition['execute']): Tool {
  return createTool({ name: 'rm', description: 'remove', input: textInput, effects: { destructive: true }, execute: execute ?? ((i) => `removed:${(i as { text: string }).text}`) });
}
function echoTool(execute?: ToolDefinition['execute']): Tool {
  return createTool({ name: 'echo', description: 'echo', input: textInput, execute: execute ?? ((i) => `echo:${(i as { text: string }).text}`) });
}

const callRm = (text = 'x'): FakeStep => ({ toolCalls: [{ name: 'rm', input: { text } }] });

function build(opts: { script?: FakeStep[]; tools?: Tool<any, any>[] } & Omit<Partial<AgentOptions>, 'tools'> = {}) {
  const { script, tools, ...rest } = opts;
  const store = rest.store ?? createMemoryStore();
  const model = createFakeModel({ script: script ?? [callRm(), { text: 'done' }] });
  const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: tools ?? [rmTool()], ...rest });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);
const ref = (handle: { sessionId: string; runId: string }) => ({ sessionId: handle.sessionId, runId: handle.runId });

/** Runs one turn to its pause and returns what a host would persist: session, run and request ids. */
async function pauseRun(agent: ReturnType<typeof build>['agent'], session = 's'): Promise<{ first: RunHandle; requestId: string; seqs: number[] }> {
  const first = run({ agent, session, input: 'x' });
  const events = await collect(first);
  const outcome = await first.outcome;
  if (outcome.status !== 'awaiting') throw new Error(`expected awaiting, got ${outcome.status}`);
  return { first, requestId: outcome.requestId, seqs: events.map((e) => e.seq) };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; }
  catch (e) { return (e as { code?: string }).code; }
}

describe('resume: approvals', () => {
  it('1. replays the events, then approve executes the tool exactly once and the turn completes', async () => {
    const execute = vi.fn(() => 'removed');
    const { agent, store } = build({ tools: [rmTool(execute)] });
    const { first, requestId, seqs } = await pauseRun(agent);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const handle = resume({ agent, ...ref(first) });
    expect(handle.runId).toBe(first.runId);
    const eventsP = collect(handle);
    await handle.submit({ type: 'approve', requestId });
    const events = await eventsP;
    const outcome = await handle.outcome;

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(types(events).slice(7)).toEqual(['approval.resolved', 'run.resumed', 'tool.started', 'tool.completed', 'model.started', 'model.completed', 'run.finished']);
    expect(events[7]).toMatchObject({ type: 'approval.resolved', requestId, decision: 'approve' });
    expect(outcome).toMatchObject({ status: 'completed', steps: 2, usage: { inputTokens: 2, outputTokens: 2 } });
    expect(outcome.status === 'completed' && textOf(outcome.message)).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(handle.status()).toBe('completed');

    const steps = await store.runs.listSteps(ref(first));
    expect(steps.map((s) => [s.kind, s.index, s.status])).toEqual([['model', 0, 'completed'], ['tool', 1, 'completed'], ['model', 2, 'completed']]);
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'rm', original: { content: 'removed' } });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(await store.runs.get(ref(first))).toMatchObject({ status: 'completed', steps: 2 });
    expect((await store.runs.get(ref(first)))?.pendingRequestId).toBeUndefined();
    expect(await store.requests.get({ ...ref(first), requestId })).toMatchObject({ resolution: { type: 'approve', requestId }, resolvedAt: expect.any(String) });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
    expect((await store.runs.listEvents(ref(first))).map((e) => e.seq)).toEqual(events.map((e) => e.seq));
  });

  it('2. a wrong requestId is rejected with not_found and changes nothing; the right one still works', async () => {
    const { agent, store } = build();
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    expect(await codeOf(handle.submit({ type: 'approve', requestId: 'nope' }))).toBe('not_found');
    expect(await store.runs.get(ref(first))).toMatchObject({ status: 'awaiting', pendingRequestId: requestId });
    expect((await store.requests.get({ ...ref(first), requestId }))?.resolvedAt).toBeUndefined();
    expect(handle.status()).toBe('running');
    await handle.submit({ type: 'approve', requestId });
    expect((await handle.outcome).status).toBe('completed');
  });

  it('3. approve with an edited input runs the validated edit; an invalid edit is rejected and the run stays awaiting', async () => {
    const execute = vi.fn((i: unknown) => `removed:${(i as { text: string }).text}`);
    const { agent, store } = build({ tools: [rmTool(execute)] });
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    expect(await codeOf(handle.submit({ type: 'approve', requestId, input: { text: 3 } }))).toBe('invalid_options');
    expect(await codeOf(handle.submit({ type: 'approve', requestId, input: { nope: 'x' } }))).toBe('invalid_options');
    expect((await store.runs.get(ref(first)))?.status).toBe('awaiting');
    expect(execute).not.toHaveBeenCalled();
    await handle.submit({ type: 'approve', requestId, input: { text: 'edited' } });
    expect((await handle.outcome).status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual({ text: 'edited' });
    expect((await store.runs.listSteps(ref(first)))[1]).toMatchObject({ kind: 'tool', input: { text: 'edited' } });
  });

  it('4. alwaysApprove remembers the decision for the tool in this session', async () => {
    const { agent, store } = build({ script: [callRm(), { text: 'done' }, callRm('again'), { text: 'done again' }, callRm('elsewhere')] });
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    await handle.submit({ type: 'approve', requestId, alwaysApprove: true });
    expect((await handle.outcome).status).toBe('completed');
    expect(await store.kv({ kind: 'agent', agentId: 'a' }).get('approvals/s/rm')).toBe(true);

    const second = run({ agent, session: 's', input: 'y' });
    const events = await collect(second);
    expect(types(events)).not.toContain('approval.requested');
    expect((await second.outcome).status).toBe('completed');
    const other = run({ agent, session: 'other', input: 'z' });
    expect((await other.outcome).status).toBe('awaiting');
  });

  it('5. deny appends an error result with the reason and lets the model react', async () => {
    const execute = vi.fn(() => 'removed');
    const { agent, store, model } = build({ tools: [rmTool(execute)], script: [callRm(), { text: 'ok, not removed' }] });
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    const eventsP = collect(handle);
    await handle.submit({ type: 'deny', requestId, reason: 'no' });
    const events = await eventsP;
    expect(types(events).slice(7)).toEqual(['approval.resolved', 'run.resumed', 'model.started', 'model.completed', 'run.finished']);
    expect(events[7]).toMatchObject({ type: 'approval.resolved', decision: 'deny', reason: 'no' });
    expect(types(events)).not.toContain('tool.denied');
    expect(execute).not.toHaveBeenCalled();
    expect(await handle.outcome).toMatchObject({ status: 'completed' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript[2]!.parts[0]).toMatchObject({ type: 'toolResult', name: 'rm', content: 'no', isError: true });
    expect(model.requests).toHaveLength(2);
    expect((await store.runs.listSteps(ref(first))).filter((s) => s.kind === 'tool')).toHaveLength(0);
  });

  it('6. the rest of the batch runs after the approved call, in call order', async () => {
    const order: string[] = [];
    const { agent, store } = build({
      tools: [echoTool((i) => { order.push(`echo:${(i as { text: string }).text}`); return 'e'; }), rmTool((i) => { order.push(`rm:${(i as { text: string }).text}`); return 'r'; })],
      script: [{ toolCalls: [{ name: 'echo', input: { text: 'a' } }, { name: 'rm', input: { text: 'b' } }, { name: 'echo', input: { text: 'c' } }] }, { text: 'done' }],
    });
    const { first, requestId } = await pauseRun(agent);
    expect(order).toEqual(['echo:a']);
    const handle = resume({ agent, ...ref(first) });
    await handle.submit({ type: 'approve', requestId });
    expect((await handle.outcome).status).toBe('completed');
    expect(order).toEqual(['echo:a', 'rm:b', 'echo:c']);
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'tool', 'assistant']);
    expect(transcript.slice(2, 5).map((m) => (m.parts[0] as { name: string }).name)).toEqual(['echo', 'rm', 'echo']);
    const steps = await store.runs.listSteps(ref(first));
    expect(steps.map((s) => [s.kind, s.index, s.status])).toEqual([['model', 0, 'completed'], ['tool', 1, 'completed'], ['tool', 2, 'completed'], ['tool', 3, 'completed'], ['model', 4, 'completed']]);
  });
});

describe('resume: askUser', () => {
  const questions: AskQuestion[] = [
    { id: 'lang', question: 'Which language?', options: [{ label: 'TypeScript' }, { label: 'Rust' }], allowOther: false },
    { id: 'targets', question: 'Which targets?', options: [{ label: 'node' }, { label: 'browser' }], multiSelect: true },
  ];

  it('7. answer completes the paused step with the answers and the model sees the rendered Q/A', async () => {
    const { agent, store, model } = build({ tools: [createAskUserTool()], script: [{ toolCalls: [{ name: 'ask_user', input: { questions } }] }, { text: 'thanks' }] });
    const { first, requestId } = await pauseRun(agent);
    expect((await store.requests.get({ ...ref(first), requestId }))?.kind).toBe('input');
    const handle = resume({ agent, ...ref(first) });
    expect(await codeOf(handle.submit({ type: 'approve', requestId }))).toBe('invalid_options');
    expect(await codeOf(handle.submit({ type: 'answer', requestId, answers: { lang: 'Go', targets: ['node'] } }))).toBe('invalid_options');
    expect(await codeOf(handle.submit({ type: 'answer', requestId, answers: { lang: 'Rust' } }))).toBe('invalid_options');
    expect((await store.runs.get(ref(first)))?.status).toBe('awaiting');

    const eventsP = collect(handle);
    const answers = { lang: 'Rust', targets: ['node', 'browser'] };
    await handle.submit({ type: 'answer', requestId, answers });
    const events = await eventsP;
    expect(types(events).slice(0, 8)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'input.requested', 'run.paused', 'run.finished']);
    expect(types(events).slice(8)).toEqual(['input.resolved', 'run.resumed', 'tool.completed', 'model.started', 'model.completed', 'run.finished']);
    expect(events[8]).toMatchObject({ type: 'input.resolved', requestId, answers });
    expect((await handle.outcome).status).toBe('completed');

    const rendered = renderAnswers(questions, answers);
    const steps = await store.runs.listSteps(ref(first));
    expect(steps.filter((s) => s.kind === 'tool')).toHaveLength(1);
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'ask_user', status: 'completed', original: { content: rendered, isError: false, detail: { answers } }, endedAt: expect.any(String) });
    const toolMsg = model.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.parts[0]).toMatchObject({ type: 'toolResult', name: 'ask_user', content: rendered, isError: false });
  });

  it('7b. deny declines the questions: the step fails with the reason and the model hears it', async () => {
    const { agent, store, model } = build({ tools: [createAskUserTool()], script: [{ toolCalls: [{ name: 'ask_user', input: { questions } }] }, { text: 'fine' }] });
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    const eventsP = collect(handle);
    await handle.submit({ type: 'deny', requestId, reason: 'not now' });
    const events = await eventsP;
    expect(types(events).slice(8)).toEqual(['input.declined', 'run.resumed', 'tool.completed', 'model.started', 'model.completed', 'run.finished']);
    expect(events[8]).toMatchObject({ type: 'input.declined', requestId, reason: 'not now' });
    expect(events[10]).toMatchObject({ type: 'tool.completed', name: 'ask_user', content: 'not now', isError: true });
    expect((await handle.outcome).status).toBe('completed');
    const steps = await store.runs.listSteps(ref(first));
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'ask_user', status: 'failed', original: { content: 'not now', isError: true } });
    const toolMsg = model.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.parts[0]).toMatchObject({ type: 'toolResult', name: 'ask_user', content: 'not now', isError: true });
  });
});

describe('resume: terminal, missing and crashed runs', () => {
  it('8. a completed run replays its events and outcome without touching the writer', async () => {
    const { agent, store } = build({ tools: [echoTool()], script: [{ toolCalls: [{ name: 'echo', input: { text: 'a' } }] }, { text: 'done' }] });
    const first = run({ agent, session: 's', input: 'x' });
    const outcome = await first.outcome;
    expect(outcome.status).toBe('completed');

    const handle = resume({ agent, ...ref(first), afterSeq: 2 });
    const events = await collect(handle);
    expect(events.map((e) => e.seq)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(await handle.outcome).toEqual(outcome);
    expect(handle.status()).toBe('completed');
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
    expect(await store.runs.listEvents(ref(first))).toHaveLength(9);
  });

  it('9. an unknown run fails with not_found', async () => {
    const { agent, store } = build();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    const handle = resume({ agent, sessionId: 's', runId: 'nope' });
    expect(await handle.outcome).toMatchObject({ status: 'failed', error: { code: 'not_found' }, steps: 0 });
    expect(await collect(handle)).toEqual([]);
    expect(await codeOf(handle.submit({ type: 'approve', requestId: 'q' }))).toBe('not_found');
  });

  it('10. a run whose process died mid-tool is recovered as uncertain', async () => {
    let started!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const { agent, store } = build({ tools: [echoTool(() => { started(); return new Promise(() => {}); })], script: [{ toolCalls: [{ name: 'echo', input: { text: 'a' } }, { name: 'echo', input: { text: 'b' } }] }, { text: 'never' }] });
    const first = run({ agent, session: 's', input: 'x' });
    await startedP;
    expect((await store.runs.get(ref(first)))?.status).toBe('running');
    // The memory store has no lease; releasing the claim stands in for the stale-lock takeover of a durable store.
    await store.sessions.releaseWriter({ sessionId: 's', runId: first.runId });

    const handle = resume({ agent, ...ref(first) });
    const events = await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'failed', error: { code: 'uncertain_invocation', detail: { callId: expect.any(String) } }, steps: 1, usage: { inputTokens: 1, outputTokens: 1 } });
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'run.finished']);
    const steps = await store.runs.listSteps(ref(first));
    expect(steps[1]).toMatchObject({ kind: 'tool', status: 'uncertain', endedAt: expect.any(String) });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(transcript[2]!.parts[0]).toMatchObject({ type: 'toolResult', isError: true, content: 'execution outcome unknown: the process died during the call' });
    expect(transcript[3]!.parts[0]).toMatchObject({ type: 'toolResult', isError: true, content: 'not executed: the run was interrupted' });
    expect(await store.runs.get(ref(first))).toMatchObject({ status: 'failed' });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();

    // The zombie loop finds the event log moved on and reports itself superseded. In-process it cannot be fenced
    // (same runId, same pid); a durable store fences a zombie from another process by pid.
    first.cancel();
    expect(await first.outcome).toMatchObject({ status: 'failed', error: { code: 'superseded' } });
    expect((await store.runs.listEvents(ref(first))).map((e) => e.type).at(-1)).toBe('run.finished');
  });

  it('a run that died before its first model step is recovered as interrupted', async () => {
    const { agent, store } = build();
    await store.sessions.create({ sessionId: 's', agentId: 'a' });
    await store.runs.create({ runId: 'r', sessionId: 's', agentId: 'a', status: 'running', createdAt: 'now', updatedAt: 'now', usage: { inputTokens: 0, outputTokens: 0 }, steps: 0, denials: [] });
    const handle = resume({ agent, sessionId: 's', runId: 'r' });
    expect(await handle.outcome).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
    expect((await store.runs.listEvents({ sessionId: 's', runId: 'r' })).map((e) => e.type)).toEqual(['run.finished']);
    expect((await store.runs.get({ sessionId: 's', runId: 'r' }))?.status).toBe('failed');
  });
});

describe('resume: detaching and exclusivity', () => {
  it('11. cancel while waiting denies the pending request and finishes the run cancelled with the marker (decision 120, F6)', async () => {
    const execute = vi.fn(() => 'removed');
    const { agent, store } = build({ tools: [rmTool(execute)] });
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    const eventsP = collect(handle);
    await collectUntilReplayed(handle, 7);
    handle.cancel({ reason: 'later' });
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'later', steps: 1 });
    const events = await eventsP;
    expect(types(events).slice(7)).toEqual(['approval.resolved', 'run.resumed', 'run.finished']);
    expect(events[7]).toMatchObject({ type: 'approval.resolved', requestId, decision: 'deny', reason: 'The turn was stopped' });
    expect(execute).not.toHaveBeenCalled();

    // The request is closed, the run is terminal and the claim released; the transcript answers the call and says why.
    expect((await store.requests.get({ ...ref(first), requestId }))?.resolvedAt).toEqual(expect.any(String));
    expect(await store.runs.get(ref(first))).toMatchObject({ status: 'cancelled' });
    expect('pendingRequestId' in (await store.runs.get(ref(first)))!).toBe(false);
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => [m.role, m.source])).toEqual([['user', 'input'], ['assistant', 'model'], ['tool', 'tool'], ['user', 'system']]);
    expect(transcript[2]!.parts[0]).toMatchObject({ type: 'toolResult', isError: true, content: 'The turn was stopped' });
    expect(textOf(transcript[3]!)).toBe('[Request interrupted by user]');
    expect(await codeOf(handle.submit({ type: 'approve', requestId }))).toBe('not_found');

    // A later resume() replays a terminal run and delivers the stored outcome.
    const again = resume({ agent, ...ref(first) });
    expect(await again.outcome).toMatchObject({ status: 'cancelled', reason: 'later' });
    expect(await codeOf(again.submit({ type: 'approve', requestId }))).toBe('not_found');
  });

  it('11b. cancel while waiting on an input request declines it the same way', async () => {
    const ask = createAskUserTool();
    const { agent, store } = build({ tools: [ask], script: [{ toolCalls: [{ name: 'ask_user', input: { questions: [{ id: 'q', question: 'Which?' }] } }] }, { text: 'never' }] });
    const { first, requestId, seqs } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    const eventsP = collect(handle);
    await collectUntilReplayed(handle, seqs.length);
    handle.cancel();
    expect(await handle.outcome).toMatchObject({ status: 'cancelled' });
    const events = await eventsP;
    expect(types(events).slice(seqs.length)).toEqual(['input.declined', 'run.resumed', 'tool.completed', 'run.finished']);
    expect(events[seqs.length]).toMatchObject({ type: 'input.declined', requestId, reason: 'The turn was stopped' });
    const steps = await store.runs.listSteps(ref(first));
    expect(steps[1]).toMatchObject({ kind: 'tool', status: 'failed', original: { content: 'The turn was stopped', isError: true } });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.at(-2)!.parts[0]).toMatchObject({ type: 'toolResult', content: 'The turn was stopped', isError: true });
    expect(textOf(transcript.at(-1)!)).toBe('[Request interrupted by user]');
  });

  it('12. a second resume on a live awaiting run fails with writer_busy', async () => {
    const { agent } = build();
    const { first, requestId } = await pauseRun(agent);
    const h1 = resume({ agent, ...ref(first) });
    const h2 = resume({ agent, ...ref(first) });
    expect(await h2.outcome).toMatchObject({ status: 'failed', error: { code: 'writer_busy' }, steps: 1 });
    expect(await codeOf(h2.submit({ type: 'approve', requestId }))).toBe('not_found');
    await h1.submit({ type: 'approve', requestId });
    expect((await h1.outcome).status).toBe('completed');

    const h3 = resume({ agent, ...ref(first) });
    expect((await h3.outcome).status).toBe('completed');
  });

  it('submit before the run has been read waits for the attach instead of failing', async () => {
    const { agent } = build();
    const { first, requestId } = await pauseRun(agent);
    const handle = resume({ agent, ...ref(first) });
    await handle.submit({ type: 'approve', requestId });
    expect((await handle.outcome).status).toBe('completed');
  });
});

async function collectUntilReplayed(handle: RunHandle, count: number): Promise<void> {
  let n = 0;
  for await (const _e of handle.events) { n += 1; if (n >= count) return; }
}
