import type { Message } from '../types/message.js';
import type { ModelFeatures, ModelPricing, ModelReply, ModelRequest, ModelStreamEvent, Usage } from '../types/model.js';
import type { FakeModel, FakeStep } from '../types/testing.js';
import { ModelError } from '../errors.js';
import { newId } from '../ids.js';

const usage0: Usage = { inputTokens: 1, outputTokens: 1 };

/** A step that produces a reply; an `error` step throws before one is built. */
type ReplyStep = Exclude<FakeStep, { error: unknown }>;

/**
 * A scripted adapter. With `stream: true` it has `stream()` and `features.streaming` (decision 104): a text step
 * yields its reasoning (one delta) and its text per chunk, then `done` with the reply `complete()` would build;
 * a tool step yields only `done`; `interrupt: true` ends the stream after the chunks without `done`.
 */
export function createFakeModel(options: { script: FakeStep[]; features?: Partial<ModelFeatures>; modelId?: string; stream?: boolean; pricing?: ModelPricing }): FakeModel {
  const script = [...options.script];
  const requests: Omit<ModelRequest, 'signal'>[] = [];
  const streaming = options.stream === true;

  /** Records the request and takes the next step; what both `complete` and `stream` start with. */
  function take(request: ModelRequest): ReplyStep {
    const { signal: _s, ...rest } = request;
    requests.push(structuredClone(rest));
    if (request.signal.aborted) throw new ModelError({ code: 'aborted', message: 'aborted before fake reply' });
    const step = script.shift();
    if (!step) throw new ModelError({ code: 'invalid_response', message: 'fake model script exhausted' });
    if ('error' in step) {
      throw new ModelError({ code: step.error.code, message: step.error.message ?? step.error.code, retryable: step.error.retryable ?? false });
    }
    return step;
  }

  const model: FakeModel = {
    id: `fake:${options.modelId ?? 'fake'}`,
    modelId: options.modelId ?? 'fake',
    features: { tools: true, streaming, images: false, structuredOutput: false, reasoning: false, ...options.features },
    ...(options.pricing !== undefined ? { pricing: options.pricing } : {}),
    requests,
    remaining: () => script.length,
    async complete(request) {
      return replyOf(take(request));
    },
  };
  if (streaming) {
    model.stream = async function* (request): AsyncIterable<ModelStreamEvent> {
      const step = take(request);
      if ('text' in step && !('toolCalls' in step) && !('rawToolCall' in step)) {
        if (step.reasoning) yield { type: 'reasoning.delta', text: step.reasoning };
        for (const chunk of step.chunks ?? wordChunks(step.text)) yield { type: 'text.delta', text: chunk };
        if (step.interrupt) return;
      }
      yield { type: 'done', reply: replyOf(step) };
    };
  }
  return model;
}

function replyOf(step: ReplyStep): ModelReply {
  const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts: [] };
  if ('rawToolCall' in step) {
    message.parts.push({ type: 'toolCall', callId: step.rawToolCall.callId ?? newId(), name: step.rawToolCall.name, input: undefined, raw: step.rawToolCall.raw });
    return { message, usage: usage0, finish: 'tool_calls' };
  }
  if (step.reasoning) message.parts.push({ type: 'reasoning', text: step.reasoning });
  if (step.text) message.parts.push({ type: 'text', text: step.text });
  if ('toolCalls' in step) {
    for (const c of step.toolCalls) {
      message.parts.push({ type: 'toolCall', callId: c.callId ?? newId(), name: c.name, input: c.input, raw: JSON.stringify(c.input) });
    }
    return { message, usage: step.usage ?? usage0, finish: 'tool_calls' };
  }
  return { message, usage: step.usage ?? usage0, finish: 'stop' };
}

/** One chunk per word, the following space attached, so the chunks join back into the text. */
function wordChunks(text: string): string[] {
  const chunks = text.match(/\S+\s*|\s+/g);
  return chunks ?? [];
}
