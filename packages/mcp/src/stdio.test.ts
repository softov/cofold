import type { StdioOptions } from "./types/stdio.js";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRegistry, output, ArgumentError } from "@doopx/commands";
import { serveStdio } from "./stdio.js";

/**
 * Two kinds of test, because there are two kinds of mistake.
 *
 * The harness drives the bytes directly, which is the only way to assert what
 * is *not* sent - no answer to a cancelled call, nothing on stdout that is not
 * a message. The last test drives the same server with the official SDK client,
 * which is the only way to know that a hand-written protocol is the protocol.
 */

interface Message { id?: number | string; result?: Record<string, unknown>; error?: { code: number; message: string }; method?: string; params?: Record<string, unknown> }

function harness(registry: Parameters<typeof serveStdio>[0], options: Partial<StdioOptions> = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const server = serveStdio(registry, { name: "test", version: "1", stdin, stdout, ...options });
  const queued: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];
  let buffer = "";
  stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let at = buffer.indexOf("\n");
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      at = buffer.indexOf("\n");
      if (line.trim() === "") continue;
      const message = JSON.parse(line) as Message;
      const next = waiting.shift();
      if (next === undefined) queued.push(message); else next(message);
    }
  });
  const send = (message: unknown): void => { stdin.write(`${JSON.stringify(message)}\n`); };
  /** Bytes that JSON.stringify would never produce, which is the point. */
  const raw = (text: string): void => { stdin.write(text); };
  const next = async (): Promise<Message> => {
    const ready = queued.shift();
    return ready ?? await new Promise<Message>((resolve) => waiting.push(resolve));
  };
  const initialize = async (): Promise<Message> => {
    send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const answer = await next();
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return answer;
  };
  return { server, send, raw, next, initialize, pending: () => queued.length };
}

function greeter() {
  const registry = createRegistry();
  registry.action({
    id: "note.add", summary: "Add a note", surfaces: { mcp: true },
    input: { title: { type: "string", minLength: 1 } }, required: ["title"],
    meta: { mcp: { name: "note_add", annotations: { readOnlyHint: false }, outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } } },
    run: ({ input }) => output({ title: input.title }),
  });
  return registry;
}

describe("the stdio server", () => {
  it("echoes a supported protocol version and advertises only tools", async () => {
    const { initialize, server } = harness(greeter());
    const answer = await initialize();
    expect(answer.result?.["protocolVersion"]).toBe("2025-06-18");
    expect(answer.result?.["capabilities"]).toEqual({ tools: {} });
    expect(answer.result?.["serverInfo"]).toEqual({ name: "test", version: "1" });
    server.close();
  });

  it("falls back to its newest version when the client asks for one it does not know", async () => {
    const { send, next, server } = harness(greeter());
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect((await next()).result?.["protocolVersion"]).toBe("2025-11-25");
    server.close();
  });

  it("refuses everything except initialize and ping before initialization", async () => {
    const { send, next, server } = harness(greeter());
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((await next()).error?.code).toBe(-32600);
    send({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect((await next()).result).toEqual({});
    server.close();
  });

  it("publishes the declared contract, explicit name included", async () => {
    const { initialize, send, next, server } = harness(greeter());
    await initialize();
    send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const listed = (await next()).result?.["tools"] as Record<string, unknown>[];
    expect(listed[0]?.["name"]).toBe("note_add");
    expect(listed[0]?.["annotations"]).toEqual({ readOnlyHint: false });
    expect((listed[0]?.["inputSchema"] as { required: string[] }).required).toEqual(["title"]);
    server.close();
  });

  it("answers a call with text and structured content, and refuses bad input readably", async () => {
    const { initialize, send, next, server } = harness(greeter());
    await initialize();
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "note_add", arguments: { title: "hello" } } });
    const good = await next();
    expect(good.result?.["structuredContent"]).toEqual({ title: "hello" });
    expect(good.result?.["content"]).toEqual([{ type: "text", text: JSON.stringify({ title: "hello" }, null, 2) }]);
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "note_add", arguments: { title: "" } } });
    const bad = await next();
    expect(bad.result?.["isError"]).toBe(true);
    expect(JSON.stringify(bad.result)).toMatch(/title/u);
    server.close();
  });

  it("separates a protocol fault from a tool that refused", async () => {
    const registry = createRegistry();
    registry.action({ id: "boom", summary: "", surfaces: { mcp: true }, run: () => { throw new Error("secret token"); } });
    registry.action({ id: "nope", summary: "", surfaces: { mcp: true }, run: () => { throw new ArgumentError("say which one"); } });
    const onDiagnostic = vi.fn();
    const { initialize, send, next, server } = harness(registry, { onDiagnostic });
    await initialize();
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "missing" } });
    expect((await next()).error?.code).toBe(-32602);
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "boom" } });
    const hidden = await next();
    expect(hidden.result?.["isError"]).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain("secret token");
    expect(onDiagnostic).toHaveBeenCalled();
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope" } });
    expect(JSON.stringify((await next()).result)).toContain("say which one");
    send({ jsonrpc: "2.0", id: 4, method: "resources/list" });
    expect((await next()).error?.code).toBe(-32601);
    server.close();
  });

  it("reports a broken stream without answering as though it were a call", async () => {
    const { initialize, send, raw, next, server } = harness(greeter());
    await initialize();
    raw("{ this is not json\n");
    const parsed = await next();
    expect(parsed.error?.code).toBe(-32700);
    expect(parsed.id).toBe(null);
    // Valid JSON that is not a JSON-RPC object is a different fault.
    send("a bare string");
    expect((await next()).error?.code).toBe(-32600);
    // Blank lines are framing, not messages.
    raw("\n\n");
    send({ jsonrpc: "2.0", id: 9, method: "ping" });
    expect((await next()).id).toBe(9);
    server.close();
  });

  it("gives up on a message that never ends rather than buffering it", async () => {
    const { initialize, raw, next, server } = harness(greeter(), { maxMessageBytes: 64 });
    await initialize();
    raw("x".repeat(200));
    const parsed = await next();
    expect(parsed.error?.code).toBe(-32700);
    expect(parsed.error?.message).toMatch(/maximum size/u);
    server.close();
  });

  it("cancels one call, answers nothing for it, and stays healthy", async () => {
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    let disposed!: () => void;
    const released = new Promise<void>((resolve) => { disposed = resolve; });
    const registry = createRegistry().provide("lease", { resolve: () => 1, dispose: disposed });
    registry.action({ id: "wait", summary: "", surfaces: { mcp: true }, needs: ["lease"], run: async ({ signal }) => {
      began();
      await new Promise<void>((resolve) => { signal?.addEventListener("abort", () => resolve(), { once: true }); });
      signal?.throwIfAborted();
      return output(null);
    } });
    registry.action({ id: "ping_tool", summary: "", surfaces: { mcp: true }, run: () => output("alive") });
    const { initialize, send, next, server, pending } = harness(registry);
    await initialize();
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait" } });
    await started;
    send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } });
    await released;
    // The next answer is the second call's, which proves the first was never answered.
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ping_tool" } });
    const answer = await next();
    expect(answer.id).toBe(2);
    expect(pending()).toBe(0);
    server.close();
  });

  it("emits progress only for a client that asked, and rejects progress that goes backwards", async () => {
    const registry = createRegistry();
    registry.action({ id: "work", summary: "", surfaces: { mcp: true }, run: async ({ request }) => {
      await request?.progress?.({ progress: 1, total: 2, message: "half" });
      const backwards = await request?.progress?.({ progress: 0 }).then(() => null, (error: Error) => error);
      return output({ refused: backwards?.message ?? null });
    } });
    const { initialize, send, next, server } = harness(registry);
    await initialize();
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "work", _meta: { progressToken: "p1" } } });
    const notification = await next();
    expect(notification.method).toBe("notifications/progress");
    expect(notification.params).toEqual({ progressToken: "p1", progress: 1, total: 2, message: "half" });
    expect(JSON.stringify((await next()).result)).toMatch(/must increase/u);
    // No token this time, so the only message is the answer itself.
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "work" } });
    expect((await next()).id).toBe(2);
    server.close();
  });

  it("runs calls concurrently rather than head of line", async () => {
    const registry = createRegistry();
    registry.action({ id: "slow", summary: "", surfaces: { mcp: true }, run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return output("slow");
    } });
    registry.action({ id: "fast", summary: "", surfaces: { mcp: true }, run: () => output("fast") });
    const { initialize, send, next, server } = harness(registry);
    await initialize();
    send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "slow" } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "fast" } });
    expect((await next()).id).toBe(2);
    expect((await next()).id).toBe(1);
    server.close();
  });

  it("closes when stdin ends, and aborts what was still running", async () => {
    let disposed!: () => void;
    const released = new Promise<void>((resolve) => { disposed = resolve; });
    const registry = createRegistry().provide("lease", { resolve: () => 1, dispose: disposed });
    registry.action({ id: "wait", summary: "", surfaces: { mcp: true }, needs: ["lease"], run: async ({ signal }) => {
      await new Promise<void>((resolve) => { signal?.addEventListener("abort", () => resolve(), { once: true }); });
      signal?.throwIfAborted();
      return output(null);
    } });
    const stdin = new PassThrough();
    const server = serveStdio(registry, { name: "t", version: "1", stdin, stdout: new PassThrough() });
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} })}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait" } })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.end();
    await server.closed;
    await released;
  });
});

describe("conformance", () => {
  it("is driven by the official SDK client as a subprocess", async () => {
    const client = new Client({ name: "conformance", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../../../examples/commands/dist/mcp-server/stdio.js", import.meta.url))],
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe("doopx-example");
      const listed = await client.listTools();
      expect(listed.tools[0]?.name).toBe("greet");
      expect(listed.tools[0]?.annotations?.readOnlyHint).toBe(true);
      expect(listed.tools[0]?.outputSchema?.type).toBe("object");
      const result = await client.callTool({ name: "greet", arguments: { name: "Doopx" } });
      expect(result.structuredContent).toEqual({ greeting: "Hello, Doopx" });
      expect((await client.callTool({ name: "greet", arguments: { name: "" } })).isError).toBe(true);
      await expect(client.callTool({ name: "absent" })).rejects.toThrow();
      // Still answering after a refusal and a protocol error: stdout was never corrupted.
      expect(await client.ping()).toEqual({});
    } finally {
      await client.close();
    }
  }, 20_000);
});
