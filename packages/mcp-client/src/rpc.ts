import type { JsonRpcId, JsonRpcMessage, Transport } from './types.js';

/** A JSON-RPC error the server answered with. */
export class McpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

const METHOD_NOT_FOUND = -32601;

export interface RpcClient {
  /** Asks the server; rejects with an `McpError`, on the timeout, on the signal, or when the connection closes. */
  request(method: string, params: object, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
  notify(method: string, params?: object): Promise<void>;
  /** Why the connection closed; undefined while it is open. */
  readonly closed: string | undefined;
}

/**
 * JSON-RPC over a transport, from the client's side. The server's own requests are few for a client that declares
 * no capability: `ping` is answered, anything else is refused as not found. Notifications go to `notified`.
 */
export async function createRpcClient(transport: Transport, options: { notified?(method: string, params: unknown): void; warn?(message: string): void } = {}): Promise<RpcClient> {
  let next = 1;
  let closedBecause: string | undefined;
  const waiting = new Map<JsonRpcId, { resolve(value: unknown): void; reject(error: Error): void }>();

  const reply = (message: JsonRpcMessage): void => {
    void transport.send(message).catch((error: unknown) => options.warn?.(`reply: ${messageOf(error)}`));
  };

  await transport.start({
    message(message) {
      if (message.method !== undefined) {
        if (message.id === undefined || message.id === null) { options.notified?.(message.method, message.params); return; }
        if (message.method === 'ping') reply({ jsonrpc: '2.0', id: message.id, result: {} });
        else reply({ jsonrpc: '2.0', id: message.id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` } });
        return;
      }
      if (message.id === undefined || message.id === null) return;
      const held = waiting.get(message.id);
      if (held === undefined) return;
      waiting.delete(message.id);
      if (message.error !== undefined) held.reject(new McpError(message.error.code, message.error.message, message.error.data));
      else held.resolve(message.result);
    },
    closed(reason) {
      closedBecause = reason;
      for (const held of waiting.values()) held.reject(new Error(`the server closed: ${reason}`));
      waiting.clear();
    },
  });

  return {
    get closed() { return closedBecause; },
    request(method, params, { signal, timeoutMs } = {}) {
      if (closedBecause !== undefined) return Promise.reject(new Error(`the server closed: ${closedBecause}`));
      if (signal?.aborted) return Promise.reject(abortError(signal));
      const id = next++;
      return new Promise<unknown>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          waiting.delete(id);
        };
        const cancel = (reason: string): void => {
          void transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason } }).catch(() => {});
        };
        function onAbort(): void {
          done();
          cancel('aborted');
          reject(abortError(signal!));
        }
        waiting.set(id, {
          resolve: (value) => { done(); resolve(value); },
          reject: (error) => { done(); reject(error); },
        });
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            done();
            cancel('timed out');
            reject(new Error(`${method} took longer than ${Math.round(timeoutMs / 1000)} s`));
          }, timeoutMs);
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        transport.send({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
          if (!waiting.has(id)) return;
          done();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    notify(method, params) {
      return transport.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
    },
  };
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason as unknown;
  return reason instanceof Error ? reason : Object.assign(new Error('aborted'), { name: 'AbortError' });
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
