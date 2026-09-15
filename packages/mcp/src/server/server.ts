import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema, ToolSchema,
  ErrorCode, McpError, type CallToolResult, type Implementation,
  type ServerRequest, type ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { FacioError, compact, type Command, type RequestContext, type Runner } from "@facio/commands";
import { tools, validateToolOutput, type ToolDefinition } from "../index.js";
import { registerResourcesAndPrompts, type ResourceDefinition, type ResourceTemplateDefinition, type PromptDefinition } from "./resources.js";

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

/** Observer failures must never change an already completed action's result. */
export function diagnose(options: Pick<McpServerOptions, "onDiagnostic">, error: unknown): void {
  try { options.onDiagnostic?.(error); } catch { /* diagnostics cannot change execution */ }
}

export async function requestContext(options: McpServerOptions, extra: McpRequestExtra): Promise<McpRequestContext> {
  let trusted: Readonly<RequestContext>;
  try { trusted = await options.context?.(extra) ?? {}; } catch (error: unknown) {
    diagnose(options, error);
    throw new McpError(ErrorCode.InternalError, "Request context could not be resolved");
  }
  const token = extra._meta?.progressToken;
  let previous = -Infinity;
  return Object.freeze({
    ...trusted,
    id: extra.requestId,
    signal: extra.signal,
    // Protocol metadata is untrusted and is deliberately not copied into trusted metadata.
    progress: async (value: { progress: number; total?: number; message?: string }): Promise<void> => {
      extra.signal.throwIfAborted();
      if (!Number.isFinite(value.progress) || value.progress < 0 || value.progress <= previous
          || (value.total !== undefined && (!Number.isFinite(value.total) || value.total < value.progress))) {
        throw new Error("Progress must increase and not exceed its finite total");
      }
      previous = value.progress;
      if (token !== undefined) await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, ...value } });
    },
  });
}

function defaultResult(data: unknown, structured: boolean): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }],
    ...(structured ? { structuredContent: data as Record<string, unknown> } : {}),
  };
}

/** SDK integration over Facio's JSON Schema descriptors; no schema translation into Zod. */
export function createMcpServer(registry: Runner, options: McpServerOptions): Server {
  registry.verify();
  tools(registry); // Reject collisions and invalid contracts before accepting a connection.
  const info: Implementation = { name: options.name, version: options.version };
  const server = new Server(info, {
    capabilities: {
      tools: options.toolListChanged === true ? { listChanged: true } : {},
      ...((options.resources?.length ?? 0) + (options.resourceTemplates?.length ?? 0) > 0 ? { resources: {} } : {}),
      ...((options.prompts?.length ?? 0) > 0 ? { prompts: {} } : {}),
    },
    ...compact({ instructions: options.instructions }),
  });
  server.onerror = (error) => diagnose(options, error);

  const visible = async (tool: ToolDefinition, context: McpRequestContext): Promise<boolean> => {
    try { return await options.visible?.(tool.command, context, registry.scopesFor?.(tool.command) ?? tool.command.scopes ?? []) ?? true; }
    catch (error: unknown) { diagnose(options, error); throw new McpError(ErrorCode.InternalError, "Tool visibility could not be resolved"); }
  };

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const context = await requestContext(options, extra);
    const listed = [];
    for (const tool of tools(registry)) {
      if (!await visible(tool, context)) continue;
      listed.push(ToolSchema.parse({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        ...compact({ annotations: tool.annotations, outputSchema: tool.outputSchema }) }));
    }
    return { tools: listed };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.task !== undefined) throw new McpError(ErrorCode.InvalidParams, "Task execution is not supported");
    const context = await requestContext(options, extra);
    const tool = tools(registry, { signal: extra.signal, request: context, onCleanupError: (error) => diagnose(options, error) })
      .find((candidate) => candidate.name === request.params.name);
    if (tool === undefined || !await visible(tool, context)) {
      throw new McpError(ErrorCode.InvalidParams, "Unknown or unavailable tool");
    }
    let completed = false;
    try {
      const data = await tool.invoke(request.params.arguments ?? {});
      completed = true;
      const event = { tool, context, data };
      // Announce successful domain execution even if its result cannot be encoded.
      try { await options.onSuccess?.(event); } catch (error: unknown) { diagnose(options, error); }
      const result = CallToolResultSchema.parse(await options.encodeResult?.(event) ?? defaultResult(data, tool.outputSchema !== undefined));
      if (result.isError !== true) validateToolOutput(tool, tool.outputSchema === undefined ? data : result.structuredContent);
      return result;
    } catch (error: unknown) {
      try { await options.onFailure?.(error, context); } catch (observerError: unknown) { diagnose(options, observerError); }
      diagnose(options, error);
      if (completed) return { isError: true, content: [{ type: "text", text: "Tool completed, but its result could not be returned. Do not retry the action automatically." }] };
      try {
        const mapped = options.mapError?.(error);
        if (mapped !== undefined) return CallToolResultSchema.parse(mapped);
      } catch (mappingError: unknown) { diagnose(options, mappingError); }
      const message = extra.signal.aborted ? "Tool cancelled"
        : error instanceof FacioError && ["argument", "authorization", "conflict"].includes(error.kind)
          ? error.message : "Tool execution failed";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
  registerResourcesAndPrompts(server, options);
  return server;
}
