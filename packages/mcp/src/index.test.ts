import { describe, expect, it } from "vitest";
import { ArgumentError, coerce, createRegistry, output } from "@cofold/commands";
import { callTool, listTools, tools } from "./index.js";

function build() {
  const registry = createRegistry().provide("store", { resolve: () => [{ id: "1" }] });
  registry.register(
    registry.command({
      id: "note.list",
      pattern: ["note", "list"],
      summary: "List notes",
      needs: ["store"],
      surfaces: { mcp: true },
      options: [
        { name: "--limit", value: "N", description: "How many", coerce: coerce.integer({ min: 1 }), default: 20 },
        { name: "--tag", value: "TAG", description: "Tags", repeatable: true },
      ],
      run: (context) => output({ notes: context.store, limit: context.value("limit"), tags: context.list("tag") }),
    }),
    registry.command({
      id: "note.destroy",
      pattern: ["note", "destroy"],
      summary: "Delete everything",
      run: () => output(null),
    }),
    registry.command({
      id: "note.strict",
      pattern: ["note", "strict", ":id"],
      summary: "Refuses politely",
      surfaces: { mcp: true },
      run: () => { throw new ArgumentError("id must be a number"); },
    }),
  );
  return registry;
}

describe("the MCP surface", () => {
  it("exposes only what opted in", () => {
    expect(tools(build()).map((tool) => tool.name)).toEqual(["note_list", "note_strict"]);
  });

  it("builds an input schema from the same declaration the CLI parses", () => {
    const [tool] = listTools(build()).tools;
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, description: "How many", default: 20 },
        tag: { type: "array", items: { type: "string" }, description: "Tags" },
      },
    });
  });

  it("runs the command and answers with its data", async () => {
    const result = await callTool(build(), "note_list", { limit: 5, tag: ["x"] });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ notes: [{ id: "1" }], limit: 5, tags: ["x"] });
  });

  it("hands back a refusal the agent can act on, rather than throwing", async () => {
    const result = await callTool(build(), "note_strict", { id: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("id must be a number");
  });

  it("refuses to name a tool that was never exposed", async () => {
    await expect(callTool(build(), "note_destroy", {})).rejects.toThrow(/No tool called/u);
  });
});

describe("tool identities", () => {
  it("rejects names that collide after normalization", () => {
    const registry = createRegistry();
    for (const id of ["a.b", "a_b"]) registry.action({ id, summary: "", surfaces: { mcp: true }, run: () => output(null) });
    expect(() => listTools(registry)).toThrow(/Two MCP tools/);
  });
  it("keeps explicit names and refuses unsupported output schemas", () => {
    const registry = createRegistry();
    registry.action({ id: "a", summary: "", surfaces: { mcp: true }, meta: { mcp: { name: "advisor_case_show" } }, run: () => output(null) });
    expect(listTools(registry).tools[0]?.name).toBe("advisor_case_show");
    registry.action({ id: "b", summary: "", surfaces: { mcp: true }, meta: { mcp: { outputSchema: { type: "object", ...{ $ref: "#/x" } } } }, run: () => output(null) });
    expect(() => listTools(registry)).toThrow(/\$ref/);
  });
});
