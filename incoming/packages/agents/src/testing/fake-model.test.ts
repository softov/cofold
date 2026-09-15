import { describe, expect, it } from 'vitest';
import { ModelError } from '../errors.js';
import { textOf, toolCallsOf } from '../message/helpers.js';
import type { ModelRequest } from '../types/model.js';
import { createFakeModel } from './fake-model.js';

const request = (signal: AbortSignal = new AbortController().signal): ModelRequest => ({
  instructions: 'be brief',
  messages: [{ id: 'm1', role: 'user', source: 'input', createdAt: 'now', parts: [{ type: 'text', text: 'hi' }] }],
  tools: [{ name: 'echo', description: 'echo', input: { type: 'object' } }],
  params: { temperature: 0 },
  signal,
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(ModelError);
    return (e as ModelError).code;
  }
}

describe('createFakeModel', () => {
  it('consumes the script in order and records requests', async () => {
    const model = createFakeModel({
      script: [
        { toolCalls: [{ name: 'echo', input: { text: 'a' }, callId: 'c1' }], text: 'calling' },
        { text: 'done', usage: { inputTokens: 5, outputTokens: 7 } },
      ],
    });
    expect(model.id).toBe('fake:fake');
    expect(model.features).toEqual({ tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false });
    expect(model.remaining()).toBe(2);

    const first = await model.complete(request());
    expect(first.finish).toBe('tool_calls');
    expect(first.message.role).toBe('assistant');
    expect(first.message.source).toBe('model');
    expect(textOf(first.message)).toBe('calling');
    expect(toolCallsOf(first.message)).toEqual([{ type: 'toolCall', callId: 'c1', name: 'echo', input: { text: 'a' }, raw: '{"text":"a"}' }]);
    expect(first.usage).toEqual({ inputTokens: 1, outputTokens: 1 });

    const second = await model.complete(request());
    expect(second.finish).toBe('stop');
    expect(textOf(second.message)).toBe('done');
    expect(second.usage).toEqual({ inputTokens: 5, outputTokens: 7 });

    expect(model.remaining()).toBe(0);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]).toEqual({ instructions: 'be brief', messages: request().messages, tools: request().tools, params: { temperature: 0 } });
    expect('signal' in model.requests[0]!).toBe(false);
  });

  it('throws invalid_response when the script is exhausted', async () => {
    const model = createFakeModel({ script: [] });
    expect(await codeOf(model.complete(request()))).toBe('invalid_response');
    expect(model.requests).toHaveLength(1);
  });

  it('throws a ModelError with the scripted code', async () => {
    const model = createFakeModel({ script: [{ error: { code: 'rate_limit', retryable: true } }, { error: { code: 'server', message: 'boom' } }] });
    try {
      await model.complete(request());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ModelError);
      expect((e as ModelError).code).toBe('rate_limit');
      expect((e as ModelError).retryable).toBe(true);
    }
    try {
      await model.complete(request());
      expect.unreachable();
    } catch (e) {
      expect((e as ModelError).message).toBe('boom');
      expect((e as ModelError).retryable).toBe(false);
    }
  });

  it('yields input undefined for a raw tool call', async () => {
    const model = createFakeModel({ script: [{ rawToolCall: { name: 'echo', raw: '{not json', callId: 'c' } }] });
    const reply = await model.complete(request());
    expect(reply.finish).toBe('tool_calls');
    expect(toolCallsOf(reply.message)).toEqual([{ type: 'toolCall', callId: 'c', name: 'echo', input: undefined, raw: '{not json' }]);
  });

  it('throws aborted when the signal is already aborted', async () => {
    const model = createFakeModel({ script: [{ text: 'never' }] });
    const controller = new AbortController();
    controller.abort();
    expect(await codeOf(model.complete(request(controller.signal)))).toBe('aborted');
    expect(model.remaining()).toBe(1);
  });

  it('honors feature and modelId overrides', () => {
    const model = createFakeModel({ script: [], features: { images: true }, modelId: 'x' });
    expect(model.id).toBe('fake:x');
    expect(model.modelId).toBe('x');
    expect(model.features.images).toBe(true);
  });
});
