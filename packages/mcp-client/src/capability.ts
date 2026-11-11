import type { Capability, Tool } from '@cofold/agents';
import { createTool } from '@cofold/agents';
import { connectMcp } from './connect.js';
import type { ConnectOptions, McpConnection } from './connect.js';
import { effectsOf } from './effects.js';
import { expandServer } from './expand.js';
import { inputSchemaOf } from './input-schema.js';
import { toolNameOf } from './names.js';
import { outputOf } from './output.js';
import { messageOf } from './rpc.js';
import type { McpClientInfo, McpServerConfig } from './types.js';

const STARTUP_SEC = 10;
const TOOL_SEC = 60;

export interface McpClientsOptions {
  /** The servers, by the name their tools are prefixed with. */
  servers: Record<string, McpServerConfig>;
  clientInfo: McpClientInfo;
  /** Where a server that fails, a name that clashes and an unset `${VAR}` are said, each once. */
  warn?(message: string): void;
  /** What `${VAR}` reads; `process.env` by default. */
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** For a test: how a server is connected. */
  connect?(options: ConnectOptions): Promise<McpConnection>;
}

/** One server's state, for a host that shows it. */
export interface McpServerState {
  name: string;
  state: 'connected' | 'failed' | 'disabled' | 'not started';
  tools: number;
  error?: string;
}

export interface McpClients {
  /**
   * The servers' tools for one agent: deferred, named `mcp__<server>__<tool>`, with effects from their hints.
   * `id` is the capability's id, `mcp` by default, for an agent that holds two sets; `without` leaves servers out.
   */
  capability(options?: { id?: string; without?: readonly string[] }): Capability;
  status(): McpServerState[];
  /** Closes every connection; a later `tools()` starts them again. */
  close(): Promise<void>;
}

interface Held {
  server: McpServerConfig;
  connection?: McpConnection | undefined;
  connecting?: Promise<McpConnection | undefined> | undefined;
  error?: string | undefined;
}

/**
 * The connections to a set of servers, held for the life of the process. A server starts at the first `tools()`
 * that needs it and is waited for up to its `startupTimeoutSec`. One that fails is said once, lists no tools, and
 * is tried again at the next `tools()`; one that closes is started again the same way.
 */
export function createMcpClients(options: McpClientsOptions): McpClients {
  const said = new Set<string>();
  const warnOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    options.warn?.(message);
  };
  const connect = options.connect ?? connectMcp;
  const held = new Map<string, Held>(Object.entries(options.servers).map(([name, server]) => [name, { server }]));

  function ensure(name: string, entry: Held): Promise<McpConnection | undefined> {
    if (entry.server.enabled === false) return Promise.resolve(undefined);
    if (entry.connection !== undefined && entry.connection.closed === undefined) return Promise.resolve(entry.connection);
    if (entry.connection !== undefined) {
      warnOnce(`mcp server "${name}" closed: ${entry.connection.closed}`);
      entry.connection = undefined;
    }
    entry.connecting ??= (async () => {
      try {
        const server = expandServer(entry.server, options.env ?? process.env, (variable) => warnOnce(`mcp server "${name}": \${${variable}} is not set`));
        const connection = await connect({
          name,
          server,
          clientInfo: options.clientInfo,
          timeoutMs: (entry.server.startupTimeoutSec ?? STARTUP_SEC) * 1000,
          ...(options.warn !== undefined ? { warn: options.warn } : {}),
          ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
        });
        entry.connection = connection;
        entry.error = undefined;
        return connection;
      } catch (error: unknown) {
        entry.error = messageOf(error);
        warnOnce(`mcp server "${name}": ${entry.error}`);
        return undefined;
      } finally {
        entry.connecting = undefined;
      }
    })();
    return entry.connecting;
  }

  function toolsOf(name: string, entry: Held, connection: McpConnection, taken: Set<string>): Tool<any, any>[] {
    const tools: Tool<any, any>[] = [];
    const timeoutMs = (entry.server.toolTimeoutSec ?? TOOL_SEC) * 1000;
    for (const info of connection.tools()) {
      const toolName = toolNameOf(name, info.name);
      if (taken.has(toolName)) {
        warnOnce(`mcp server "${name}": tool ${info.name} is named ${toolName}, as another tool is; the first is kept`);
        continue;
      }
      try {
        tools.push(createTool<unknown>({
          name: toolName,
          description: (info.description ?? info.title ?? '').trim() || `${info.name}, a tool of the ${name} MCP server`,
          input: inputSchemaOf(info.inputSchema ?? {}),
          effects: effectsOf(info.annotations),
          execute: async (input, ctx) => {
            const result = await connection.call(info.name, input, { signal: ctx.signal, timeoutMs });
            const text = outputOf(result);
            if (result.isError === true) throw new Error(text !== '' ? text : `${info.name} failed`);
            return text;
          },
        }));
        taken.add(toolName);
      } catch (error: unknown) {
        warnOnce(`mcp server "${name}": tool ${info.name} is left out: ${messageOf(error)}`);
      }
    }
    return tools;
  }

  return {
    capability: ({ id = 'mcp', without = [] } = {}) => ({
      id,
      defer: { over: 0 },
      tools: async () => {
        const entries = [...held.entries()].filter(([name]) => !without.includes(name));
        const connections = await Promise.all(entries.map(([name, entry]) => ensure(name, entry)));
        const taken = new Set<string>();
        return entries.flatMap(([name, entry], index) => {
          const connection = connections[index];
          return connection === undefined ? [] : toolsOf(name, entry, connection, taken);
        });
      },
    }),
    status: () => [...held.entries()].map(([name, entry]) => {
      if (entry.server.enabled === false) return { name, state: 'disabled', tools: 0 };
      if (entry.connection !== undefined && entry.connection.closed === undefined) return { name, state: 'connected', tools: entry.connection.tools().length };
      if (entry.error !== undefined) return { name, state: 'failed', tools: 0, error: entry.error };
      return { name, state: 'not started', tools: 0 };
    }),
    async close() {
      const open = [...held.values()];
      await Promise.all(open.map(async (entry) => {
        const connection = entry.connection ?? await entry.connecting;
        entry.connection = undefined;
        await connection?.close().catch(() => {});
      }));
    },
  };
}
