import type { ContentPart } from '../types/message.js';
import type { FakeStep } from '../types/testing.js';
import type { Tool } from '../types/tool.js';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../agent/create-agent.js';
import { createMemoryStore } from '../store/memory.js';
import { createFakeModel } from '../testing/fake-model.js';
import { createTool } from '../tool/create-tool.js';
import { run } from './run.js';

const slowInput = { type: 'object' as const, properties: {}, additionalProperties: false };
const slow: Tool = createTool({
  name: 'slow', description: 'waits', input: slowInput,
  execute: async () => { await new Promise((done) => setTimeout(done, 30)); return 'done'; },
});

function build(script: FakeStep[], stream = true) {
  const store = createMemoryStore();
  const model = createFakeModel({ script, stream });
  const agent = createAgent({ id: 'a', instructions: 'be brief', model, store, tools: [slow] });
  return { agent, model, store };
}

const at = (value: string | undefined): number => {
  expect(value).toEqual(expect.any(String));
  const parsed = Date.parse(value as string);
  expect(Number.isNaN(parsed)).toBe(false);
  return parsed;
};

const span = (part: ContentPart): [number, number] => {
  const start = at(part.startedAt);
  const end = at(part.endedAt);
  expect(end).toBeGreaterThanOrEqual(start);
  return [start, end];
};

describe('a part says when it ran', () => {
  it('1. a streamed reasoning part and text part each have their own span, reasoning first', async () => {
    const { agent } = build([{ text: 'yes', reasoning: 'thinking hard' }]);
    const handle = run({ agent, session: 's', input: '?' });
    const outcome = await handle.outcome;
    if (outcome.status !== 'completed') throw new Error(outcome.status);
    const [reasoning, text] = outcome.message.parts;
    expect(reasoning).toMatchObject({ type: 'reasoning' });
    expect(text).toMatchObject({ type: 'text' });
    const [, thought] = span(reasoning!);
    const [wrote] = span(text!);
    expect(wrote).toBeGreaterThanOrEqual(thought);
  });

  it('2. every part of a reply that did not stream has the model call\'s span', async () => {
    const { agent } = build([{ text: 'yes', reasoning: 'thinking hard' }], false);
    const handle = run({ agent, session: 's', input: '?' });
    const outcome = await handle.outcome;
    if (outcome.status !== 'completed') throw new Error(outcome.status);
    const [reasoning, text] = outcome.message.parts;
    expect(span(reasoning!)).toEqual(span(text!));
  });

  it('3. a tool call has its reply\'s times, and its result the time its tool ran', async () => {
    const { agent, store } = build([{ toolCalls: [{ name: 'slow', input: {} }] }, { text: 'ok' }]);
    const handle = run({ agent, session: 's', input: 'wait' });
    await handle.outcome;
    const transcript = await store.sessions.listMessages({ sessionId: 's' });
    const call = transcript[1]!.parts[0]!;
    const result = transcript[2]!.parts[0]!;
    expect(call).toMatchObject({ type: 'toolCall' });
    expect(result).toMatchObject({ type: 'toolResult', content: 'done' });
    span(call);
    const [start, end] = span(result);
    expect(end - start).toBeGreaterThanOrEqual(20);
  });

  it('4. no time reaches the model', async () => {
    const { agent, model } = build([{ toolCalls: [{ name: 'slow', input: {} }] }, { text: 'ok' }]);
    await run({ agent, session: 's', input: 'wait' }).outcome;
    const sent = JSON.stringify(model.requests.at(-1));
    expect(sent).not.toContain('startedAt');
    expect(sent).not.toContain('endedAt');
  });
});
