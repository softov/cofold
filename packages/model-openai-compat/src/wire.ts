import { newId } from '@facio/agents';
import type { ContentPart, FinishReason, ImagePart, Message, ModelReply, ModelRequest, TextPart, ToolCallPart } from '@facio/agents';

type WireTextPart = { type: 'text'; text: string };
type WireImagePart = { type: 'image_url'; image_url: { url: string } };

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | (WireTextPart | WireImagePart)[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

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

export interface WireResponse {
  choices?: { message?: WireMessage; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export function fromWireResponse(body: WireResponse): ModelReply {
  const choice = body.choices?.[0];
  if (!choice?.message) throw new Error('response has no choices[0].message');
  const parts: ContentPart[] = [];
  const content = choice.message.content;
  if (typeof content === 'string' && content) parts.push({ type: 'text', text: content });
  for (const call of choice.message.tool_calls ?? []) {
    let input: unknown;
    try { input = JSON.parse(call.function.arguments || '{}'); } catch { input = undefined; }
    parts.push({ type: 'toolCall', callId: call.id || newId(), name: call.function.name, input, raw: call.function.arguments ?? '' });
  }
  const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts };
  const finish = mapFinish(choice.finish_reason, parts.some((p) => p.type === 'toolCall'));
  return {
    message,
    usage: {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      ...(body.usage?.prompt_tokens_details?.cached_tokens !== undefined ? { cacheReadTokens: body.usage.prompt_tokens_details.cached_tokens } : {}),
    },
    finish,
    raw: body,
  };
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
