import { CallToolResultSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRegistry, output, AuthorizationError } from "@facio/commands";
import { createMcpServer, type McpServerOptions } from "./server.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });
async function connect(registry: ReturnType<typeof createRegistry>, options: Partial<McpServerOptions> = {}) {
  const server = createMcpServer(registry, { name: "test", version: "1", ...options });
  const client = new Client({ name: "test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left); await client.connect(right);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return { client, server };
}
function registry() {
  const reg = createRegistry();
  reg.action({ id: "note.add", summary: "Add", surfaces: { mcp: true }, input: { title: { type: "string", minLength: 1 } }, required: ["title"],
    meta: { mcp: { name: "legacy_add", outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] }, annotations: { destructiveHint: false } } },
    run: ({ input }) => output({ title: input.title }) });
  return reg;
}
describe("SDK server", () => {
  it("initializes, lists contracts, validates input, and returns structured output", async () => {
    const { client } = await connect(registry());
    const list = await client.listTools();
    expect(list.tools[0]?.name).toBe("legacy_add");
    expect(list.tools[0]?.annotations?.destructiveHint).toBe(false);
    expect(list.tools[0]?.outputSchema?.type).toBe("object");
    const result = await client.callTool({ name: "legacy_add", arguments: { title: "hello" } });
    expect(result.structuredContent).toEqual({ title: "hello" });
    const bad = await client.callTool({ name: "legacy_add", arguments: { title: "" } });
    expect(bad.isError).toBe(true);
    await expect(client.callTool({ name: "missing" })).rejects.toThrow(/Unknown or unavailable/);
  });
  it("refuses hidden tools even when the caller guesses their name", async () => {
    const { client } = await connect(registry(), { visible: () => false });
    expect((await client.listTools()).tools).toEqual([]);
    await expect(client.callTool({ name: "legacy_add", arguments: { title: "x" } })).rejects.toThrow(/unavailable/);
  });
  it("enforces transitive scope checks before opening capabilities", async () => {
    const opened = vi.fn();
    const reg = createRegistry({ authorize: ({ scopes, context }) => {
      expect(scopes).toEqual(["admin"]);
      expect(context.request?.actor).toBe("reader");
      throw new AuthorizationError("Forbidden", scopes);
    } }).provide("db", { scopes: ["admin"], resolve: opened }).provide("service", { deps: ["db"], resolve: () => 1 });
    reg.action({ id: "write", summary: "", needs: ["service"], surfaces: { mcp: true }, run: () => output(null) });
    const { client } = await connect(reg, { context: () => ({ actor: "reader" }) });
    expect((await client.callTool({ name: "write" })).isError).toBe(true);
    expect(opened).not.toHaveBeenCalled();
  });
  it("preserves a committed mutation when observers and disposal fail", async () => {
    let mutations = 0;
    const diagnostics = vi.fn();
    const reg = createRegistry().provide("db", { resolve: () => 1, dispose: () => { throw new Error("cleanup"); } });
    reg.action({ id: "write", summary: "", needs: ["db"], surfaces: { mcp: true }, run: () => output(++mutations) });
    const { client } = await connect(reg, { onSuccess: () => { throw new Error("notify"); }, onDiagnostic: diagnostics });
    const result = await client.callTool({ name: "write" });
    expect(result.isError).not.toBe(true); expect(mutations).toBe(1); expect(diagnostics).toHaveBeenCalledTimes(2);
  });
  it("does not invite a retry when a completed action has invalid output", async () => {
    const reg = createRegistry();
    const observed = vi.fn();
    reg.action({ id: "bad", summary: "", surfaces: { mcp: true }, meta: { mcp: { outputSchema: { type: "object", required: ["id"] } } }, run: () => output({}) });
    const { client } = await connect(reg, { onSuccess: observed });
    const result = await client.callTool({ name: "bad" });
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("Do not retry"); expect(observed).toHaveBeenCalledOnce();
  });
  it("encodes rich results and sanitizes unexpected handler failures", async () => {
    const reg = createRegistry();
    reg.action({ id: "image", summary: "", surfaces: { mcp: true }, run: () => output("AA==") });
    reg.action({ id: "fail", summary: "", surfaces: { mcp: true }, run: () => { throw new Error("secret token"); } });
    const { client } = await connect(reg, { encodeResult: ({ data }) => ({ content: [{ type: "image", data: String(data), mimeType: "image/png" }] }) });
    expect((await client.callTool({ name: "image" })).content).toEqual([{ type: "image", data: "AA==", mimeType: "image/png" }]);
    expect(JSON.stringify(await client.callTool({ name: "fail" }))).not.toContain("secret token");
  });
  it("delivers progress and cancels only the targeted invocation", async () => {
    let began!: () => void; const started = new Promise<void>((resolve) => { began = resolve; });
    let disposed!: () => void; const finished = new Promise<void>((resolve) => { disposed = resolve; });
    const reg = createRegistry().provide("lease", { resolve: () => 1, dispose: disposed });
    reg.action({ id: "wait", summary: "", surfaces: { mcp: true }, needs: ["lease"], run: async ({ signal, request }) => {
      await request?.progress?.({ progress: 1, total: 2 }); began();
      await new Promise<void>((resolve) => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
      signal?.throwIfAborted(); return output(null);
    } });
    reg.action({ id: "ping", summary: "", surfaces: { mcp: true }, run: () => output("alive") });
    const { client } = await connect(reg);
    const controller = new AbortController(); const progress = vi.fn();
    const pending = client.callTool({ name: "wait" }, undefined, { signal: controller.signal, onprogress: progress });
    const rejected = expect(pending).rejects.toThrow();
    await started; controller.abort(); await rejected; await finished;
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ progress: 1 }));
    expect((await client.callTool({ name: "ping" })).isError).not.toBe(true);
  });
  it("serves authorized resources, templates and prompts without inventing actions", async () => {
    const { client } = await connect(createRegistry(), {
      resources: [{ resource: { name: "hidden", uri: "test://hidden" }, visible: () => false, read: () => ({ contents: [] }) }],
      resourceTemplates: [{ resource: { name: "notes", uriTemplate: "test://notes/{id}" }, read: (uri, vars) => ({ contents: [{ uri, text: String(vars.id) }] }) }],
      prompts: [{ prompt: { name: "review", arguments: [{ name: "subject", required: true }] }, get: (args) => ({ messages: [{ role: "user", content: { type: "text", text: args.subject! } }] }) }],
    });
    expect((await client.listResources()).resources).toEqual([]);
    await expect(client.readResource({ uri: "test://hidden" })).rejects.toThrow(/unavailable/);
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(1);
    expect((await client.readResource({ uri: "test://notes/42" })).contents[0]).toMatchObject({ text: "42" });
    expect((await client.listPrompts()).prompts).toHaveLength(1);
    await expect(client.getPrompt({ name: "review" })).rejects.toThrow(/Invalid prompt arguments/);
    expect((await client.getPrompt({ name: "review", arguments: { subject: "hello" } })).messages[0]?.content).toMatchObject({ text: "hello" });
  });
});


describe("protocol boundaries", () => {
  it("rejects task execution before a mutation starts", async () => {
    let count = 0;
    const reg = createRegistry();
    reg.action({ id: "write", summary: "", surfaces: { mcp: true }, run: () => output(++count) });
    const { client } = await connect(reg);
    await expect(client.request({ method: "tools/call", params: { name: "write", task: {} } }, CallToolResultSchema)).rejects.toThrow(/does not support task creation|Task execution is not supported/);
    expect(count).toBe(0);
  });
  it("runs a real Zod refinement without changing the published field schemas", async () => {
    const reg = createRegistry();
    reg.action({ id: "range", summary: "", surfaces: { mcp: true }, input: { start: { type: "integer" }, end: { type: "integer" } }, required: ["start", "end"],
      refine: z.object({ start: z.number(), end: z.number() }).refine((value) => value.end >= value.start, "End precedes start"),
      run: ({ input }) => output(input),
    });
    const { client } = await connect(reg);
    expect((await client.callTool({ name: "range", arguments: { start: 10, end: 1 } })).isError).toBe(true);
    expect((await client.callTool({ name: "range", arguments: { start: 1, end: 10 } })).isError).not.toBe(true);
  });
  it("sanitizes context and policy errors", async () => {
    const { client } = await connect(registry(), { visible: () => { throw new Error("secret credential"); } });
    await expect(client.listTools()).rejects.toThrow(/Tool visibility could not be resolved/);
    const other = await connect(registry(), { context: () => { throw new Error("secret credential"); } });
    await expect(other.client.listTools()).rejects.toThrow(/Request context could not be resolved/);
  });
  it("sends an explicit list-change notification on its own connection", async () => {
    const { client, server } = await connect(registry(), { toolListChanged: true });
    const received = new Promise<void>((resolve) => client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()));
    await server.sendToolListChanged(); await received;
  });
});
