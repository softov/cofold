import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';
import type { RpcId } from '../types/acp.js';

/**
 * JSON-RPC 2.0, one message per line, both ways: what ACP runs on.
 *
 * The framing and the error codes are `@cofold/mcp/stdio`'s. That loop only answers; ACP also asks
 * the client (a permission, a form), so this peer sends requests of its own and matches the answers
 * by id.
 */

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
/** ACP's code for a session or a file that is not there. */
export const RESOURCE_NOT_FOUND = -32002;

/** A failure with the code it is answered with. */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/** `id` is the request's own, for an answer tied to it, such as a form asked while the request is open. */
export type RequestHandler = (params: Record<string, unknown>, id: RpcId) => unknown;
export type NotificationHandler = (params: Record<string, unknown>) => void;

export interface Peer {
  /** Answers `method` with what the handler returns or throws; a later call replaces the handler. */
  handle(method: string, handler: RequestHandler): void;
  /** Takes `method` as a notification. */
  on(method: string, handler: NotificationHandler): void;
  /** Asks the other side; resolves with its result, rejects with an `RpcError` it sent, or when the stream ends. */
  request(method: string, params: object): Promise<unknown>;
  notify(method: string, params: object): void;
  /** Resolves when the input ends. */
  closed: Promise<void>;
}

interface Incoming {
  jsonrpc?: unknown;
  id?: RpcId | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

export function createPeer(options: { input: Readable; output: Writable; maxMessageBytes?: number; warn?(message: string): void }): Peer {
  const { input, output } = options;
  const limit = options.maxMessageBytes ?? 16 * 1024 * 1024;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`copapo acp: ${message}\n`));
  const requests = new Map<string, RequestHandler>();
  const notifications = new Map<string, NotificationHandler>();
  const asked = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
  const decoder = new StringDecoder('utf8');
  let next = 0;
  let pending = '';
  let ended = false;
  let settle!: () => void;
  const closed = new Promise<void>((resolve) => { settle = resolve; });

  // JSON.stringify escapes newlines inside strings, so one message is one line.
  const send = (message: object): void => { if (!ended) output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`); };
  const fail = (id: RpcId | null, error: RpcError): void => {
    send({ id, error: { code: error.code, message: error.message, ...(error.data !== undefined ? { data: error.data } : {}) } });
  };

  async function answer(id: RpcId, method: string, params: Record<string, unknown>): Promise<void> {
    const handler = requests.get(method);
    if (handler === undefined) { fail(id, new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`)); return; }
    try {
      send({ id, result: (await handler(params, id)) ?? null });
    } catch (error: unknown) {
      if (error instanceof RpcError) { fail(id, error); return; }
      // The message is the answer a person reads in the client; the stack stays here.
      warn(`${method}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      fail(id, new RpcError(INTERNAL_ERROR, error instanceof Error ? error.message : String(error)));
    }
  }

  function receive(line: string): void {
    let message: Incoming;
    try {
      message = JSON.parse(line) as Incoming;
    } catch {
      fail(null, new RpcError(PARSE_ERROR, 'Parse error'));
      return;
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message) || message.jsonrpc !== '2.0') {
      fail(null, new RpcError(INVALID_REQUEST, 'Invalid request'));
      return;
    }
    const params = (typeof message.params === 'object' && message.params !== null && !Array.isArray(message.params) ? message.params : {}) as Record<string, unknown>;
    if (typeof message.method === 'string') {
      if (message.id === undefined || message.id === null) {
        const handler = notifications.get(message.method);
        try { handler?.(params); } catch (error: unknown) { warn(`${message.method}: ${error instanceof Error ? error.message : String(error)}`); }
        return;
      }
      void answer(message.id, message.method, params);
      return;
    }
    // An answer to one of ours.
    if (message.id === undefined || message.id === null) return;
    const waiting = asked.get(String(message.id));
    if (waiting === undefined) return;
    asked.delete(String(message.id));
    if (message.error !== undefined) {
      const { code, message: text, data } = message.error;
      waiting.reject(new RpcError(typeof code === 'number' ? code : INTERNAL_ERROR, typeof text === 'string' ? text : 'the client refused', data));
    } else {
      waiting.resolve(message.result);
    }
  }

  input.on('data', (chunk: Buffer | string) => {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      const line = pending.slice(0, at).trim();
      pending = pending.slice(at + 1);
      if (line !== '') receive(line);
    }
    if (Buffer.byteLength(pending) > limit) {
      pending = '';
      fail(null, new RpcError(INVALID_REQUEST, `A message is larger than ${limit} bytes`));
    }
  });
  const end = (): void => {
    if (ended) return;
    const last = (pending + decoder.end()).trim();
    pending = '';
    if (last !== '') receive(last);
    ended = true;
    for (const waiting of asked.values()) waiting.reject(new RpcError(INTERNAL_ERROR, 'the client went away'));
    asked.clear();
    settle();
  };
  input.on('end', end);
  input.on('close', end);

  return {
    handle: (method, handler) => { requests.set(method, handler); },
    on: (method, handler) => { notifications.set(method, handler); },
    request(method, params) {
      if (ended) return Promise.reject(new RpcError(INTERNAL_ERROR, 'the client went away'));
      const id = next++;
      return new Promise((resolve, reject) => {
        asked.set(String(id), { resolve, reject });
        send({ id, method, params });
      });
    },
    notify: (method, params) => { send({ method, params }); },
    closed,
  };
}
