import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { AgentError, ModelError } from '../errors.js';
import { textOf } from '../message/helpers.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel, type FakeStep } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import type { AgentOptions } from '../types/agent.js';
import type { RunEvent } from '../types/event.js';
import type { RunOutcome } from '../types/outcome.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { run } from './run.js';

const echoInput = { type: 'object' as const, properties: { text: { type: 'string' as const } }, required: ['text'], additionalProperties: false };

function echoTool(execute?: ToolDefinition['execute'], over: Partial<ToolDefinition> = {}): Tool {
  return createTool({ name: 'echo', description: 'echo', input: echoInput, execute: execute ?? ((i) => `echo:${(i as { text: string }).text}`), ...over });
}

const callEcho = (text = 'hi'): FakeStep => ({ toolCalls: [{ name: 'echo', input: { text } }] });
const HAPPY: FakeStep[] = [callEcho(), { text: 'done' }];

function build(opts: { script?: FakeStep[]; tools?: Tool[] } & Omit<Partial<AgentOptions>, 'tools'> = {}) {
  const { script, tools, ...rest } = opts;
  const store = rest.store ?? createMemoryStore();
  const model = createFakeModel({ script: script ?? HAPPY });
  const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: tools ?? [echoTool()], ...rest });
  return { agent, model, store };
}

async function collect(handle: { events: AsyncIterable<RunEvent> }): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}
const types = (events: RunEvent[]) => events.map((e) => e.type);
const ref = (handle: { sessionId: string; runId: string }) => ({ sessionId: handle.sessionId, runId: handle.runId });

describe('run: happy path', () => {
  it('1. runs tool → result → final answer with ordered events, transcript and steps', async () => {
    const { agent, store } = build();
    const handle = run({ agent, session: 's', input: 'Say hi' });
    expect(handle.status()).toBe('running');
    const events = await collect(handle);
    const outcome = await handle.outcome;

    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'tool.completed', 'model.started', 'model.completed', 'run.finished']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(events.every((e) => e.runId === handle.runId && e.sessionId === 's' && e.agentId === 'a')).toBe(true);
    expect(handle.status()).toBe('completed');
    expect(outcome).toMatchObject({ status: 'completed', steps: 2, usage: { inputTokens: 2, outputTokens: 2 } });
    expect(outcome.status === 'completed' && textOf(outcome.message)).toBe('done');
    expect((events.at(-1) as { outcome: RunOutcome }).outcome).toEqual(outcome);

    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(transcript.map((m) => m.source)).toEqual(['input', 'model', 'tool', 'model']);
    expect(transcript[2]!.parts).toEqual([{ type: 'toolResult', callId: expect.any(String), name: 'echo', content: 'echo:hi', isError: false }]);

    const steps = await store.runs.listSteps(ref(handle));
    expect(steps.map((s) => [s.kind, s.index, s.status])).toEqual([['model', 0, 'completed'], ['tool', 1, 'completed'], ['model', 2, 'completed']]);
    expect(steps[1]).toMatchObject({ kind: 'tool', input: { text: 'hi' } });
    expect(steps[0]).toMatchObject({ kind: 'model', request: { instructions: 'be brief' }, reply: { finish: 'tool_calls' } });
    expect(steps[0] && 'request' in steps[0] && steps[0].request && 'signal' in steps[0].request).toBe(false);

    expect(await store.runs.get(ref(handle))).toMatchObject({ status: 'completed', agentId: 'a' });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
    expect((await store.runs.listEvents(ref(handle))).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('2. feeds an unparsable tool call back as an error result and continues', async () => {
    const { agent, model } = build({ script: [{ rawToolCall: { name: 'echo', raw: '{nope' } }, { text: 'recovered' }] });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.denied', 'model.started', 'model.completed', 'run.finished']);
    expect((events[4] as { reason: string }).reason).toMatch(/^Invalid arguments/);
    const second = model.requests[1]!;
    const toolMsg = second.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.parts[0]).toMatchObject({ type: 'toolResult', isError: true, content: expect.stringMatching(/^Invalid arguments/) });
    expect((await handle.outcome).status).toBe('completed');
  });

  it('3. denies an unknown tool without proposing it and continues', async () => {
    const { agent } = build({ script: [{ toolCalls: [{ name: 'nope', input: {} }] }, { text: 'ok' }] });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.denied', 'model.started', 'model.completed', 'run.finished']);
    expect((await handle.outcome).status).toBe('completed');
  });
});

describe('run: limits', () => {
  it('4. stops at maxSteps after appending the tool result', async () => {
    const { agent, store } = build({ limits: { maxSteps: 1 } });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'stopped', reason: 'max_steps', steps: 1 });
    expect(types(events).at(-1)).toBe('run.finished');
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect((await store.runs.get(ref(handle)))?.status).toBe('stopped');
  });

  it('5. stops at maxToolCalls, denying the rest of the batch with results', async () => {
    const execute = vi.fn(() => 'r');
    const { agent, store } = build({
      script: [{ toolCalls: [{ name: 'echo', input: { text: 'a' } }, { name: 'echo', input: { text: 'b' } }] }, { text: 'never' }],
      tools: [echoTool(execute)],
      limits: { maxToolCalls: 1 },
    });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(types(events)).toEqual(['run.started', 'model.started', 'model.completed', 'tool.proposed', 'tool.started', 'tool.completed', 'tool.denied', 'run.finished']);
    expect(events[6]).toMatchObject({ type: 'tool.denied', reason: 'max_tool_calls' });
    expect(await handle.outcome).toMatchObject({ status: 'stopped', reason: 'max_tool_calls' });
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    expect(transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(transcript[3]!.parts[0]).toMatchObject({ type: 'toolResult', isError: true, content: 'Tool call limit reached' });
  });
});

describe('run: hooks and approvals', () => {
  it('6. beforeTool deny skips the executor and the run continues', async () => {
    const execute = vi.fn(() => 'r');
    const { agent } = build({ tools: [echoTool(execute)], hooks: { beforeTool: () => ({ decision: 'deny', reason: 'no' }) } });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    expect(execute).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'tool.denied')).toMatchObject({ reason: 'no' });
    expect((await handle.outcome).status).toBe('completed');
  });

  it('7. a destructive tool pauses the run as awaiting and keeps the writer claim', async () => {
    const execute = vi.fn(() => 'r');
    const { agent, store } = build({ tools: [echoTool(execute, { effects: { destructive: true } })] });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    const outcome = await handle.outcome;
    expect(execute).not.toHaveBeenCalled();
    expect(types(events).slice(-4)).toEqual(['tool.proposed', 'approval.requested', 'run.paused', 'run.finished']);
    expect(outcome).toMatchObject({ status: 'awaiting', kind: 'approval', sessionId: 's', runId: handle.runId, steps: 1 });
    const requestId = outcome.status === 'awaiting' ? outcome.requestId : '';
    expect(events.find((e) => e.type === 'approval.requested')).toMatchObject({ requestId, name: 'echo', input: { text: 'hi' } });
    expect(await store.requests.get({ ...ref(handle), requestId })).toMatchObject({ kind: 'approval', payload: { name: 'echo', input: { text: 'hi' } }, callId: expect.any(String) });
    expect(await store.runs.get(ref(handle))).toMatchObject({ status: 'awaiting', pendingRequestId: requestId });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBe(handle.runId);
    expect(handle.status()).toBe('awaiting');
    await expect(handle.submit({ type: 'approve', requestId })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('8. a remembered approval skips the pause', async () => {
    const store = createMemoryStore();
    await store.kv({ kind: 'agent', agentId: 'a' }).set('approvals/s/echo', true);
    const { agent } = build({ store, tools: [echoTool(undefined, { effects: { destructive: true } })] });
    const handle = run({ agent, session: 's', input: 'x' });
    const events = await collect(handle);
    expect(types(events)).not.toContain('approval.requested');
    expect((await handle.outcome).status).toBe('completed');
  });

  it('12. beforeModel abort stops the run with reason policy before the model is called', async () => {
    const { agent, model, store } = build({ hooks: { beforeModel: () => ({ abort: { reason: 'blocked' } }) } });
    const handle = run({ agent, session: 's', input: 'x' });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'stopped', reason: 'policy', steps: 1 });
    expect(model.requests).toHaveLength(0);
    const [step] = await store.runs.listSteps(ref(handle));
    expect(step).toMatchObject({ kind: 'model', status: 'completed', detail: { abortedBy: 'beforeModel', reason: 'blocked' } });
  });

  it('13. maps hook, adapter and capability failures to failed outcomes', async () => {
    const hook = build({ hooks: { afterModel: () => { throw new Error('bad hook'); } } });
    const h1 = run({ agent: hook.agent, session: 's', input: 'x' });
    await collect(h1);
    expect(await h1.outcome).toMatchObject({ status: 'failed', error: { code: 'hook_error', message: 'afterModel: bad hook' } });
    expect((await hook.store.runs.listSteps(ref(h1)))[0]).toMatchObject({ status: 'failed' });
    expect((await hook.store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();

    const model = build({ script: [{ error: { code: 'server', message: 'down' } }] });
    const h2 = run({ agent: model.agent, session: 's', input: 'x' });
    await collect(h2);
    expect(await h2.outcome).toMatchObject({ status: 'failed', error: { code: 'server', message: 'down', detail: { name: 'ModelError', code: 'server' } } });

    const cap = build({ capabilities: [{ id: 'broken', tools: () => { throw new Error('nope'); } }] });
    const h3 = run({ agent: cap.agent, session: 's', input: 'x' });
    const events = await collect(h3);
    expect(types(events)).toEqual(['run.finished']);
    expect(await h3.outcome).toMatchObject({ status: 'failed', error: { code: 'capability_error', message: 'capability "broken": nope', detail: { capability: 'broken' } } });
    expect(await cap.store.sessions.listMessages({ sessionId: 's' })).toEqual([]);

    const toolHook = build({ hooks: { beforeTool: () => { throw new Error('bad tool hook'); } } });
    const h4 = run({ agent: toolHook.agent, session: 's', input: 'x' });
    await collect(h4);
    expect(await h4.outcome).toMatchObject({ status: 'failed', error: { code: 'hook_error' } });
    expect(ModelError).toBeDefined();
    expect(AgentError).toBeDefined();
  });

  it('14. capabilities contribute tools and an instructions section; clashes fail the run', async () => {
    const now = createTool({ name: 'now', description: 'time', input: { type: 'object' }, execute: () => '12:00' });
    const seen: string[] = [];
    const { agent, model, store } = build({
      script: [{ toolCalls: [{ name: 'now', input: {} }] }, { text: 'ok' }],
      capabilities: [{
        id: 'clock',
        tools: (args) => { seen.push(args.sessionId, args.runId); return [now]; },
        instructions: () => '  Use the now tool for time.  ',
      }],
    });
    const handle = run({ agent, session: 's', input: 'x' });
    await collect(handle);
    expect((await handle.outcome).status).toBe('completed');
    expect(model.requests[0]!.instructions).toBe('be brief\n\n## clock\nUse the now tool for time.');
    expect(model.requests[0]!.tools.map((t) => t.name)).toEqual(['echo', 'now']);
    expect(seen).toEqual(['s', handle.runId]);
    const steps = await store.runs.listSteps(ref(handle));
    expect(steps[1]).toMatchObject({ kind: 'tool', name: 'now', status: 'completed', original: { content: '12:00' } });

    const clash = build({ capabilities: [{ id: 'dup', tools: () => [echoTool()] }] });
    const h2 = run({ agent: clash.agent, session: 's', input: 'x' });
    await collect(h2);
    expect(await h2.outcome).toMatchObject({ status: 'failed', error: { code: 'invalid_options', message: 'capability "dup" contributes a duplicate tool "echo"' } });
  });
});

describe('run: cancellation and timeouts', () => {
  it('9. cancel while a tool executes → cancelled, step uncertain, writer released', async () => {
    let started!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const { agent, store } = build({ tools: [echoTool(() => { started(); return new Promise(() => {}); })] });
    const handle = run({ agent, session: 's', input: 'x' });
    await startedP;
    handle.cancel({ reason: 'user' });
    const events = await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'cancelled', reason: 'user', steps: 1 });
    expect(types(events).at(-1)).toBe('run.finished');
    expect(types(events)).not.toContain('tool.completed');
    const steps = await store.runs.listSteps(ref(handle));
    expect(steps[1]).toMatchObject({ kind: 'tool', status: 'uncertain' });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBeUndefined();
    expect((await store.runs.get(ref(handle)))?.status).toBe('cancelled');
  });

  it('10. timeoutMs stops the run with reason timeout', async () => {
    const { agent } = build({ tools: [echoTool(() => new Promise(() => {}))], limits: { timeoutMs: 20 } });
    const handle = run({ agent, session: 's', input: 'x' });
    await collect(handle);
    expect(await handle.outcome).toMatchObject({ status: 'stopped', reason: 'timeout' });
  });

  it('releases the timeout timer and the external listener once the run settles', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { agent } = build({ limits: { timeoutMs: 60_000 } });
      const handle = run({ agent, session: 's', input: 'x', signal: controller.signal });
      expect(vi.getTimerCount()).toBe(1);
      expect((await handle.outcome).status).toBe('completed');
      expect(vi.getTimerCount()).toBe(0);
      controller.abort();
      expect(handle.status()).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('11. a second run on a busy session fails with writer_busy and touches nothing', async () => {
    let started!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const { agent, store } = build({ tools: [echoTool(() => { started(); return new Promise(() => {}); })] });
    const first = run({ agent, session: 's', input: 'x' });
    await startedP;
    const before = (await store.sessions.listMessages({ sessionId: 's' })).length;

    const second = run({ agent, session: 's', input: 'y' });
    const events = await collect(second);
    expect(types(events)).toEqual(['run.finished']);
    expect(await second.outcome).toMatchObject({ status: 'failed', error: { code: 'writer_busy' }, steps: 0 });
    expect((await store.sessions.listMessages({ sessionId: 's' })).length).toBe(before);
    expect(await store.runs.get(ref(second))).toMatchObject({ status: 'failed' });
    expect((await store.sessions.get({ sessionId: 's' }))?.activeWriterRunId).toBe(first.runId);

    first.cancel();
    expect((await first.outcome).status).toBe('cancelled');
  });

  it('honors an external signal and submit({ type: cancel })', async () => {
    const controller = new AbortController();
    controller.abort();
    const { agent } = build();
    const h1 = run({ agent, session: 's', input: 'x', signal: controller.signal });
    expect(await h1.outcome).toMatchObject({ status: 'cancelled', reason: 'signal', steps: 0 });

    let started!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const slow = build({ tools: [echoTool(() => { started(); return new Promise(() => {}); })] });
    const h2 = run({ agent: slow.agent, session: 's2', input: 'x' });
    await startedP;
    await h2.submit({ type: 'cancel', reason: 'via submit' });
    expect(await h2.outcome).toMatchObject({ status: 'cancelled', reason: 'via submit' });
  });
});

describe('run: handle and sessions', () => {
  it('15. every iterator sees the same events, even one started after the outcome', async () => {
    const { agent } = build();
    const handle = run({ agent, session: 's', input: 'x' });
    const [a, b] = await Promise.all([collect(handle), collect(handle)]);
    await handle.outcome;
    const c = await collect(handle);
    expect(a.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('16. workspace is stored on a new session, ignored on an existing one, and reaches the tool', async () => {
    const seen: (string | undefined)[] = [];
    const { agent, store } = build({
      script: [callEcho(), { text: 'one' }, callEcho(), { text: 'two' }],
      tools: [echoTool((_i, ctx) => { seen.push(ctx.kv.workspace ? 'ws' : undefined); return 'r'; })],
    });
    const h1 = run({ agent, session: 's', workspace: 'F:/x', input: 'x' });
    await h1.outcome;
    expect((await store.sessions.get({ sessionId: 's' }))?.workspace).toBe('F:/x');
    const h2 = run({ agent, session: 's', workspace: 'F:/other', input: 'y' });
    await h2.outcome;
    expect((await store.sessions.get({ sessionId: 's' }))?.workspace).toBe('F:/x');
    expect(seen).toEqual(['ws', 'ws']);
    expect((await store.sessions.listMessages({ sessionId: 's' })).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user', 'assistant', 'tool', 'assistant']);
    expect(await store.sessions.list({ workspace: 'F:/x' })).toHaveLength(1);
  });

  it('accepts content parts as input and observers see every event', async () => {
    const onEvent = vi.fn(() => { throw new Error('observer bug'); });
    const warn = vi.fn();
    const { agent, store } = build({ script: [{ text: 'hello' }], hooks: { onEvent }, warn });
    const handle = run({ agent, session: 's', input: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
    await collect(handle);
    expect((await store.sessions.listMessages({ sessionId: 's' }))[0]!.parts).toHaveLength(2);
    expect(onEvent).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0]![0]).toMatch(/onEvent observer threw on run.started/);
  });
});
