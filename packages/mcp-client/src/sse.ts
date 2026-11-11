/**
 * The `data` of each event in a `text/event-stream` body, as the events end. A multi-line `data` is joined with
 * newlines; comments, `event`, `id` and `retry` lines are read and dropped.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (let at = pending.search(/\r?\n/); at >= 0; at = pending.search(/\r?\n/)) {
        const line = pending.slice(0, at);
        pending = pending.slice(pending[at] === '\r' ? at + 2 : at + 1);
        if (line === '') {
          if (data.length > 0) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(line[5] === ' ' ? 6 : 5));
        }
      }
      if (done) break;
    }
    // A last line with no newline after it still counts.
    if (pending.startsWith('data:')) data.push(pending.slice(pending[5] === ' ' ? 6 : 5));
    if (data.length > 0) yield data.join('\n');
  } finally {
    reader.releaseLock();
  }
}
