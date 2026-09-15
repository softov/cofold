import { describe, expect, it, vi } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import type { AgentOptions } from '../types/agent.js';
import type { RunEventBody } from '../types/event.js';
import type { RunInfo } from '../types/hooks.js';
import type { ToolCallPart } from '../types/message.js';
import type { Store } from '../types/store.js';
import type { Tool, ToolDefinition } from '../types/tool.js';
import { createRunAbort } from './abort.js';
import { boundOutput, handleToolCall, type ToolCallDeps } from './tools.js';

const input = { type: 'object' as const, properties: { text: { type: 'string' as const }, loud: { type: 'boolean' as const, default: false } }, required: ['text'], additionalProperties: false };

async function setup(opts: {
  execute?: ToolDefinition['execute'];
  effects?: Tool['effects'];
  hooks?: AgentOptions['hooks'];
  policy?: AgentOptions['policy'];
  limits?: AgentOptions['limits'];
  store?: Store;
}) {
  const store = opts.store ?? createMemoryStore();
  const execute = vi.fn(opts.execute ?? ((i: unknown) => `echo:${(i as { text: string }).text}`));
  const echo = createTool({ name: 'echo', description: 'd', input, ...(opts.effects ? { effects: opts.effects } : {}), execute });
  const agent = createAgent({
    id: 'a', instructions: 'x', model: createFakeModel({ script: [] }), store, tools: [echo],
    ...(opts.hooks ? { hooks: opts.hooks } : {}), ...(opts.policy ? { policy: opts.policy } : {}), ...(opts.limits ? { limits: opts.limits } : {}),
    resources: { token: 't' },
  });
  await store.sessions.create({ sessionId: 's', agentId: 'a', workspace: 'w' });
  await store.runs.create({ runId: 'r', sessionId: 's', agentId: 'a', status: 'running', createdAt: 'now', updatedAt: 'now', usage: { inputTokens: 0, outputTokens: 0 }, steps: 0 });
  const kv = { agent: store.kv({ kind: 'agent', agentId: 'a' }), shared: store.kv({ kind: 'shared', namespace: 'default' }), workspace: store.kv({ kind: 'workspace', workspace: 'w' }) };
  const run: RunInfo = { runId: 'r', sessionId: 's', agentId: 'a', step: 1, kv };
  const events: RunEventBody[] = [];
  const abort = createRunAbort({ timeoutMs: 0 });
  let index = 0;
  const deps: ToolCallDeps = {
    agent, tools: agent.tools, run, abort,
    emit: async (body) => { events.push(body); return { ...body, seq: events.length, runId: 'r', sessionId: 's', agentId: 'a', at: 'now' }; },
    nextStepIndex: () => index++,
  };
  const steps = () => store.runs.listSteps({ sessionId: 's', runId: 'r' });
  return { deps, events, execute, store, abort, kv, steps, types: () => events.map((e) => e.type) };
}

const call = (over: Partial<ToolCallPart> = {}): ToolCallPart => ({ type: 'toolCall', callId: 'c1', name: 'echo', input: { text: 'hi' }, raw: '{"text":"hi"}', ...over });

describe('handleToolCall denials', () => {
  it('denies an unknown tool without proposing it', async () => {
    const t = await setup({});
    const r = await handleToolCall(t.deps, call({ name: 'nope' }));
    expect(r).toEqual({ kind: 'result', executed: false, part: { type: 'toolResult', callId: 'c1', name: 'nope', content: 'Unknown tool "nope"', isError: true } });
    expect(t.types()).toEqual(['tool.denied']);
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('denies unparsable arguments', async () => {
    const t = await setup({});
    const r = await handleToolCall(t.deps, call({ input: undefined, raw: '{oops' }));
    expect(r.kind === 'result' && r.part.content).toBe('Invalid arguments: not valid JSON');
    expect(t.types()).toEqual(['tool.proposed', 'tool.denied']);
  });

  it('denies a schema failure with the issue path', async () => {
    const t = await setup({});
    const r = await handleToolCall(t.deps, call({ input: { text: 3 } }));
    expect(r.kind === 'result' && r.part.content).toBe('Invalid arguments: $.text expected string, got number');
    expect(t.events.at(-1)).toMatchObject({ type: 'tool.denied', reason: 'Invalid arguments: $.text expected string, got number' });
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('denies when beforeTool says deny', async () => {
    const t = await setup({ hooks: { beforeTool: () => ({ decision: 'deny', reason: 'not now' }) } });
    const r = await handleToolCall(t.deps, call());
    expect(r.kind === 'result' && r.part).toMatchObject({ content: 'not now', isError: true });
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('applies a valid modify (with defaults) and denies an invalid one', async () => {
    const ok = await setup({ hooks: { beforeTool: () => ({ decision: 'modify', input: { text: 'changed' } }) } });
    const r = await handleToolCall(ok.deps, call());
    expect(r.kind === 'result' && r.part.content).toBe('echo:changed');
    expect(ok.execute.mock.calls[0]![0]).toEqual({ text: 'changed', loud: false });

    const bad = await setup({ hooks: { beforeTool: () => ({ decision: 'modify', input: { text: 1 } }) } });
    const d = await handleToolCall(bad.deps, call());
    expect(d.kind === 'result' && d.part.content).toMatch(/^Invalid arguments after hook modify: \$\.text/);
    expect(bad.execute).not.toHaveBeenCalled();
  });
});

describe('handleToolCall approvals', () => {
  it('returns approval when the hook asks for it, with the prompt', async () => {
    const t = await setup({ hooks: { beforeTool: () => ({ decision: 'approval', prompt: 'sure?' }) } });
    const r = await handleToolCall(t.deps, call());
    expect(r).toMatchObject({ kind: 'approval', input: { text: 'hi', loud: false }, prompt: 'sure?' });
    expect(t.execute).not.toHaveBeenCalled();
    expect(t.types()).toEqual(['tool.proposed']);
  });

  it('keeps the policy floor when the hook allows a destructive tool', async () => {
    const t = await setup({ effects: { destructive: true }, hooks: { beforeTool: () => ({ decision: 'allow' }) } });
    const r = await handleToolCall(t.deps, call());
    expect(r.kind).toBe('approval');
    expect('prompt' in r).toBe(false);
    expect(t.execute).not.toHaveBeenCalled();
  });

  it('passes the validated input and run to the policy', async () => {
    const requireApproval = vi.fn(() => false);
    const t = await setup({ policy: { requireApproval } });
    await handleToolCall(t.deps, call());
    expect(requireApproval).toHaveBeenCalledWith({ tool: t.deps.tools.get('echo'), input: { text: 'hi', loud: false }, run: t.deps.run });
  });

  it('executes when the approval is remembered in agent kv', async () => {
    const t = await setup({ effects: { destructive: true } });
    await t.kv.agent.set('approvals/s/echo', true);
    const r = await handleToolCall(t.deps, call());
    expect(r.kind === 'result' && r.executed).toBe(true);
    expect(t.types()).toEqual(['tool.proposed', 'tool.started', 'tool.completed']);
  });
});

describe('execute', () => {
  it('records the step, context, events and result', async () => {
    const t = await setup({
      execute: (i, ctx) => ({ content: `echo:${(i as { text: string }).text}`, detail: { agentId: ctx.agentId, sessionId: ctx.sessionId, runId: ctx.runId, callId: ctx.callId, hasWorkspace: ctx.kv.workspace !== undefined, token: (ctx.resources as { token: string }).token } }),
    });
    const r = await handleToolCall(t.deps, call());
    expect(r).toEqual({ kind: 'result', executed: true, part: { type: 'toolResult', callId: 'c1', name: 'echo', content: 'echo:hi', isError: false } });
    const [step] = await t.steps();
    expect(step).toMatchObject({
      kind: 'tool', index: 0, status: 'completed', callId: 'c1', name: 'echo', input: { text: 'hi', loud: false },
      original: { content: 'echo:hi', isError: false, detail: { agentId: 'a', sessionId: 's', runId: 'r', callId: 'c1', hasWorkspace: true, token: 't' } },
    });
    expect(step && 'transformed' in step).toBe(false);
    expect(typeof step?.endedAt).toBe('string');
    expect(t.events[1]).toMatchObject({ type: 'tool.started', invocationId: step?.invocationId });
    expect(t.events[2]).toMatchObject({ type: 'tool.completed', invocationId: step?.invocationId, content: 'echo:hi', isError: false });
    expect(typeof (t.events[2] as { durationMs: number }).durationMs).toBe('number');
  });

  it('turns a throwing executor into an error result and a failed step', async () => {
    const t = await setup({ execute: () => { throw new TypeError('boom'); } });
    const r = await handleToolCall(t.deps, call());
    expect(r.kind === 'result' && r.part).toMatchObject({ content: 'boom', isError: true });
    const [step] = await t.steps();
    expect(step).toMatchObject({ status: 'failed', original: { content: 'boom', isError: true, detail: { name: 'TypeError' } } });
    expect(t.events.at(-1)).toMatchObject({ type: 'tool.completed', isError: true });
  });

  it('bounds the content the model sees but keeps the original in the step', async () => {
    const t = await setup({ execute: () => 'x'.repeat(50), limits: { maxToolOutputChars: 10 } });
    const r = await handleToolCall(t.deps, call());
    expect(r.kind === 'result' && r.part.content).toBe(`${'x'.repeat(10)}\n…[truncated 40 chars]`);
    const [step] = await t.steps();
    expect(step && 'original' in step && step.original?.content).toBe('x'.repeat(50));
    expect(boundOutput('short', 10)).toBe('short');
  });

  it('records an afterTool transform', async () => {
    const t = await setup({ hooks: { afterTool: ({ output }) => ({ output: `[redacted ${typeof output === 'string' ? output.length : 0}]`, isError: true }) } });
    const r = await handleToolCall(t.deps, call());
    expect(r.kind === 'result' && r.part).toMatchObject({ content: '[redacted 7]', isError: true });
    const [step] = await t.steps();
    expect(step).toMatchObject({ status: 'completed', original: { content: 'echo:hi', isError: false }, transformed: { content: '[redacted 7]', isError: true } });
    expect(t.events.at(-1)).toMatchObject({ type: 'tool.completed', content: '[redacted 7]', isError: true });
  });

  it('returns aborted and marks the step uncertain when the run is cancelled mid-execution', async () => {
    const t = await setup({ execute: () => new Promise(() => {}) });
    const pending = handleToolCall(t.deps, call());
    setTimeout(() => t.abort.abort({ kind: 'cancel', reason: 'user' }), 5);
    const started = Date.now();
    const r = await pending;
    expect(Date.now() - started).toBeLessThan(50);
    expect(r).toEqual({ kind: 'aborted' });
    const [step] = await t.steps();
    expect(step).toMatchObject({ status: 'uncertain' });
    expect(typeof step?.endedAt).toBe('string');
    expect(t.types()).toEqual(['tool.proposed', 'tool.started']);
  });
});
