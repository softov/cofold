/**
 * The server half of the round trip, as a request handler.
 *
 * `manifestFrom` describes a registry and `commandsFrom` builds it back into
 * commands; between them a service gets a command line it never wrote. What was
 * missing is the middle: something that answers the requests those commands
 * send. That is this file. Point an HTTP server at the handler `serve` returns
 * and every command carrying `meta.http` becomes a route, with the manifest at
 * `<prefix>/cli-manifest` beside them.
 *
 * Nothing here knows what the commands mean. It reads the same `meta.http` the
 * client reads, turns a request into the canonical input `canonicalFromObject`
 * would have produced from a command line, and hands it to `registry.execute`
 * on the `remote` surface. A command is one declaration whichever door is
 * knocked on.
 */

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import {
  ArgumentError,
  AuthorizationError,
  CofoldError,
  canonicalFromObject,
  surfaceEnabled,
  type Command,
  type Runner,
} from "@cofold/commands";
import { HttpError } from "./http.js";
import { manifestFrom } from "./manifest.js";
import type { HttpBinding } from "./types/manifest.js";

/** What `authorize` is told about one request, before the command runs. */
export interface ServeRequest {
  /** The command the request routed to. */
  command: Command;
  method: string;
  /** The full path, prefix included, as the client sent it. */
  path: string;
  /** The request's headers, so a token can be read and answered. */
  headers: IncomingHttpHeaders;
}

/** A request handler, as `node:http` takes one. */
export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

export interface ServeOptions {
  /**
   * Mounted under this path: `/api/status`, with the manifest at
   * `/api/cli-manifest`. Empty - the default - serves at the root.
   */
  prefix?: string;
  /**
   * Asked once per request, before the command runs. It refuses by throwing:
   * `HttpError` carries its own status (401 for no credentials, 403 for a
   * missing grant), anything else becomes a 500. What it answers is handed to
   * the command as `context.request.actor`, unread by the handler.
   */
  authorize?(request: ServeRequest): unknown;
  /** The path the manifest answers at, after the prefix. Default `/cli-manifest`. */
  manifestPath?: string;
  /** Refuse a body larger than this many bytes. Default one mebibyte. */
  maxBodyBytes?: number;
}

interface Route {
  command: Command;
  binding: HttpBinding;
  segments: string[];
}

/**
 * A request handler for one registry.
 *
 * The program names the manifest; the options mount it and guard it. The
 * handler is synchronous to hand to `createServer` and does its work in a
 * promise, so a slow command never blocks the accept loop.
 */
export function serve(
  registry: Runner,
  program: { name: string; version: string; description?: string },
  options: ServeOptions = {},
): RequestHandler {
  const prefix = normalizePrefix(options.prefix);
  const manifestPath = `${prefix}${options.manifestPath ?? "/cli-manifest"}`;
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const routes = routesOf(registry);

  return (request, response) => {
    void (async (): Promise<void> => {
      const url = urlOf(request);
      if (url === null) {
        send(response, 400, { message: "The request URL or Host is not valid" });
        return;
      }
      const method = request.method ?? "GET";
      const path = url.pathname;

      if (path === manifestPath) {
        send(response, 200, manifestFrom(registry, program));
        return;
      }

      if (prefix !== "" && path !== prefix && !path.startsWith(`${prefix}/`)) {
        send(response, 404, { message: `No route for ${method} ${path}` });
        return;
      }
      const rest = prefix === "" ? path : path.slice(prefix.length) || "/";

      for (const route of routes) {
        let parameters: Record<string, string> | null;
        try {
          parameters = match(route, method, rest);
        }
        catch {
          send(response, 400, { message: "The request path is not a valid URL" });
          return;
        }
        if (parameters === null) continue;
        try {
          const actor = await options.authorize?.({ command: route.command, method, path, headers: request.headers });
          const body = method === "GET" || method === "DELETE" || method === "HEAD"
            ? {}
            : await readBody(request, maxBodyBytes);
          const input = await canonicalFromObject(route.command, {
            ...queryOf(url),
            ...body,
            ...parameters,
          });
          const result = await registry.execute(route.command, {
            surface: "remote",
            input,
            request: { actor, metadata: { headers: { ...request.headers } } },
          });
          send(response, 200, result?.data ?? null);
        }
        catch (error: unknown) {
          const { status, message } = describe(error);
          send(response, status, { message });
        }
        return;
      }

      send(response, 404, { message: `No route for ${method} ${path}` });
    })().catch(() => {
      if (!response.headersSent) send(response, 500, { message: "Failed" });
      else response.destroy();
    });
  };
}

/** The request's URL, or `null` when its path or `Host` does not parse. */
function urlOf(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  }
  catch {
    return null;
  }
}

function routesOf(registry: Runner): Route[] {
  return registry.commands.flatMap((command) => {
    const binding = command.meta?.http;
    if (binding === undefined || !surfaceEnabled(command, "remote")) return [];
    return [{ command, binding, segments: binding.path.split("/").filter(Boolean) }];
  });
}

/** The path's parameters, or `null` for another route. Throws `URIError` on a malformed escape. */
function match(route: Route, method: string, path: string): Record<string, string> | null {
  if (route.binding.method !== method) return null;
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== route.segments.length) return null;
  const parameters: Record<string, string> = {};
  for (const [index, segment] of route.segments.entries()) {
    const part = parts[index]!;
    if (segment.startsWith("{") && segment.endsWith("}")) {
      parameters[segment.slice(1, -1)] = decodeURIComponent(part);
      continue;
    }
    if (segment !== part) return null;
  }
  return parameters;
}

function queryOf(url: URL): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const key of url.searchParams.keys()) {
    const all = url.searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  return query;
}

/**
 * The request's JSON body. A body of any other type is refused with 415: a
 * form or a `text/plain` body is what a browser sends cross-site without a
 * preflight.
 */
async function readBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, "The request body is too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return {};
  const type = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "The request body must be application/json");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  }
  catch {
    throw new ArgumentError("The request body is not valid JSON");
  }
}

function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined || prefix === "" || prefix === "/") return "";
  const leaded = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return leaded.replace(/\/+$/u, "");
}

/**
 * The status and the sentence one failure answers with.
 *
 * `HttpError` is the deliberate refusal and carries its status. A command may
 * throw its own error with a numeric `status`, as the example does with a
 * `NotFound`. `AuthorizationError` is 403 because it is thrown after a caller
 * was identified and refused a grant; a request with no credentials at all is
 * the `authorize` hook throwing `HttpError` 401. Anything else is ours, not the
 * caller's, and answers with a sentence rather than a stack.
 */
function describe(error: unknown): { status: number; message: string } {
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status <= 599) {
    return { status, message: messageOf(error) };
  }
  if (error instanceof AuthorizationError) return { status: 403, message: error.message };
  if (error instanceof ArgumentError) return { status: 400, message: error.message };
  return { status: 500, message: messageOf(error) };
}

/**
 * The sentence one failure may show its caller. An error that is neither an
 * expected `CofoldError`, an `HttpError` nor one carrying a numeric `status`
 * answers "Failed": its message can name a path or quote a secret.
 */
function messageOf(error: unknown): string {
  if (error instanceof CofoldError) return error.expected || error instanceof HttpError ? error.message : "Failed";
  const status = (error as { status?: unknown } | null)?.status;
  return error instanceof Error && typeof status === "number" ? error.message : "Failed";
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${body}\n`);
}
