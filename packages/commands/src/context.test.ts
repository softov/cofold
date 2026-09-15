/**
 * What a handler is given, and the one place it answers.
 *
 * The context is the whole reason a handler is transport-blind, so what it
 * promises has to hold whichever surface built it: a result is returned rather
 * than printed, stdin is read once, and a value is read by its canonical name
 * and not by the spelling some surface used.
 */

import type { Command } from "./types/command.js";
import type { Io } from "./types/context.js";
import { describe, expect, it } from "vitest";
import { BaseContext, output, RESERVED_CONTEXT_KEYS, silentIo } from "./context.js";

const command = { id: "note.add", pattern: ["note", "add"], summary: "Add", run: () => {} } as Command;

function build(input: Record<string, unknown> = {}, io: Io = silentIo): BaseContext {
  return new BaseContext({ command, commands: [command], surface: "cli", input, io });
}

describe("an output", () => {
  it("carries the three readings of one result, and omits the ones nobody gave", () => {
    expect(output({ id: 1 })).toEqual({ data: { id: 1 } });
    expect(output({ id: 1 }, "one note", 1)).toEqual({ data: { id: 1 }, plain: "one note", quiet: 1 });
  });

  /*
   * A function, so a rendering nobody will read is never built: `--json` and an
   * MCP call both want the data and neither wants the table.
   */
  it("takes a rendering as a function, and does not call it", () => {
    let called = 0;
    const value = output(null, () => { called += 1; return "x"; });
    expect(typeof value.plain).toBe("function");
    expect(called).toBe(0);
  });
});

describe("reading the canonical input", () => {
  it("answers by the canonical name, whatever surface produced it", () => {
    const context = build({ limit: 5, dryRun: true, tags: ["a", "b"] });
    expect(context.value<number>("limit")).toBe(5);
    expect(context.optional("missing")).toBeUndefined();
    expect(context.flag("dryRun")).toBe(true);
    expect(context.flag("missing")).toBe(false);
    expect(context.list("tags")).toEqual(["a", "b"]);
  });

  /*
   * A repeatable option is a list of one when it was given once. Handing a
   * handler a bare string there would make `list()` the only call that has to
   * be written twice.
   */
  it("reads a single value as a list of one, and a missing one as empty", () => {
    expect(build({ tags: "solo" }).list("tags")).toEqual(["solo"]);
    expect(build().list("tags")).toEqual([]);
  });

  it("builds an object out of repeated KEY=VALUE, however the pair arrived", () => {
    expect(build({ set: ["a=1", "b=2"] }).pairs("set")).toEqual({ a: "1", b: "2" });
    expect(build({ set: [["a", "1"]] }).pairs("set")).toEqual({ a: "1" });
    expect(() => build({ set: ["nope"] }).pairs("set")).toThrow("set must be KEY=VALUE");
  });

  it("faults a required field by its own name", () => {
    expect(() => build({}).required("url")).toThrow("url is required");
    expect(() => build({ url: "" }).required("url")).toThrow("url is required");
    expect(build({ url: "http://x" }).required("url")).toBe("http://x");
  });
});

describe("answering", () => {
  it("collects the result rather than printing it, for a surface that returns", () => {
    const context = build();
    context.out(output({ id: 1 }));
    expect(context.collected).toEqual({ data: { id: 1 } });
  });

  it("writes straight through for the commands whose output is the payload", () => {
    const out: string[] = [];
    const err: string[] = [];
    const context = build({}, { out: (text) => { out.push(text); }, err: (text) => { err.push(text); } });
    context.write("raw");
    context.error("went wrong");
    context.error("already ended\n");
    expect(out.join("")).toBe("raw");
    expect(err).toEqual(["went wrong\n", "already ended\n"]);
  });

  it("reads stdin once, however many times it is asked for", async () => {
    let reads = 0;
    const context = new BaseContext({
      command,
      commands: [command],
      surface: "cli",
      input: {},
      io: silentIo,
      readStdin: async () => { reads += 1; return "piped"; },
    });
    expect(await context.stdin()).toBe("piped");
    expect(await context.stdin()).toBe("piped");
    expect(reads).toBe(1);
  });

  it("reads nothing when nobody piped anything", async () => {
    expect(await build().stdin()).toBe("");
  });
});

describe("the names a capability may not take", () => {
  /*
   * Capabilities are merged into the context so a handler can say
   * `context.store`, and the price of that is a small list of names they cannot
   * have. The list is the contract, so it is worth one assertion: a provider
   * called `input` would shadow the canonical input and the failure would look
   * like the parser had broken.
   */
  it("names every accessor the context itself owns, and nothing else", () => {
    const context = build();
    for (const key of RESERVED_CONTEXT_KEYS) {
      expect(key in context, `${key} is reserved but the context does not have it`).toBe(true);
    }
    const own = [
      ...Object.keys(context),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(context) as object),
    ].filter((key) => key !== "constructor" && key !== "collected");
    expect([...RESERVED_CONTEXT_KEYS].sort()).toEqual([...new Set(own)].sort());
  });
});
