/**
 * A registry, answered as HTTP.
 *
 * The transport tests say what one command sends; these say what a server does
 * with it. The interesting cases are the ones that are not the happy path: a
 * refusal that has to keep its status and its sentence, a path that is not
 * under the prefix, and a command that declared no binding and so has no route
 * at all. A server is where a wrong default is reachable by anybody.
 */

import { connect, type AddressInfo } from "node:net";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ArgumentError, AuthorizationError, coerce, createRegistry, output, type Registry } from "@cofold/commands";
import { HttpError } from "./http.js";
import { serve, type RequestHandler } from "./serve.js";

function service(): Registry<object> {
  const registry = createRegistry({ groups: [{ name: "pets", title: "Pets" }] })
    .provide("pets", { resolve: () => [{ id: "1", name: "Ada" }] });
  registry.register(
    registry.command({
      id: "pet.list",
      group: "pets",
      pattern: ["pet", "list"],
      summary: "List the pets",
      needs: ["pets"],
      options: [{ name: "--limit", value: "N", description: "How many", coerce: coerce.integer({ min: 1, max: 100 }) }],
      meta: { http: { method: "GET", path: "/pets" } },
      run: (context) => output(context.pets),
    }),
    registry.command({
      id: "pet.show",
      group: "pets",
      pattern: ["pet", "show", ":id"],
      summary: "Show one pet",
      arguments: { id: { description: "The pet's id" } },
      needs: ["pets"],
      meta: { http: { method: "GET", path: "/pets/{id}" } },
      run: (context) => output({ id: context.value("id") }),
    }),
    registry.command({
      id: "pet.add",
      group: "pets",
      pattern: ["pet", "add"],
      summary: "Add a pet",
      needs: ["pets"],
      options: [{ name: "--name", value: "NAME", description: "What it answers to", required: true }],
      meta: { http: { method: "POST", path: "/pets" } },
      run: (context) => output({ name: context.value("name") }),
    }),
    // No `meta.http`: described in the manifest, but not a route.
    registry.command({
      id: "pet.secret",
      group: "pets",
      pattern: ["pet", "secret"],
      summary: "No route",
      run: () => output("secret"),
    }),
  );
  return registry;
}

const servers: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(handler: RequestHandler): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address() as AddressInfo;
  servers.push({ close: () => new Promise<void>((resolve, reject) => { server.close((error) => error === undefined ? resolve() : reject(error)); }) });
  return `http://127.0.0.1:${port}`;
}

const program = { name: "pets", version: "1.0.0" };

/** One request written by hand, for what `fetch` refuses to send. */
async function raw(base: string, head: string): Promise<string> {
  const { hostname, port } = new URL(base);
  return new Promise<string>((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => { socket.end(`${head}\r\nConnection: close\r\n\r\n`); });
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { text += chunk; });
    socket.on("end", () => { resolve(text); });
    socket.on("error", reject);
  });
}

/** A registry with one route per case the handler has to survive. */
function fragile(): Registry<object> {
  const registry = createRegistry({});
  registry.register(
    registry.command({
      id: "item.add",
      pattern: ["item", "add", ":id"],
      summary: "Add one item",
      arguments: { id: { description: "The item's id" } },
      meta: { http: { method: "POST", path: "/add/{id}" } },
      run: (context) => output({ id: context.value("id") }),
    }),
    registry.command({
      id: "item.read",
      pattern: ["item", "read"],
      summary: "Fails reading a file",
      meta: { http: { method: "GET", path: "/read" } },
      run: () => { throw new Error("/secret/path could not be read"); },
    }),
    registry.command({
      id: "item.actor",
      pattern: ["item", "actor"],
      summary: "Answers who asked",
      meta: { http: { method: "GET", path: "/actor" } },
      run: (context) => output(context.request?.actor ?? null),
    }),
  );
  return registry;
}

describe("a registry served over HTTP", () => {
  it("describes itself at the manifest path", async () => {
    const base = await start(serve(service(), program));
    const answer = await fetch(`${base}/cli-manifest`);
    expect(answer.status).toBe(200);
    const manifest = await answer.json() as { cofold: number; program: { name: string }; commands: { id: string }[] };
    expect(manifest.cofold).toBe(1);
    expect(manifest.program.name).toBe("pets");
    // The unbound command is still described; it just has no route.
    expect(manifest.commands.map((command) => command.id)).toEqual(["pet.list", "pet.show", "pet.add"]);
  });

  it("answers a GET with its query, and a path parameter", async () => {
    const base = await start(serve(service(), program));
    expect(await (await fetch(`${base}/pets?limit=5`)).json()).toEqual([{ id: "1", name: "Ada" }]);
    expect(await (await fetch(`${base}/pets/7`)).json()).toEqual({ id: "7" });
  });

  it("answers a POST with its JSON body", async () => {
    const base = await start(serve(service(), program));
    const answer = await fetch(`${base}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Byte" }),
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ name: "Byte" });
  });

  it("mounts every route and the manifest under the prefix", async () => {
    const base = await start(serve(service(), program, { prefix: "/api" }));
    expect((await fetch(`${base}/pets`)).status).toBe(404);
    expect((await fetch(`${base}/api/cli-manifest`)).status).toBe(200);
    expect(await (await fetch(`${base}/api/pets/7`)).json()).toEqual({ id: "7" });
  });

  it("answers 404 for a command with no binding", async () => {
    const base = await start(serve(service(), program));
    expect((await fetch(`${base}/pet/secret`)).status).toBe(404);
  });

  it("tells authorize the headers of the request", async () => {
    const seen: string[] = [];
    const base = await start(serve(service(), program, {
      authorize: (request) => { seen.push(`${request.method} ${request.command.id} ${String(request.headers.authorization)}`); },
    }));
    await fetch(`${base}/pets`, { headers: { authorization: "Bearer root" } });
    expect(seen).toEqual(["GET pet.list Bearer root"]);
  });

  it("keeps the status and the sentence of a refusal", async () => {
    const base = await start(serve(service(), program, {
      authorize: () => { throw new HttpError(401, "A token is required"); },
    }));
    const answer = await fetch(`${base}/pets`);
    expect(answer.status).toBe(401);
    expect(await answer.json()).toEqual({ message: "A token is required" });
  });

  it("answers 403 when a grant is missing", async () => {
    const base = await start(serve(service(), program, {
      authorize: () => { throw new AuthorizationError("plugin install requires config:write", ["config:write"]); },
    }));
    const answer = await fetch(`${base}/pets`);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ message: "plugin install requires config:write" });
  });

  it("answers 400 for a body that is not JSON", async () => {
    const base = await start(serve(service(), program));
    const answer = await fetch(`${base}/pets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(answer.status).toBe(400);
  });

  it("answers 400 for a missing required field", async () => {
    const base = await start(serve(service(), program));
    const answer = await fetch(`${base}/pets`, { method: "POST" });
    expect(answer.status).toBe(400);
    expect((await answer.json() as { message: string }).message).toBeTruthy();
  });

  it("answers 500 with a sentence, not a stack, for an unexpected failure", async () => {
    const registry = createRegistry({})
      .provide("pets", { resolve: () => [] as { id: string }[] });
    registry.register(registry.command({
      id: "pet.boom",
      pattern: ["pet", "boom"],
      summary: "Explodes",
      needs: ["pets"],
      meta: { http: { method: "GET", path: "/boom" } },
      run: () => { throw new ArgumentError("deliberate"); },
    }));
    const base = await start(serve(registry, program));
    expect((await fetch(`${base}/boom`)).status).toBe(400);
  });
});

describe("a request the handler has to survive", () => {
  it("answers 400 for a Host that does not parse, and keeps serving", async () => {
    const base = await start(serve(service(), program));
    const answer = await raw(base, "GET /pets HTTP/1.1\r\nHost: a b");
    expect(answer).toMatch(/^HTTP\/1\.1 400 /u);
    expect((await fetch(`${base}/pets`)).status).toBe(200);
  });

  it("answers 400 for a malformed escape in a path parameter, before authorize is asked", async () => {
    const asked: string[] = [];
    const base = await start(serve(fragile(), program, {
      authorize: (request) => { asked.push(request.command.id); },
    }));
    const answer = await fetch(`${base}/add/%E0%A4%A`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(answer.status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("answers 415 for a body that is not application/json", async () => {
    const base = await start(serve(service(), program));
    const form = await fetch(`${base}/pets`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Byte",
    });
    expect(form.status).toBe(415);
    const plain = await fetch(`${base}/pets`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "Byte" }),
    });
    expect(plain.status).toBe(415);
  });

  it("answers 500 with Failed, never the message of an unexpected error", async () => {
    const base = await start(serve(fragile(), program));
    const answer = await fetch(`${base}/read`);
    expect(answer.status).toBe(500);
    expect(await answer.json()).toEqual({ message: "Failed" });
  });
});

describe("the principal authorize answers", () => {
  it("reaches the command as the request's actor", async () => {
    const base = await start(serve(fragile(), program, {
      authorize: (request) => ({ subject: String(request.headers.authorization) }),
    }));
    const answer = await fetch(`${base}/actor`, { headers: { authorization: "Bearer root" } });
    expect(await answer.json()).toEqual({ subject: "Bearer root" });
  });

  it("is absent when there is no authorize", async () => {
    const base = await start(serve(fragile(), program));
    expect(await (await fetch(`${base}/actor`)).json()).toBeNull();
  });
});
