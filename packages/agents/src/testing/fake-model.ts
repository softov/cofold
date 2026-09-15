import type { Message } from '../types/message.js';
import type { ModelFeatures, ModelReply, ModelRequest, Usage } from '../types/model.js';
import type { FakeModel, FakeStep } from '../types/testing.js';
import { ModelError } from '../errors.js';
import { newId } from '../ids.js';

export function createFakeModel(options: { script: FakeStep[]; features?: Partial<ModelFeatures>; modelId?: string }): FakeModel {
  const script = [...options.script];
  const requests: Omit<ModelRequest, 'signal'>[] = [];
  const usage0: Usage = { inputTokens: 1, outputTokens: 1 };
  return {
    id: `fake:${options.modelId ?? 'fake'}`,
    modelId: options.modelId ?? 'fake',
    features: { tools: true, streaming: false, images: false, structuredOutput: false, reasoning: false, ...options.features },
    requests,
    remaining: () => script.length,
    async complete(request) {
      const { signal: _s, ...rest } = request;
      requests.push(structuredClone(rest));
      if (request.signal.aborted) throw new ModelError({ code: 'aborted', message: 'aborted before fake reply' });
      const step = script.shift();
      if (!step) throw new ModelError({ code: 'invalid_response', message: 'fake model script exhausted' });
      if ('error' in step) {
        throw new ModelError({ code: step.error.code, message: step.error.message ?? step.error.code, retryable: step.error.retryable ?? false });
      }
      const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts: [] };
      if ('rawToolCall' in step) {
        message.parts.push({ type: 'toolCall', callId: step.rawToolCall.callId ?? newId(), name: step.rawToolCall.name, input: undefined, raw: step.rawToolCall.raw });
        return { message, usage: usage0, finish: 'tool_calls' } satisfies ModelReply;
      }
      if (step.text) message.parts.push({ type: 'text', text: step.text });
      if ('toolCalls' in step) {
        for (const c of step.toolCalls) {
          message.parts.push({ type: 'toolCall', callId: c.callId ?? newId(), name: c.name, input: c.input, raw: JSON.stringify(c.input) });
        }
        return { message, usage: step.usage ?? usage0, finish: 'tool_calls' };
      }
      return { message, usage: step.usage ?? usage0, finish: 'stop' };
    },
  };
}
