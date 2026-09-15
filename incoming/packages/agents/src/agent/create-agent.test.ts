import { describe, expect, it, vi } from 'vitest';
import { AgentError } from '../errors.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import type { RunInfo } from '../types/hooks.js';
import { createAgent } from './create-agent.js';
import { DEFAULT_LIMITS } from './limits.js';

const model = createFakeModel({ script: [] });
const echo = createTool<{ text: string }>({
  name: 'echo',
  description: 'echo',
  input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  execute: (i) => i.text,
});
const rm = createTool({ name: 'rm', description: 'remove', input: { type: 'object' }, effects: { destructive: true }, execute: () => '' });
const store = createMemoryStore();
const runInfo: RunInfo = { runId: 'r', sessionId: 's', agentId: 'a', step: 1, kv: { agent: store.kv({ kind: 'agent', agentId: 'a' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) } };

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(AgentError);
    return (e as AgentError).code;
  }
}

describe('createAgent', () => {
  it('rejects bad options with invalid_options', () => {
    expect(code(() => createAgent({ id: 'bad id', instructions: 'x', model, store }))).toBe('invalid_options');
    expect(code(() => createAgent({ id: 'a', instructions: '  ', model, store }))).toBe('invalid_options');
    expect(code(() => createAgent({ id: 'a', instructions: 'x', model: {} as never, store }))).toBe('invalid_options');
    expect(code(() => createAgent({ id: 'a', instructions: 'x', model, store, tools: [echo, echo] }))).toBe('invalid_options');
    const cap = { id: 'skills' };
    expect(code(() => createAgent({ id: 'a', instructions: 'x', model, store, capabilities: [cap, cap] }))).toBe('invalid_options');
    expect(code(() => createAgent({ id: 'a', instructions: 'x', model, store, capabilities: [{ id: 'mcp:server' }] }))).toBe('invalid_options');
  });

  it('fills defaults and freezes the result', async () => {
    const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [echo, rm] });
    expect(Object.isFrozen(agent)).toBe(true);
    expect(agent.limits).toEqual(DEFAULT_LIMITS);
    expect(agent.context.maxTokens).toBe(32_000);
    expect(agent.context.estimateTokens('abcd')).toBe(1);
    expect(agent.context.estimateTokens('abcde')).toBe(2);
    expect(await agent.policy.requireApproval({ tool: rm, input: {}, run: runInfo })).toBe(true);
    expect(await agent.policy.requireApproval({ tool: echo, input: {}, run: runInfo })).toBe(false);
    expect(agent.sharedNamespace).toBe('default');
    expect(agent.hooks).toEqual({});
    expect(agent.params).toEqual({});
    expect(agent.resources).toEqual({});
    expect(agent.store).toBe(store);
    expect(agent.model).toBe(model);
    expect(agent.tools.get('echo')).toBe(echo);
    expect(agent.definition).toEqual({
      id: 'a',
      instructions: 'be brief',
      model: { id: 'fake:fake', modelId: 'fake' },
      tools: ['echo', 'rm'],
      capabilities: [],
      limits: DEFAULT_LIMITS,
      context: { maxTokens: 32_000 },
    });
  });

  it('applies overrides', async () => {
    const warn = vi.fn();
    const agent = createAgent({
      id: 'a',
      instructions: 'x',
      model,
      store,
      capabilities: [{ id: 'skills' }, { id: 'mcp-fs' }],
      limits: { maxSteps: 3 },
      context: { maxTokens: 100, estimateTokens: (t) => t.length },
      policy: { requireApproval: () => true },
      params: { temperature: 0 },
      resources: { token: 't' },
      sharedNamespace: 'team',
      warn,
    });
    expect(agent.limits).toEqual({ ...DEFAULT_LIMITS, maxSteps: 3 });
    expect(agent.context.estimateTokens('abcd')).toBe(4);
    expect(await agent.policy.requireApproval({ tool: echo, input: {}, run: runInfo })).toBe(true);
    expect(agent.definition.capabilities).toEqual(['skills', 'mcp-fs']);
    expect(agent.definition.context).toEqual({ maxTokens: 100 });
    expect(agent.resources).toEqual({ token: 't' });
    expect(agent.sharedNamespace).toBe('team');
    expect(agent.warn).toBe(warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns exactly once per process when no store is given', () => {
    const warn = vi.fn();
    const a = createAgent({ id: 'a', instructions: 'x', model, warn });
    const b = createAgent({ id: 'b', instructions: 'x', model, warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/in-memory store/);
    expect(a.store).not.toBe(b.store);
    expect(typeof a.store.kv).toBe('function');
  });
});
