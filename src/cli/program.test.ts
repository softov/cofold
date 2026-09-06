import { describe, expect, it } from "vitest";
import { coerce, createRegistry, output, type Io } from "../index.js";
import { Program } from "./program.js";

function build() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (text) => { out.push(text); }, err: (text) => { err.push(text); } };

  const registry = createRegistry({ groups: [{ name: "work", title: "Work" }] })
    .provide("store", { resolve: () => [{ id: "1", title: "One" }, { id: "2", title: "Two" }] });

  registry.register(
    registry.command({
      id: "note.list",
      group: "work",
      pattern: ["note", "list"],
      summary: "List notes",
      needs: ["store"],
      options: [{ name: "--limit", value: "N", description: "How many", coerce: coerce.integer({ min: 1 }) }],
      run: (context) => output(context.store.slice(0, context.optional<number>("limit") ?? 10)),
    }),
    registry.command({
      id: "note.fail",
      group: "work",
      pattern: ["note", "fail"],
      summary: "Always fails",
      run: () => { throw new Error("nope"); },
    }),
  );

  const program = new Program({ name: "notes", version: "9.9.9", registry, io, readStdin: async () => "" });
  return { program, out, err, text: () => out.join(""), errors: () => err.join("") };
}

describe("a program", () => {
  it("answers --version and nothing else", async () => {
    const harness = build();
    expect(await harness.program.run(["--version"])).toBe(0);
    expect(harness.text()).toBe("9.9.9\n");
  });

  it("renders a table for a person and JSON for a machine", async () => {
    const human = build();
    await human.program.run(["note", "list", "--no-color"]);
    expect(human.text()).toContain("id  title");

    const machine = build();
    await machine.program.run(["note", "list", "--json"]);
    expect(JSON.parse(machine.text())).toEqual([{ id: "1", title: "One" }, { id: "2", title: "Two" }]);
  });

  it("prints identifiers for --quiet", async () => {
    const harness = build();
    await harness.program.run(["note", "list", "--quiet"]);
    expect(harness.text()).toBe("1\n2\n");
  });

  it("refuses --json with --quiet", async () => {
    const harness = build();
    expect(await harness.program.run(["note", "list", "--json", "--quiet"])).toBe(2);
  });

  it("answers an unknown command with a suggestion and exit 2", async () => {
    const harness = build();
    expect(await harness.program.run(["note", "lst"])).toBe(2);
    expect(harness.errors()).toContain('Did you mean "note list"');
  });

  it("shows help for a prefix that is not itself a command", async () => {
    const harness = build();
    await harness.program.run(["note", "--help", "--no-color"]);
    expect(harness.text()).toContain("notes note <command>");
    expect(harness.text()).toContain("note list");
  });

  it("lets a handler's failure escape, for the entry point to price", async () => {
    const harness = build();
    await expect(harness.program.run(["note", "fail"])).rejects.toThrow("nope");
  });

  it("serves completion candidates from the same registry", async () => {
    const harness = build();
    await harness.program.run(["__complete", "--", "note", ""]);
    expect(harness.text()).toBe("fail\nlist\n");
  });
});
