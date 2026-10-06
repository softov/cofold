import { describe, expect, it } from "vitest";
import { coerce, createRegistry, output, type Io } from "@cofold/commands";
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
    const plain = build();
    await plain.program.run(["note", "list", "--no-color"]);
    expect(plain.text()).toContain("id  title");

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

describe("a command that removes something", () => {
  function removing(confirm?: ((question: string) => Promise<boolean>) | false, effect: "remove" | "change" = "remove") {
    const err: string[] = [];
    const ran: string[] = [];
    const asked: string[] = [];
    const registry = createRegistry();
    registry.action({
      id: "pet.remove", summary: "Remove a pet", effect, resource: { kind: "pet", key: "id" },
      input: { id: { type: "string" } }, required: ["id"],
      surfaces: { cli: { pattern: ["pet", "remove", ":id"] } },
      run: (context) => { ran.push(context.value("id")); return output(null); },
    });
    const program = new Program({
      name: "petshop", version: "0", registry, readStdin: async () => "",
      io: { out: () => {}, err: (text) => { err.push(text); } },
      ...(confirm === undefined ? {} : {
        confirm: confirm === false ? false : async (question: string) => { asked.push(question); return confirm(question); },
      }),
    });
    return { program, ran, asked, errors: () => err.join("") };
  }

  it("asks first, and runs it on yes", async () => {
    const harness = removing(async () => true);
    expect(await harness.program.run(["pet", "remove", "7"])).toBe(0);
    expect(harness.asked).toEqual(["pet remove removes pet 7. Continue? [y/N] "]);
    expect(harness.ran).toEqual(["7"]);
  });

  it("does not run it on anything else, and says so", async () => {
    const harness = removing(async () => false);
    expect(await harness.program.run(["pet", "remove", "7"])).toBe(1);
    expect(harness.ran).toEqual([]);
    expect(harness.errors()).toBe("petshop: not run\n");
  });

  it("runs it without asking under --yes", async () => {
    const harness = removing(async () => false);
    expect(await harness.program.run(["pet", "remove", "7", "--yes"])).toBe(0);
    expect(harness.asked).toEqual([]);
    expect(harness.ran).toEqual(["7"]);
  });

  it("never asks before a command that does not remove", async () => {
    const harness = removing(async () => false, "change");
    expect(await harness.program.run(["pet", "remove", "7"])).toBe(0);
    expect(harness.asked).toEqual([]);
  });

  it("refuses without a terminal, naming --yes", async () => {
    const harness = removing(false);
    expect(await harness.program.run(["pet", "remove", "7"])).toBe(2);
    expect(harness.ran).toEqual([]);
    expect(harness.errors()).toBe("petshop: pet remove removes pet 7; pass --yes to run it without a terminal\n");
    expect(await removing(false).program.run(["pet", "remove", "7", "--yes"])).toBe(0);
  });

  it("refuses a program that declares --yes itself", () => {
    expect(() => new Program({
      name: "x", version: "0", registry: createRegistry(),
      globals: [{ name: "--yes", description: "Mine" }],
    })).toThrow(/--yes is a standard global option/u);
  });
});

describe("a command typed without its argument", () => {
  function typed() {
    const err: string[] = [];
    const registry = createRegistry();
    registry.register(
      registry.command({ id: "note.add", pattern: ["note", "add", ":text"], summary: "Add a note", run: () => output(null) }),
      registry.command({ id: "plugin.install", pattern: ["plugin", "install", ":name..."], summary: "Install", run: () => output(null) }),
    );
    const program = new Program({ name: "notes", version: "0", registry, io: { out: () => {}, err: (text) => { err.push(text); } } });
    return { program, errors: () => err.join("") };
  }

  it("names the argument and shows the usage", async () => {
    const harness = typed();
    expect(await harness.program.run(["note", "add"])).toBe(2);
    expect(harness.errors()).toBe("notes: \"note add\" needs text.\nUsage: notes note add <text>\n");
  });

  it("names a variadic argument the same way", async () => {
    const harness = typed();
    expect(await harness.program.run(["plugin", "install"])).toBe(2);
    expect(harness.errors()).toBe("notes: \"plugin install\" needs name.\nUsage: notes plugin install <name...>\n");
  });

  it("names the first command's argument when two share the words", async () => {
    const err: string[] = [];
    const registry = createRegistry();
    registry.register(
      registry.command({ id: "tag.one", pattern: ["tag", ":name"], summary: "One", run: () => output(null) }),
      registry.command({ id: "tag.two", pattern: ["tag", ":from", ":to"], summary: "Two", run: () => output(null) }),
    );
    const program = new Program({ name: "notes", version: "0", registry, io: { out: () => {}, err: (text) => { err.push(text); } } });
    expect(await program.run(["tag"])).toBe(2);
    expect(err.join("")).toContain("\"tag\" needs name.");
  });

  it("still calls a typo an unknown command, with its suggestion", async () => {
    const harness = typed();
    expect(await harness.program.run(["note", "ad"])).toBe(2);
    expect(harness.errors()).toContain("unknown command \"note ad\"");
    expect(harness.errors()).toContain("note add");
  });
});
