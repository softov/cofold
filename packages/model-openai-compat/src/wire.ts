import type { WireImagePart, WireMessage, WireModel, WireResponse, WireTextPart } from './types/wire.js';
import { newId } from '@facio/agents';
import type { ContentPart, FinishReason, ImagePart, Message, ModelInfo, ModelFeatures, ModelReply, ModelRequest, ReasoningEffort, TextPart, ToolCallPart } from '@facio/agents';

export function toWireMessages(request: ModelRequest, features: { images: boolean }): WireMessage[] {
  const out: WireMessage[] = [{ role: 'system', content: request.instructions }];
  for (const m of request.messages) {
    if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.type === 'toolResult') out.push({ role: 'tool', tool_call_id: p.callId, name: p.name, content: p.content });
      }
      continue;
    }
    if (m.role === 'assistant') {
      // Reasoning parts are never sent back; providers re-derive their own thinking.
      const text = m.parts.filter((p): p is TextPart => p.type === 'text').map((p) => p.text).join('');
      const calls = m.parts.filter((p): p is ToolCallPart => p.type === 'toolCall');
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.callId, type: 'function' as const, function: { name: c.name, arguments: c.raw } })) } : {}),
      });
      continue;
    }
    // user / system messages
    const parts: (WireTextPart | WireImagePart)[] = [];
    for (const p of m.parts) {
      if (p.type === 'text') parts.push({ type: 'text', text: p.text });
      else if (p.type === 'image') {
        if (!features.images) throw new Error('image part not supported by this model'); // wrapped into ModelError by caller
        parts.push({ type: 'image_url', image_url: { url: imageUrl(p) } });
      }
    }
    const only = parts.length === 1 ? parts[0] : undefined;
    out.push({ role: m.role === 'system' ? 'system' : 'user', content: only?.type === 'text' ? only.text : parts });
  }
  return out;
}

function imageUrl(part: ImagePart): string {
  return part.url ?? `data:${part.mimeType};base64,${part.data}`;
}

export function toWireTools(request: ModelRequest) {
  return request.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.input } }));
}

/**
 * `reasoning_effort` is the OpenAI form (OpenRouter accepts it too); only OpenRouter's `reasoning`
 * object carries a token budget, so that form is used as soon as `maxTokens` is set, or when the
 * provider has a budget for the requested effort (decision 98). A level the provider rejects is its error.
 */
export function toWireReasoning(reasoning: NonNullable<ModelRequest['params']['reasoning']>, budgets: Partial<Record<ReasoningEffort, number>> = {}): Record<string, unknown> {
  if (reasoning.maxTokens !== undefined) {
    return { reasoning: { ...(reasoning.effort !== undefined ? { effort: reasoning.effort } : {}), max_tokens: reasoning.maxTokens } };
  }
  const budget = reasoning.effort !== undefined ? budgets[reasoning.effort] : undefined;
  if (budget !== undefined) return { reasoning: { max_tokens: budget } };
  return reasoning.effort !== undefined ? { reasoning_effort: reasoning.effort } : {};
}

const THINK_BLOCK = /^\s*<think>([\s\S]*?)<\/think>\s*/;

export function fromWireResponse(body: WireResponse): ModelReply {
  const choice = body.choices?.[0];
  if (!choice?.message) throw new Error('response has no choices[0].message');
  const parts: ContentPart[] = [];
  let text = contentText(choice.message.content);
  let reasoning = choice.message.reasoning ?? choice.message.reasoning_content ?? '';
  if (!reasoning) {
    // Servers that inline thinking put it first in `content`; move it out so the transcript stays clean.
    const inline = THINK_BLOCK.exec(text);
    if (inline) {
      reasoning = inline[1] ?? '';
      text = text.slice(inline[0].length);
    }
  }
  if (reasoning) parts.push({ type: 'reasoning', text: reasoning });
  if (text) parts.push({ type: 'text', text });
  for (const call of choice.message.tool_calls ?? []) {
    let input: unknown;
    try { input = JSON.parse(call.function.arguments || '{}'); } catch { input = undefined; }
    parts.push({ type: 'toolCall', callId: call.id || newId(), name: call.function.name, input, raw: call.function.arguments ?? '' });
  }
  const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts };
  const finish = mapFinish(choice.finish_reason, parts.some((p) => p.type === 'toolCall'));
  const cached = body.usage?.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = body.usage?.completion_tokens_details?.reasoning_tokens;
  return {
    message,
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      ...(cached !== undefined ? { cacheReadTokens: cached } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    },
    finish,
    raw: body,
  };
}

/** Some compatible servers return `content` as parts; only text parts carry anything for us. */
function contentText(content: WireMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p): p is WireTextPart => p.type === 'text').map((p) => p.text).join('');
  return '';
}

function mapFinish(reason: string | undefined, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls) return 'tool_calls';
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'content_filter': return 'content_filter';
    case 'tool_calls': return 'tool_calls';
    default: return 'other';
  }
}

export function fromWireModel(model: WireModel, defaults: ModelFeatures): ModelInfo {
  const params = model.supported_parameters;
  const features: ModelFeatures = params
    ? {
        tools: params.includes('tools'),
        streaming: defaults.streaming,
        images: model.architecture?.input_modalities?.includes('image') ?? false,
        structuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
        reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
      }
    : defaults;
  const input = Number(model.pricing?.prompt);
  const output = Number(model.pricing?.completion);
  const maxOut = model.top_provider?.max_completion_tokens;
  return {
    id: model.id,
    name: model.name ?? model.id,
    features,
    ...(model.context_length !== undefined ? { contextTokens: model.context_length } : {}),
    ...(typeof maxOut === 'number' ? { maxOutputTokens: maxOut } : {}),
    ...(Number.isFinite(input) && Number.isFinite(output)
      ? { pricing: { inputPerMillion: input * 1e6, outputPerMillion: output * 1e6, currency: 'USD' as const } }
      : {}),
  };
}
