import type { WireChunk } from './types/wire.js';
import type { SseEvent } from './types/sse.js';
import { ModelError, newId } from '@facio/agents';
import type { ContentPart, Message, ModelStreamEvent } from '@facio/agents';
import { mapFinish, usageOf } from './wire.js';

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/** `data:` payloads → chunks; `[DONE]` ends the stream; a payload that is not JSON is the provider's error. */
export async function* parseChunks(events: AsyncIterable<SseEvent>): AsyncIterable<WireChunk> {
  for await (const event of events) {
    if (event.data === '[DONE]') return;
    try { yield JSON.parse(event.data) as WireChunk; }
    catch (e) { throw new ModelError({ code: 'invalid_response', message: `stream chunk is not JSON: ${event.data.slice(0, 200)}`, cause: e }); }
  }
}

/**
 * Chunks → events. Text goes out as it arrives (after the leading `<think>` split); reasoning fields go out as
 * `reasoning.delta`; every tool-call fragment goes out as received and accumulates by `index`, so the tool calls
 * appear whole only in `done` (decision 105). `done.reply` follows `fromWireResponse`'s rules: parts in the order
 * reasoning, text, tool calls; `input` parsed from the accumulated arguments (`undefined` when not JSON); `finish`
 * from the choice's `finish_reason`; `usage` from the chunk that carries it, zeros when none does; `raw` is the
 * list of chunks. A stream that ends without a `finish_reason` still yields `done`; a cut connection throws from
 * the reader before that and no `done` is yielded.
 */
export async function* streamChunks(chunks: AsyncIterable<WireChunk>): AsyncIterable<ModelStreamEvent> {
  const raw: WireChunk[] = [];
  const splitter = createThinkSplitter();
  let reasoning = '';
  let text = '';
  let finishReason: string | null | undefined;
  let usage: WireChunk['usage'];
  const calls = new Map<number, { id?: string; name?: string; arguments: string }>();

  for await (const chunk of chunks) {
    raw.push(chunk);
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) continue;

    const field = delta.reasoning ?? delta.reasoning_content;
    if (field) {
      // A provider that reports reasoning apart never inlines it: the splitter stands down for this reply.
      splitter.disable();
      reasoning += field;
      yield { type: 'reasoning.delta', text: field };
    }
    if (delta.content) {
      for (const piece of splitter.push(delta.content)) {
        if (piece.kind === 'reasoning') reasoning += piece.text;
        else text += piece.text;
        yield piece.kind === 'reasoning' ? { type: 'reasoning.delta', text: piece.text } : { type: 'text.delta', text: piece.text };
      }
    }
    for (const fragment of delta.tool_calls ?? []) {
      const args = fragment.function?.arguments ?? '';
      const call = calls.get(fragment.index) ?? { arguments: '' };
      if (fragment.id && call.id === undefined) call.id = fragment.id;
      if (fragment.function?.name && call.name === undefined) call.name = fragment.function.name;
      call.arguments += args;
      calls.set(fragment.index, call);
      yield {
        type: 'toolCall.delta',
        index: fragment.index,
        ...(fragment.id ? { callId: fragment.id } : {}),
        ...(fragment.function?.name ? { name: fragment.function.name } : {}),
        arguments: args,
      };
    }
  }

  for (const piece of splitter.flush()) {
    if (piece.kind === 'reasoning') reasoning += piece.text;
    else text += piece.text;
    yield piece.kind === 'reasoning' ? { type: 'reasoning.delta', text: piece.text } : { type: 'text.delta', text: piece.text };
  }

  const parts: ContentPart[] = [];
  if (reasoning) parts.push({ type: 'reasoning', text: reasoning });
  if (text) parts.push({ type: 'text', text });
  for (const [, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    let input: unknown;
    try { input = JSON.parse(call.arguments || '{}'); } catch { input = undefined; }
    parts.push({ type: 'toolCall', callId: call.id || newId(), name: call.name ?? '', input, raw: call.arguments });
  }
  const message: Message = { id: newId(), role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts };
  yield { type: 'done', reply: { message, usage: usageOf(usage), finish: mapFinish(finishReason, calls.size > 0), raw } };
}

type Piece = { kind: 'text' | 'reasoning'; text: string };

/**
 * The streamed form of `fromWireResponse`'s `THINK_BLOCK` rule: while nothing but whitespace has arrived, a leading
 * `<think>` switches the content to reasoning until `</think>`, and the whitespace after it is dropped. It buffers
 * only what it needs to decide: the leading whitespace plus at most the bytes of `<think>` (or `</think>` while
 * inside the block). Once the first non-matching byte arrives, or a reasoning field was seen, everything is text.
 * An unterminated `<think>` stays reasoning, where the whole-response form would have kept it as text.
 */
function createThinkSplitter(): { push(content: string): Piece[]; flush(): Piece[]; disable(): void } {
  let phase: 'start' | 'reasoning' | 'afterThink' | 'text' = 'start';
  let pending = '';

  function take(content: string): Piece[] {
    const out: Piece[] = [];
    let rest = content;
    while (rest !== '') {
      if (phase === 'text') {
        // `pending` is what `disable()` left undecided; it was never a think block, so it is text.
        out.push({ kind: 'text', text: pending + rest });
        pending = '';
        return out;
      }
      if (phase === 'afterThink') {
        const trimmed = rest.replace(/^\s+/, '');
        if (trimmed === '') return out;
        phase = 'text';
        rest = trimmed;
        continue;
      }
      if (phase === 'start') {
        pending += rest;
        rest = '';
        const lead = pending.replace(/^\s+/, '');
        if (lead.startsWith(THINK_OPEN)) {
          phase = 'reasoning';
          rest = lead.slice(THINK_OPEN.length);
          pending = '';
          continue;
        }
        if (THINK_OPEN.startsWith(lead)) return out; // still deciding (`<thi`, or only whitespace so far)
        phase = 'text';
        rest = pending;
        pending = '';
        continue;
      }
      // reasoning: emit everything but a trailing prefix of `</think>`
      pending += rest;
      rest = '';
      const close = pending.indexOf(THINK_CLOSE);
      if (close >= 0) {
        if (close > 0) out.push({ kind: 'reasoning', text: pending.slice(0, close) });
        rest = pending.slice(close + THINK_CLOSE.length);
        pending = '';
        phase = 'afterThink';
        continue;
      }
      const hold = partialSuffix(pending, THINK_CLOSE);
      const emit = pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      if (emit !== '') out.push({ kind: 'reasoning', text: emit });
    }
    return out;
  }

  return {
    push: take,
    flush() {
      if (pending === '') return [];
      const out: Piece[] = [{ kind: phase === 'reasoning' ? 'reasoning' : 'text', text: pending }];
      pending = '';
      phase = 'text';
      return out;
    },
    disable() {
      if (phase !== 'start') return;
      phase = 'text';
    },
  };
}

/** Length of the longest suffix of `s` that is a proper prefix of `marker`. */
function partialSuffix(s: string, marker: string): number {
  for (let n = Math.min(s.length, marker.length - 1); n > 0; n -= 1) {
    if (s.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}
