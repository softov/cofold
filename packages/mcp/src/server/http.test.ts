import { createServer } from "node:http";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRegistry, output } from "@cofold/commands";
import { createMcpHttpHandler, listenMcpHttp } from "./http.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup(jsonResponse = false) {
  const registry = createRegistry();
  registry.action({ id: "who", summary: "", surfaces: { mcp: true }, run: async ({ request }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return output(request?.actor);
  } });
  const listening = await listenMcpHttp(registry, { name: "http-test", version: "1", jsonResponse,
    authenticate: (req) => req.headers.authorization ? { actor: req.headers.authorization } : null, maxBodyBytes: 2048 });
  cleanup.push(listening.close);
  return listening;
}
async function connect(url: URL, token: string) {
  const client = new Client({ name: "test", version: "1" });
  cleanup.push(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: token } } }) as Transport);
  return client;
}
describe("Streamable HTTP", () => {
  it.each([false, true])("initializes SDK clients and isolates actors (JSON %s)", async (json) => {
    const { url } = await setup(json);
    const [one, two] = await Promise.all([connect(url, "one"), connect(url, "two")]);
    expect((await one.listTools()).tools[0]?.name).toBe("who");
    const results = await Promise.all([one.callTool({ name: "who" }), two.callTool({ name: "who" })]);
    expect(results.map((r) => r.content)).toEqual([[{ type: "text", text: '"one"' }], [{ type: "text", text: '"two"' }]]);
  });
  it("rejects unauthenticated, invalid, oversized and wrong-origin requests", async () => {
    const { url } = await setup();
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    const headers = { authorization: "test", "content-type": "application/json" };
    expect((await fetch(url, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers, body: '"' + "x".repeat(4096) + '"' })).status).toBe(413);
    expect((await fetch(url, { method: "POST", headers: { ...headers, origin: "https://evil.test" }, body: "{}" })).status).toBe(403);
    expect((await fetch(url, { method: "GET", headers })).status).toBe(405);
    expect((await fetch(url, { method: "DELETE", headers })).status).toBe(405);
  });
});


it("mounts behind middleware with a parsed body and trusted identity", async () => {
  const registry = createRegistry();
  registry.action({ id: "who", summary: "", surfaces: { mcp: true }, run: ({ request }) => output(request?.actor) });
  const handler = createMcpHttpHandler(registry, { name: "mounted", version: "1" });
  const http = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST") { await handler(req, res, { context: { actor: "middleware" } }); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      await handler(req, res, { body: JSON.parse(Buffer.concat(chunks).toString()) as unknown, context: { actor: "middleware" } });
    })().catch(() => { res.statusCode = 500; res.end(); });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { await handler.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  const address = http.address(); if (address === null || typeof address === "string") throw new Error("No address");
  const client = await connect(new URL(`http://127.0.0.1:${address.port}/mcp`), "ignored");
  expect((await client.callTool({ name: "who" })).content).toEqual([{ type: "text", text: '\"middleware\"' }]);
});

it("disposes cooperative work when an HTTP client disconnects", async () => {
  let began!: () => void; const started = new Promise<void>((resolve) => { began = resolve; });
  let disposed!: () => void; const finished = new Promise<void>((resolve) => { disposed = resolve; });
  const registry = createRegistry().provide("lease", { resolve: () => 1, dispose: disposed });
  registry.action({ id: "wait", summary: "", surfaces: { mcp: true }, needs: ["lease"], run: async ({ signal }) => {
    began();
    await new Promise<void>((resolve) => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
    signal?.throwIfAborted(); return output(null);
  } });
  const listener = await listenMcpHttp(registry, { name: "disconnect", version: "1", authenticate: () => ({}) });
  cleanup.push(listener.close);
  const controller = new AbortController();
  const pending = fetch(listener.url, { method: "POST", signal: controller.signal,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait" } }),
  }).then(async (response) => response.text());
  const rejected = expect(pending).rejects.toThrow();
  await started; controller.abort(); await rejected; await finished;
});
