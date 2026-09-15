import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Command, RequestContext } from "@facio/commands";
import type { PromptDefinition, ResourceDefinition, ResourceTemplateDefinition } from "./resources.js";
import type { ToolDefinition } from "./tool.js";

export type McpRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type McpRequestContext = Readonly<RequestContext> & { readonly signal: AbortSignal };

export interface ToolEvent {
  tool: ToolDefinition;
  context: McpRequestContext;
  data: unknown;
}

export interface McpServerOptions {
  name: string;
  version: string;
  instructions?: string;
  /** Trusted adapter data. Never copy tool arguments into this context. */
  context?(extra: McpRequestExtra): Readonly<RequestContext> | Promise<Readonly<RequestContext>>;
  /** Applied to discovery AND invocation. Registry authorization still runs. */
  visible?(command: Command, context: McpRequestContext, scopes: readonly string[]): boolean | Promise<boolean>;
  encodeResult?(event: ToolEvent): CallToolResult | Promise<CallToolResult>;
  /** Undefined selects the default mapping. Return only public messages. */
  mapError?(error: unknown): CallToolResult | undefined;
  onSuccess?(event: ToolEvent): void | Promise<void>;
  onFailure?(error: unknown, context: McpRequestContext): void | Promise<void>;
  /** Application-owned diagnostics; never written to stdout by Facio. */
  onDiagnostic?(error: unknown): void;
  /** Enable explicit tools/list_changed notifications on this connection. */
  toolListChanged?: boolean;
  resources?: readonly ResourceDefinition[];
  resourceTemplates?: readonly ResourceTemplateDefinition[];
  prompts?: readonly PromptDefinition[];
}

export interface McpHttpOptions extends Omit<McpServerOptions, "context" | "toolListChanged"> {
  /** Return trusted context, or null to refuse. Omission requires middleware context. */
  authenticate?(request: IncomingMessage): Readonly<RequestContext> | null | Promise<Readonly<RequestContext> | null>;
  /** Exact Host header values; defaults to localhost/loopback at any port. */
  allowedHosts?: readonly string[];
  /** Exact origins; defaults to refusing browser Origin headers. */
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  /** JSON mode cannot deliver progress notifications. Defaults to SSE responses. */
  jsonResponse?: boolean;
}

export interface McpHttpInvocation {
  /** Already parsed by middleware; middleware must also enforce its own body limit. */
  body?: unknown;
  /** Already authenticated by middleware; never populate this from request JSON. */
  context?: Readonly<RequestContext>;
}

export interface McpHttpHandler {
  (request: IncomingMessage, response: ServerResponse, invocation?: McpHttpInvocation): Promise<void>;
  close(): Promise<void>;
}
