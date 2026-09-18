import type { FakeStep } from '../types/testing.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { run } from '../run/run.js';
import { createMemoryStore } from './memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { sessionUsage } from './usage.js';

const echo = createTool({
  name: 'echo', description: 'echo',
  input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  execute: (input) => `echo:${(input as { text: string }).text}`,
});

describe('sessionUsage', () => {
  it('sums a session run by run: tokens, steps, the tool calls that ran and the ones refused, oldest first', async () => {
    const store = createMemoryStore();
    const script: FakeStep[] = [
      { toolCalls: [{ name: 'echo', input: { text: 'a' } }, { name: 'nope', input: {} }] }, { text: 'one' },
      { text: 'two' },
    ];
    const agent = createAgent({ id: 'a', instructions: 'be brief', model: createFakeModel({ script }), store, tools: [echo] });
    const first = run({ agent, session: 's', input: 'x' });
    expect((await first.outcome).status).toBe('completed');
    const second = run({ agent, session: 's', input: 'y' });
    expect((await second.outcome).status).toBe('completed');

    const used = await sessionUsage({ store, sessionId: 's' });
    expect(used.sessionId).toBe('s');
    expect(used.runs.map((one) => [one.runId, one.status, one.steps, one.toolCalls, one.denials])).toEqual([
      [first.runId, 'completed', 2, 1, 1],
      [second.runId, 'completed', 1, 0, 0],
    ]);
    const records = await store.runs.list({ sessionId: 's' });
    const fromRecords = records.reduce((sum, record) => ({ inputTokens: sum.inputTokens + record.usage.inputTokens, outputTokens: sum.outputTokens + record.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
    expect(used.usage).toMatchObject(fromRecords);
    expect(used.usage.inputTokens).toBeGreaterThan(0);
    expect(used.steps).toBe(3);
    expect(used.toolCalls).toBe(1);
    expect(used.denials).toBe(1);
    // A session that is not there is the store's `not_found`, not an empty sum.
    await expect(sessionUsage({ store, sessionId: 'never' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
