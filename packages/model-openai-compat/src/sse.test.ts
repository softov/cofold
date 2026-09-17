import type { SseEvent } from './types/sse.js';
import { describe, expect, it } from 'vitest';
import { parseSse } from './sse.js';

/** A body delivered in the given reads, so a test controls where the chunk boundaries fall. */
function body(reads: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const read of reads) controller.enqueue(encoder.encode(read));
      controller.close();
    },
  });
}

async function collect(reads: string[]): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const event of parseSse(body(reads))) out.push(event);
  return out;
}

describe('parseSse', () => {
  it('dispatches one event per blank line and strips the single space after the colon', async () => {
    expect(await collect(['data: one\n\ndata: two\n\n'])).toEqual([{ data: 'one' }, { data: 'two' }]);
    expect(await collect(['data:no-space\n\n'])).toEqual([{ data: 'no-space' }]);
    expect(await collect(['data:  two-spaces\n\n'])).toEqual([{ data: ' two-spaces' }]);
  });

  it('joins several data lines of one event with a newline and keeps the event name', async () => {
    expect(await collect(['event: message\ndata: {"a":\ndata: 1}\n\n'])).toEqual([{ event: 'message', data: '{"a":\n1}' }]);
  });

  it('skips comments, unknown fields and events without data', async () => {
    expect(await collect([': keep-alive\n\nid: 7\nretry: 100\ndata: x\n\nevent: ping\n\n'])).toEqual([{ data: 'x' }]);
  });

  it('accepts CRLF and CR line ends, including a CRLF split across two reads', async () => {
    expect(await collect(['data: a\r\n\r\ndata: b\r\r'])).toEqual([{ data: 'a' }, { data: 'b' }]);
    expect(await collect(['data: a\r', '\n\r\ndata: b\r\n\r\n'])).toEqual([{ data: 'a' }, { data: 'b' }]);
  });

  it('reassembles an event split across reads, mid-line and mid-character', async () => {
    const reads = ['da', 'ta: hel', 'lo\n', '\nda', 'ta: caf', 'é\n\n'];
    // Split the two-byte é between reads.
    const encoder = new TextEncoder();
    const bytes = encoder.encode(reads.join(''));
    const cut = bytes.length - 3;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const out: SseEvent[] = [];
    for await (const event of parseSse(stream)) out.push(event);
    expect(out).toEqual([{ data: 'hello' }, { data: 'café' }]);
  });

  it('dispatches a trailing event that the body ends without a blank line, and yields [DONE] like any data', async () => {
    expect(await collect(['data: {"x":1}\n\ndata: [DONE]'])).toEqual([{ data: '{"x":1}' }, { data: '[DONE]' }]);
    expect(await collect(['data: last\n'])).toEqual([{ data: 'last' }]);
  });

  it('releases the reader when the consumer stops early and cancels the body', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'));
      },
      cancel() { cancelled = true; },
    });
    for await (const event of parseSse(stream)) {
      expect(event).toEqual({ data: '1' });
      break;
    }
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it('propagates a reader error', async () => {
    // Erroring a stream drops what is still queued, so the error comes on the read after the data.
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
        else controller.error(new Error('connection reset'));
      },
    });
    const out: SseEvent[] = [];
    await expect((async () => { for await (const event of parseSse(stream)) out.push(event); })()).rejects.toThrow('connection reset');
    expect(out).toEqual([{ data: '1' }]);
  });
});
