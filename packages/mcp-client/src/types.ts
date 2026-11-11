/** What every server entry may say besides its transport. */
interface ServerCommon {
  /** `false` keeps the entry without starting it. */
  enabled?: boolean;
  /** How long the server may take to start and list its tools; 10 seconds by default. */
  startupTimeoutSec?: number;
  /** How long one tool call may take; 60 seconds by default. */
  toolTimeoutSec?: number;
}

/** A server started as a process and spoken to over its stdin and stdout. Claude Code's shape: no `type` is stdio. */
export interface McpStdioServer extends ServerCommon {
  type?: 'stdio';
  command: string;
  args?: string[];
  /** Set over the process's own environment. */
  env?: Record<string, string>;
  /** Where the process starts; the host's folder when absent. */
  cwd?: string;
}

/** A server reached over Streamable HTTP. */
export interface McpHttpServer extends ServerCommon {
  type: 'http';
  url: string;
  /** Sent with every request, after the protocol's own. */
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

/** The hints a server may give about a tool; the spec calls them untrusted unless the server is. */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** One tool, as `tools/list` gives it. */
export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image' | 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name?: string; description?: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: string; [key: string]: unknown };

/** What `tools/call` answers. */
export interface McpCallResult {
  content?: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Who this client is, as `initialize` tells the server. */
export interface McpClientInfo {
  name: string;
  version: string;
  title?: string;
}

export type JsonRpcId = string | number;

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * The way messages reach one server. A message the server sends, an answer or not, goes to the handler `start`
 * was given; `send` resolves once the message is delivered (for HTTP, once its reply has been read).
 */
export interface Transport {
  start(handlers: { message(message: JsonRpcMessage): void; closed(reason: string): void }): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  /** The protocol version both sides agreed on, for a transport that repeats it on every request. */
  agreed?(version: string): void;
  close(): Promise<void>;
}
