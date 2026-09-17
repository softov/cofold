import type { WireChunk } from './types/wire.js';
import { describe, expect, it } from 'vitest';
import { ModelError } from '@facio/agents';
import type { ModelStreamEvent } from '@facio/agents';
import { parseChunks, streamChunks } from './stream.js';

async function* iterate<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect(chunks: WireChunk[]): Promise<ModelStreamEvent[]> {
  const out: ModelStreamEvent[] = [];
  for await (const event of streamChunks(iterate(chunks))) out.push(event);
  return out;
}

const content = (text: string, finish_reason: string | null = null): WireChunk => ({ choices: [{ delta: { content: text }, finish_reason }] });
const doneOf = (events: ModelStreamEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== 'done') throw new Error(`last event is ${last?.type}`);
  return last.reply;
};

describe('streamChunks', () => {
  it('yields text as it arrives and a done with the whole text, finish and usage from the last chunk', async () => {
    const chunks: WireChunk[] = [
      { choices: [{ delta: { content: 'Hel' }, finish_reason: null }] },
      content('lo, '),
      content('world', 'stop'),
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } },
    ];
    const events = await collect(chunks);
    expect(events.slice(0, 3)).toEqual([{ type: 'text.delta', text: 'Hel' }, { type: 'text.delta', text: 'lo, ' }, { type: 'text.delta', text: 'world' }]);
    const reply = doneOf(events);
    expect(reply.message.parts).toEqual([{ type: 'text', text: 'Hello, world' }]);
    expect(reply.message).toMatchObject({ role: 'assistant', source: 'model' });
    expect(reply.finish).toBe('stop');
    expect(reply.usage).toEqual({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 4 });
    expect(reply.raw).toEqual(chunks);
  });

  it('assembles a tool call whose arguments span four chunks, with id and name only on the first, and yields every fragment', async () => {
    const chunks: WireChunk[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'now', arguments: '' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"tz"' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"ut' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'c"}' } }] }, finish_reason: 'tool_calls' }] },
    ];
    const events = await collect(chunks);
    expect(events.slice(0, 4)).toEqual([
      { type: 'toolCall.delta', index: 0, callId: 'call_1', name: 'now', arguments: '' },
      { type: 'toolCall.delta', index: 0, arguments: '{"tz"' },
      { type: 'toolCall.delta', index: 0, arguments: ':"ut' },
      { type: 'toolCall.delta', index: 0, arguments: 'c"}' },
    ]);
    const reply = doneOf(events);
    expect(reply.message.parts).toEqual([{ type: 'toolCall', callId: 'call_1', name: 'now', input: { tz: 'utc' }, raw: '{"tz":"utc"}' }]);
    expect(reply.finish).toBe('tool_calls');
    expect(reply.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('keeps two parallel tool calls apart by index and orders them by index in done', async () => {
    const chunks: WireChunk[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'first', arguments: '{"n":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'second', arguments: '{"m":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '2}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] },
    ];
    const reply = doneOf(await collect(chunks));
    expect(reply.message.parts).toEqual([
      { type: 'toolCall', callId: 'a', name: 'first', input: { n: 1 }, raw: '{"n":1}' },
      { type: 'toolCall', callId: 'b', name: 'second', input: { m: 2 }, raw: '{"m":2}' },
    ]);
  });

  it('leaves input undefined for arguments that are not JSON and mints a callId when the provider sent none', async () => {
    const chunks: WireChunk[] = [
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'now', arguments: '{not' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ' json' } }] }, finish_reason: 'stop' }] },
    ];
    const reply = doneOf(await collect(chunks));
    expect(reply.message.parts[0]).toMatchObject({ type: 'toolCall', name: 'now', input: undefined, raw: '{not json' });
    expect((reply.message.parts[0] as { callId: string }).callId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reply.finish).toBe('tool_calls');
  });

  it('yields reasoning_content deltas as reasoning, then text, and puts the reasoning part first', async () => {
    const chunks: WireChunk[] = [
      { choices: [{ delta: { reasoning_content: 'let me ' } }] },
      { choices: [{ delta: { reasoning_content: 'see' } }] },
      { choices: [{ delta: { content: '<think>not a block' } }] },
      { choices: [{ delta: { content: ' either' }, finish_reason: 'stop' }] },
    ];
    const events = await collect(chunks);
    expect(events.slice(0, 4)).toEqual([
      { type: 'reasoning.delta', text: 'let me ' },
      { type: 'reasoning.delta', text: 'see' },
      { type: 'text.delta', text: '<think>not a block' },
      { type: 'text.delta', text: ' either' },
    ]);
    expect(doneOf(events).message.parts).toEqual([{ type: 'reasoning', text: 'let me see' }, { type: 'text', text: '<think>not a block either' }]);
  });

  it('maps OpenRouter reasoning the same way', async () => {
    const events = await collect([{ choices: [{ delta: { reasoning: 'because' } }] }, content('answer', 'stop')]);
    expect(events.map((e) => e.type)).toEqual(['reasoning.delta', 'text.delta', 'done']);
    expect(doneOf(events).message.parts).toEqual([{ type: 'reasoning', text: 'because' }, { type: 'text', text: 'answer' }]);
  });

  it('splits an inline <think> block at chunk boundaries, including <thi + nk> and </thi + nk>, dropping the whitespace after it', async () => {
    const chunks = ['\n<thi', 'nk>\nlet me', ' see\n</thi', 'nk>\n\nfin', 'al'].map((t) => content(t));
    chunks.push(content('', 'stop'));
    const events = await collect(chunks);
    expect(events.slice(0, -1)).toEqual([
      { type: 'reasoning.delta', text: '\nlet me' },
      { type: 'reasoning.delta', text: ' see\n' },
      { type: 'text.delta', text: 'fin' },
      { type: 'text.delta', text: 'al' },
    ]);
    // The same result as fromWireResponse's THINK_BLOCK on the whole content.
    expect(doneOf(events).message.parts).toEqual([{ type: 'reasoning', text: '\nlet me see\n' }, { type: 'text', text: 'final' }]);
  });

  it('handles a <think> block that opens and closes in one chunk and text that merely starts with <', async () => {
    const one = await collect([content('<think>a</think>b', 'stop')]);
    expect(one.slice(0, -1)).toEqual([{ type: 'reasoning.delta', text: 'a' }, { type: 'text.delta', text: 'b' }]);
    const tag = await collect([content('<th'), content('ead>x', 'stop')]);
    expect(tag.slice(0, -1)).toEqual([{ type: 'text.delta', text: '<thead>x' }]);
    expect(doneOf(tag).message.parts).toEqual([{ type: 'text', text: '<thead>x' }]);
  });

  it('flushes what was still undecided at the end as text', async () => {
    const events = await collect([content('  '), content('<thi', 'stop')]);
    expect(events).toEqual([{ type: 'text.delta', text: '  <thi' }, expect.objectContaining({ type: 'done' })]);
    expect(doneOf(events).message.parts).toEqual([{ type: 'text', text: '  <thi' }]);
  });

  it('yields done with finish other when the stream ends without a finish_reason, and zero usage without a usage chunk', async () => {
    const reply = doneOf(await collect([content('cut')]));
    expect(reply.finish).toBe('other');
    expect(reply.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(reply.message.parts).toEqual([{ type: 'text', text: 'cut' }]);
  });

  it('maps length and reasoning tokens like the whole-response form', async () => {
    const reply = doneOf(await collect([content('x', 'length'), { usage: { prompt_tokens: 1, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 7 } } }]));
    expect(reply.finish).toBe('length');
    expect(reply.usage).toEqual({ inputTokens: 1, outputTokens: 9, reasoningTokens: 7 });
  });
});

describe('parseChunks', () => {
  it('parses each data payload as JSON and stops at [DONE]', async () => {
    const out: WireChunk[] = [];
    for await (const chunk of parseChunks(iterate([{ data: '{"choices":[]}' }, { data: '[DONE]' }, { data: '{"never":1}' }]))) out.push(chunk);
    expect(out).toEqual([{ choices: [] }]);
  });

  it('throws invalid_response for a payload that is not JSON', async () => {
    const run = async () => { for await (const _ of parseChunks(iterate([{ data: '<html>' }]))) { /* nothing */ } };
    await expect(run()).rejects.toBeInstanceOf(ModelError);
    await expect(run()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
