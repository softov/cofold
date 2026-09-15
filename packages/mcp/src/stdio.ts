import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import type { Command, RequestContext, Runner } from "@facio/commands";
import { callTool, tools, UnknownToolError } from "./index.js";

/**
 * @facio/mcp/stdio - the tool descriptors, spoken.
 *
 * `@facio/mcp` stops at descriptors, which leaves every program that wants to be
 * an MCP server writing the same read loop. This is that loop, and it is here
 * rather than behind an SDK for the same reason `@facio/yaml` is: the subset a
 * tools-only server needs is small and stable, and a dependency that drags in a
 * web framework to read newline-delimited JSON is a poor trade for a library
 * whose entire argument is that a command declaration is enough.
 *
 * What it speaks is bounded on purpose. Tools, over stdio, and nothing else.
 * Resources, prompts, sampling, sessions and Streamable HTTP are refused by
 * name rather than half-answered - a server that advertises a capability it
 * only partly has is worse than one that never offered it.
 */

/** Newest first. `initialize` echoes the client's choice when it is one of these. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

/** JSON-RPC 2.0 failures. A protocol fault, never a tool that refused. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** A JSON-RPC id. Absent means a notification, which is never answered. */
type Id = string | number;

interface Incoming {
  id?: Id | null;
  method?: unknown;
  params?: unknown;
}

export interface StdioOptions {
  /** Reported to the client as `serverInfo`. */
  name: string;
  version: string;
  /** Shown to the agent once, at initialisation. */
  instructions?: string;
  stdin?: Readable;
  stdout?: Writable;
  /**
   * Trusted per-call data, reaching handlers as `context.request`.
   *
   * A stdio server is one process per client, so this is usually constant -
   * whoever launched the process. It is a function so that a token read from
   * the environment can be refreshed without restarting the server.
   */
  context?(): Readonly<RequestContext> | Promise<Readonly<RequestContext>>;
  /** Narrows what is served, on top of `surfaces.mcp`. Never widens it. */
  filter?(command: Command): boolean;
  /** Which failures come back as a readable tool error rather than a generic one. */
  recoverable?(error: unknown): boolean;
  /** Stderr, a log, anything that is not stdout. Facio never writes diagnostics itself. */
  onDiagnostic?(error: unknown): void;
  /** A single message this large is treated as a broken stream. */
  maxMessageBytes?: number;
}

export interface StdioServer {
  /** Resolves when stdin ends or `close` is called. The process is the caller's. */
  readonly closed: Promise<void>;
  close(): void;
}

/**
 * Serve the registry's MCP tools on stdin and stdout.
 *
 * Stdout carries protocol messages and nothing else, which is why handlers get
 * `silentIo` from the registry and why this never prints. A handler that writes
 * to stdout corrupts the stream, so a program that needs to say something says
 * it through `onDiagnostic`.
 */
export function serveStdio(registry: Runner, options: StdioOptions): StdioServer {
  registry.verify();
  // Names, collisions and output contracts are wrong at build time or not at
  // all: finding out on the first tool call means telling an agent instead.
  tools(registry, options.filter === undefined ? {} : { filter: options.filter });

  const input = options.stdin ?? process.stdin;
  const out = options.stdout ?? process.stdout;
  const limit = options.maxMessageBytes ?? 4 * 1024 * 1024;
  /** Live tool calls, by request id, so `notifications/cancelled` can find one. */
  const running = new Map<string, AbortController>();
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let initialized = false;
  let closing = false;
  let settle!: () => void;
  const closed = new Promise<void>((resolve) => { settle = resolve; });

  const diagnose = (error: unknown): void => {
    try { options.onDiagnostic?.(error); } catch { /* a diagnostic cannot be allowed to fail a call */ }
  };
  // JSON.stringify escapes newlines inside strings, so one message is one line.
  const send = (message: object): void => { if (!closing) out.write(`${JSON.stringify(message)}\n`); };
  const reply = (id: Id, result: unknown): void => { send({ jsonrpc: "2.0", id, result }); };
  const fail = (id: Id | null, code: number, message: string): void => {
    send({ jsonrpc: "2.0", id, error: { code, message } });
  };

  const initialize = (params: Record<string, unknown>): unknown => {
    const asked = params["protocolVersion"];
    return {
      protocolVersion: typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: options.name, version: options.version },
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    };
  };

  /**
   * One tool call, with its own cancellation and its own progress channel.
   *
   * The registry is asked for the tool list again per call rather than once at
   * startup, because a filter can depend on who is asking and a registry can
   * gain commands after the server started.
   */
  const call = async (id: Id, params: Record<string, unknown>): Promise<void> => {
    const name = params["name"];
    if (typeof name !== "string") { fail(id, INVALID_PARAMS, "A tool call needs a name"); return; }
    const given = params["arguments"] ?? {};
    if (typeof given !== "object" || given === null || Array.isArray(given)) {
      fail(id, INVALID_PARAMS, "Tool arguments must be an object"); return;
    }
    if (params["task"] !== undefined) { fail(id, INVALID_PARAMS, "Task execution is not supported"); return; }

    const key = String(id);
    const controller = new AbortController();
    running.set(key, controller);
    try {
      const trusted = await options.context?.() ?? {};
      const meta = params["_meta"];
      const token = (meta as { progressToken?: string | number } | undefined)?.progressToken;
      let reached = -Infinity;
      const request: Readonly<RequestContext> = Object.freeze({
        ...trusted,
        id,
        // Validated whether or not the client asked for progress, so a handler
        // that reports nonsense is caught in development rather than in front
        // of the one client that happened to send a token.
        progress: async (value: { progress: number; total?: number; message?: string }): Promise<void> => {
          controller.signal.throwIfAborted();
          if (!Number.isFinite(value.progress) || value.progress <= reached
            || (value.total !== undefined && (!Number.isFinite(value.total) || value.total < value.progress))) {
            throw new Error("Progress must increase and not exceed its finite total");
          }
          reached = value.progress;
          if (token !== undefined) {
            send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, ...value } });
          }
        },
      });
      const result = await callTool(registry, name, given as Record<string, unknown>, {
        signal: controller.signal,
        request,
        onCleanupError: diagnose,
        ...(options.filter === undefined ? {} : { filter: options.filter }),
        ...(options.recoverable === undefined ? {} : { recoverable: options.recoverable }),
      });
      // A cancelled request is answered by not answering: the client has
      // already given up on this id, and the protocol says so.
      if (!controller.signal.aborted) reply(id, result);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (error instanceof UnknownToolError) { fail(id, INVALID_PARAMS, error.message); return; }
      // Everything `callTool` did not classify is ours, not the agent's. It
      // gets a result rather than a JSON-RPC error so the connection survives,
      // and a generic one so a stack or a secret never reaches the client.
      diagnose(error);
      reply(id, { content: [{ type: "text", text: "Tool execution failed" }], isError: true });
    } finally {
      running.delete(key);
    }
  };

  const handle = async (message: Incoming): Promise<void> => {
    const method = typeof message.method === "string" ? message.method : "";
    const params = (typeof message.params === "object" && message.params !== null && !Array.isArray(message.params)
      ? message.params : {}) as Record<string, unknown>;
    const id = message.id ?? null;

    if (id === null) {
      if (method === "notifications/initialized") initialized = true;
      if (method === "notifications/cancelled") {
        const target = params["requestId"];
        if (typeof target === "string" || typeof target === "number") {
          running.get(String(target))?.abort(new Error("The client cancelled this call"));
        }
      }
      return;
    }
    if (method === "initialize") { reply(id, initialize(params)); return; }
    if (method === "ping") { reply(id, {}); return; }
    if (!initialized) { fail(id, INVALID_REQUEST, "Send initialize before anything else"); return; }
    if (method === "tools/list") {
      // No pagination: a registry is a declared set, not a query result, and a
      // cursor nobody issued is a cursor nobody can present.
      const listed = tools(registry, options.filter === undefined ? {} : { filter: options.filter })
        .map(({ name, description, inputSchema, annotations, outputSchema }) => ({
          name, description, inputSchema,
          ...(annotations === undefined ? {} : { annotations }),
          ...(outputSchema === undefined ? {} : { outputSchema }),
        }));
      reply(id, { tools: listed });
      return;
    }
    if (method === "tools/call") { await call(id, params); return; }
    fail(id, METHOD_NOT_FOUND, `This server does not implement ${method}`);
  };

  const accept = (line: string): void => {
    if (line.trim() === "") return;
    let message: Incoming;
    try { message = JSON.parse(line) as Incoming; } catch (error: unknown) {
      diagnose(error);
      fail(null, PARSE_ERROR, "Message is not JSON");
      return;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      fail(null, INVALID_REQUEST, "Message is not a JSON-RPC object");
      return;
    }
    // Not awaited: a slow tool must not hold up the next message, least of all
    // the cancellation that was sent to stop it.
    void handle(message).catch((error: unknown) => { diagnose(error); });
  };

  const onData = (chunk: Buffer): void => {
    pending += decoder.write(chunk);
    let at = pending.indexOf("\n");
    while (at >= 0) {
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      accept(line);
      at = pending.indexOf("\n");
    }
    if (pending.length > limit) {
      pending = "";
      fail(null, PARSE_ERROR, "Message exceeds the maximum size");
    }
  };

  const finish = (): void => {
    if (closing) return;
    closing = true;
    input.off("data", onData);
    input.off("end", finish);
    input.off("error", onError);
    for (const controller of running.values()) controller.abort(new Error("The server is closing"));
    running.clear();
    settle();
  };
  function onError(error: unknown): void { diagnose(error); finish(); }

  input.on("data", onData);
  input.once("end", finish);
  input.once("error", onError);

  return { closed, close: finish };
}
