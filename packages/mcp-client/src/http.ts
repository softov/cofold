import { sseData } from './sse.js';
import type { JsonRpcMessage, McpHttpServer, Transport } from './types.js';

/**
 * Streamable HTTP over `fetch`: each message is a POST, and its reply is JSON or an SSE stream of messages, read to
 * its end. The session id from `initialize` and the agreed protocol version go on every later request. The GET
 * stream is not opened, so what the server says unasked arrives inside a POST's stream.
 */
export function createHttpTransport(server: McpHttpServer, options: { fetch?: typeof fetch } = {}): Transport {
  const fetchImpl = options.fetch ?? fetch;
  let deliver: ((message: JsonRpcMessage) => void) | undefined;
  let closedHandler: ((reason: string) => void) | undefined;
  let sessionId: string | undefined;
  let version: string | undefined;
  let closed = false;

  const headers = (extra: Record<string, string>): Record<string, string> => ({
    ...extra,
    ...(sessionId !== undefined ? { 'mcp-session-id': sessionId } : {}),
    ...(version !== undefined ? { 'mcp-protocol-version': version } : {}),
    ...server.headers,
  });

  return {
    async start(handlers) {
      deliver = handlers.message;
      closedHandler = handlers.closed;
    },
    agreed(agreedVersion) { version = agreedVersion; },
    async send(message) {
      if (closed) throw new Error('the connection is closed');
      const response = await fetchImpl(server.url, {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' }),
        body: JSON.stringify(message),
      });
      const given = response.headers.get('mcp-session-id');
      if (given !== null && given !== '') sessionId = given;
      if (response.status === 404 && sessionId !== undefined) {
        // The server forgot the session: this connection is over, and the next turn connects again.
        closed = true;
        closedHandler?.('the server ended the session');
        throw new Error('the server ended the session');
      }
      if (!response.ok && response.status !== 202) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${text !== '' ? `: ${text.slice(0, 200)}` : ''}`);
      }
      if (response.body === null || response.status === 202) return;
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream')) {
        for await (const data of sseData(response.body)) {
          if (data.trim() === '') continue;
          each(JSON.parse(data) as unknown, deliver);
        }
        return;
      }
      const text = await response.text();
      if (text.trim() !== '') each(JSON.parse(text) as unknown, deliver);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (sessionId === undefined) return;
      await fetchImpl(server.url, { method: 'DELETE', headers: headers({}) }).catch(() => undefined);
    },
  };
}

/** One message, or each of a batch. */
function each(body: unknown, deliver: ((message: JsonRpcMessage) => void) | undefined): void {
  for (const message of Array.isArray(body) ? body : [body]) deliver?.(message as JsonRpcMessage);
}
