import type { McpHttpHandler, McpHttpInvocation, McpHttpOptions } from "../types/server.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { type RequestContext, type Runner } from "@cofold/commands";
import { createMcpServer, diagnose } from "./server.js";

function answer(response: ServerResponse, status: number, message: string): void {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) { response.end(); return; }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: message }));
}

function localHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(host);
}

/** Stateless Streamable HTTP, mountable without Express or Fastify. */
export function createMcpHttpHandler(registry: Runner, options: McpHttpOptions): McpHttpHandler {
  const limit = options.maxBodyBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("maxBodyBytes must be a positive integer");
  // Validate the registry even before the first request.
  createMcpServer(registry, options);
  const active = new Set<Server>();
  let closing = false;
  const handler: McpHttpHandler = Object.assign(async (request: IncomingMessage, response: ServerResponse, invocation: McpHttpInvocation = {}): Promise<void> => {
    if (closing) { answer(response, 503, "MCP server is closing"); return; }
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    if (!(options.allowedHosts?.includes(host) ?? localHost(host))
        || (origin !== undefined && !(options.allowedOrigins?.includes(origin) ?? false))) {
      answer(response, 403, "Host or origin is not allowed"); return;
    }
    let trusted: Readonly<RequestContext> | null;
    try { trusted = invocation.context ?? await options.authenticate?.(request) ?? null; }
    catch (error: unknown) { diagnose(options, error); answer(response, 401, "Authentication failed"); return; }
    if (trusted === null) { answer(response, 401, "Authentication required"); return; }
    // This server has no sessions to delete or standalone streams to reopen.
    if (request.method !== "POST") {
      response.setHeader("allow", "POST"); answer(response, 405, "This endpoint accepts POST only"); return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers["content-type"] ?? "")) {
      answer(response, 415, "Expected application/json"); return;
    }
    let body = invocation.body;
    try {
      if (body === undefined) {
        const chunks: Buffer[] = [];
        let length = 0;
        // Event listeners allow a 413 response without destroying the socket first.
        const raw = await new Promise<Buffer>((resolve, reject) => {
          const cleanup = (): void => { request.off("data", data); request.off("end", end); request.off("error", fail); request.off("aborted", aborted); };
          const fail = (error: Error): void => { cleanup(); reject(error); };
          const aborted = (): void => fail(new Error("Request aborted"));
          const end = (): void => { cleanup(); resolve(Buffer.concat(chunks)); };
          const data = (chunk: Buffer): void => {
            length += chunk.length;
            if (length > limit) { cleanup(); request.resume(); reject(new RangeError("Request body is too large")); return; }
            chunks.push(chunk);
          };
          request.on("data", data); request.on("end", end); request.on("error", fail); request.on("aborted", aborted);
        });
        body = JSON.parse(raw.toString("utf8")) as unknown;
      } else if (Buffer.byteLength(JSON.stringify(body)) > limit) {
        throw new RangeError("Request body is too large");
      }
    } catch (error: unknown) {
      answer(response, error instanceof RangeError ? 413 : 400, error instanceof RangeError ? "Request body is too large" : "Invalid JSON request"); return;
    }
    if (closing || response.destroyed) { answer(response, 503, "MCP server is closing"); return; }
    const server = createMcpServer(registry, { ...options, context: () => trusted });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: options.jsonResponse ?? false });
    active.add(server);
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      active.delete(server);
      try { await server.close(); } catch (error: unknown) { diagnose(options, error); }
    };
    response.once("close", () => { void close(); });
    try {
      // SDK's accessor-based optional callbacks need this bridge under exactOptionalPropertyTypes.
      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, body);
    } catch (error: unknown) {
      diagnose(options, error);
      answer(response, 500, "MCP request failed");
      await close();
    }
  }, {
    close: async (): Promise<void> => {
      closing = true;
      await Promise.all([...active].map(async (server) => { try { await server.close(); } catch (error: unknown) { diagnose(options, error); } }));
      active.clear();
    },
  });
  return handler;
}

/** Convenience listener. Embedded applications should use createMcpHttpHandler. */
export async function listenMcpHttp(registry: Runner, options: McpHttpOptions & { host?: string; port?: number; path?: string }) {
  const handler = createMcpHttpHandler(registry, options);
  const path = options.path ?? "/mcp";
  const server = createServer((request, response) => {
    if (request.url?.split("?")[0] !== path) { answer(response, 404, "Not found"); return; }
    void handler(request, response).catch((error: unknown) => { diagnose(options, error); answer(response, 500, "MCP request failed"); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: options.host ?? "127.0.0.1", port: options.port ?? 0 }, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("MCP listener has no TCP address");
  return {
    server,
    url: new URL(`http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}${path}`),
    close: async (): Promise<void> => {
      const stopped = new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      await handler.close();
      server.closeAllConnections();
      await stopped;
    },
  };
}
