import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { canonicalFromObject, type Command } from "@softcli/core";
import { describe, type HttpBinding } from "@softcli/remote";
import { kernel, NotFound } from "./registry.js";

/**
 * The server half of the round trip.
 *
 * Two things are served from one registry: ordinary REST at the paths the
 * bindings name, and `/cli-manifest`, which is that registry as JSON. Any
 * client that speaks the manifest gets a working command line for this service
 * without this service shipping one - and without the client being rebuilt when
 * a command is added here.
 */

interface Route {
  command: Command;
  binding: HttpBinding;
  segments: string[];
}

function routes(): Route[] {
  return kernel.commands.flatMap((command) => {
    const binding = command.meta?.["http"] as HttpBinding | undefined;
    return binding === undefined ? [] : [{ command, binding, segments: binding.path.split("/").filter(Boolean) }];
  });
}

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

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${body}\n`);
}

export function createPetServer(program: { name: string; version: string; description?: string }) {
  const table = routes();

  return createServer((request, response) => {
    void (async (): Promise<void> => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (url.pathname === "/cli-manifest") {
        send(response, 200, describe(kernel, program));
        return;
      }

      for (const route of table) {
        const parameters = match(route, request.method ?? "GET", url.pathname);
        if (parameters === null) continue;
        try {
          const body = request.method === "GET" || request.method === "DELETE" ? {} : await readBody(request);
          const query = Object.fromEntries([...url.searchParams.keys()]
            .map((key) => [key, url.searchParams.getAll(key).length > 1 ? url.searchParams.getAll(key) : url.searchParams.get(key)]));
          const input = await canonicalFromObject(route.command, { ...query, ...body, ...parameters });
          const result = await kernel.execute(route.command, { surface: "remote", input });
          send(response, 200, result?.data ?? null);
        } catch (error: unknown) {
          const status = error instanceof NotFound ? 404 : (error as { kind?: string }).kind === "argument" ? 400 : 500;
          send(response, status, { message: error instanceof Error ? error.message : "Failed" });
        }
        return;
      }

      send(response, 404, { message: `No route for ${request.method} ${url.pathname}` });
    })();
  });
}
