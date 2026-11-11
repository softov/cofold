import { createHttpTransport } from './http.js';
import { createRpcClient, messageOf } from './rpc.js';
import { createStdioTransport } from './stdio.js';
import type { McpCallResult, McpClientInfo, McpServerConfig, McpToolInfo, Transport } from './types.js';

/** The versions this client speaks, newest first; `initialize` asks for the first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** One server, initialized, with its tools listed. */
export interface McpConnection {
  readonly name: string;
  readonly serverInfo: { name?: string; version?: string };
  /** What the server says about itself at `initialize`, when it says anything. */
  readonly instructions: string | undefined;
  /** The tools as last listed; a `list_changed` lists them again. */
  tools(): McpToolInfo[];
  call(tool: string, input: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<McpCallResult>;
  /** Why the connection closed; undefined while it is open. */
  readonly closed: string | undefined;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** The server's name, as the configuration keys it. */
  name: string;
  server: McpServerConfig;
  clientInfo: McpClientInfo;
  /** How long `initialize` and the first listing may take. */
  timeoutMs?: number;
  warn?(message: string): void;
  /** For a test: the transport to use instead of the configured one. */
  transport?: Transport;
  fetch?: typeof fetch;
}

/**
 * Connects to one server: starts its transport, agrees a protocol version, says `initialized`, and lists its tools
 * page by page. A version outside `PROTOCOL_VERSIONS` fails the connection rather than being spoken half-way.
 */
export async function connectMcp(options: ConnectOptions): Promise<McpConnection> {
  const { server, name } = options;
  const warn = (message: string): void => options.warn?.(`${name}: ${message}`);
  const transport = options.transport ?? (server.type === 'http'
    ? createHttpTransport(server, options.fetch !== undefined ? { fetch: options.fetch } : {})
    : createStdioTransport(server, { warn }));
  let tools: McpToolInfo[] = [];
  let listing: Promise<void> | undefined;
  const rpc = await createRpcClient(transport, {
    warn,
    notified(method) {
      if (method !== 'notifications/tools/list_changed') return;
      listing = listAll().catch((error: unknown) => warn(`the tools could not be listed again: ${messageOf(error)}`));
    },
  });
  const timeout = options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {};

  async function listAll(): Promise<void> {
    const all: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = (await rpc.request('tools/list', cursor !== undefined ? { cursor } : {}, timeout)) as { tools?: McpToolInfo[]; nextCursor?: string } | null;
      all.push(...(page?.tools ?? []));
      cursor = typeof page?.nextCursor === 'string' && page.nextCursor !== '' ? page.nextCursor : undefined;
    } while (cursor !== undefined);
    tools = all;
  }

  try {
    const answer = (await rpc.request('initialize', { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: options.clientInfo }, timeout)) as {
      protocolVersion?: string; serverInfo?: { name?: string; version?: string }; instructions?: string; capabilities?: { tools?: unknown };
    } | null;
    const version = answer?.protocolVersion;
    if (typeof version !== 'string' || !PROTOCOL_VERSIONS.includes(version)) {
      throw new Error(`the server speaks MCP ${String(version)}, which this client does not`);
    }
    transport.agreed?.(version);
    await rpc.notify('notifications/initialized');
    if (answer?.capabilities?.tools !== undefined) await listAll();
    return {
      name,
      serverInfo: answer?.serverInfo ?? {},
      instructions: typeof answer?.instructions === 'string' && answer.instructions.trim() !== '' ? answer.instructions : undefined,
      tools: () => tools,
      async call(tool, input, callOptions = {}) {
        await listing;
        return (await rpc.request('tools/call', { name: tool, arguments: input ?? {} }, callOptions)) as McpCallResult;
      },
      get closed() { return rpc.closed; },
      close: () => transport.close(),
    };
  } catch (error: unknown) {
    await transport.close().catch(() => {});
    const log = 'stderr' in transport && typeof transport.stderr === 'function' ? (transport.stderr as () => string)() : '';
    const tail = log.split('\n').filter((line) => line.trim() !== '').slice(-3).join(' / ');
    throw new Error(`${messageOf(error)}${tail !== '' && !messageOf(error).includes(tail) ? ` (${tail})` : ''}`);
  }
}
