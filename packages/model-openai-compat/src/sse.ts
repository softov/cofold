import type { SseEvent } from './types/sse.js';

/**
 * Server-sent events per the WHATWG spec, without a dependency (parent decision 6): `data:` lines of one event are
 * joined with '\n', `event:` is kept, comment lines (`:`) and unknown fields are skipped, `\r\n`, `\n` and `\r` all end
 * a line, and an event is dispatched at the first empty line. A trailing event without a blank line is dispatched
 * when the body ends. The reader is released on return, whether the stream ended or the consumer stopped early.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let event: string | undefined;

  function* dispatch(): Iterable<SseEvent> {
    if (data.length === 0) { event = undefined; return; }
    const out: SseEvent = { data: data.join('\n'), ...(event !== undefined ? { event } : {}) };
    data = [];
    event = undefined;
    yield out;
  }

  function* consume(chunk: string, last: boolean): Iterable<SseEvent> {
    buffer += chunk;
    for (;;) {
      const match = /\r\n|\n|\r/.exec(buffer);
      // A lone '\r' at the end may be the first half of '\r\n'; wait for the next read unless the body is over.
      if (!match || (!last && match[0] === '\r' && match.index === buffer.length - 1)) break;
      const line = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (line === '') { yield* dispatch(); continue; }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
    }
  }

  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield* consume(decoder.decode(value, { stream: true }), false);
    }
    ended = true;
    yield* consume(decoder.decode(), true);
    if (buffer !== '') yield* consume('\n', true);
    yield* dispatch();
  } finally {
    // A consumer that stops early leaves the connection open; cancelling the body closes it.
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
