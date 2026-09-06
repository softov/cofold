/**
 * One declaration, read as a command.
 *
 * `commandFor` is where an action's fields become slots and options, and it is
 * the only place a spelling is invented. Everything it derives - a flag name, a
 * placeholder, which fields are positional, what a surface is handed - is a
 * decision nobody restates, so each of them is pinned here rather than left to
 * be discovered through whichever example happened to exercise it.
 */

import { describe, expect, it } from "vitest";
import {
  commandFor,
  commandPattern,
  fieldNameOf,
  isFlag,
  literalPrefix,
  optionNotes,
  optionsOf,
  parsePattern,
  surfaceEnabled,
  underPrefix,
  visible,
  type Command,
  type Field,
} from "./command.js";

function build(overrides: Partial<Parameters<typeof commandFor>[0]> = {}): Command {
  return commandFor({
    id: "pet.add",
    summary: "Add a pet",
    input: {
      name: { type: "string", minLength: 1, description: "What it answers to" },
      dryRun: { type: "boolean", description: "Say what would happen" },
    },
    required: ["name"],
    surfaces: { cli: { pattern: ["pet", "add", ":name"] } },
    run: () => {},
    ...overrides,
  } as Parameters<typeof commandFor>[0]);
}

const optionNamed = (command: Command, name: string) =>
  optionsOf(command).find((option) => option.name === name);

describe("fields become slots and options", () => {
  it("makes a field the pattern names a slot, and every other field an option", () => {
    const command = build();
    expect(Object.keys(command.arguments ?? {})).toEqual(["name"]);
    expect(optionsOf(command).map((option) => option.name)).toEqual(["--dry-run"]);
  });

  it("refuses a pattern that names a field nobody declared", () => {
    expect(() => build({ surfaces: { cli: { pattern: ["pet", "add", ":nickname"] } } }))
      .toThrow("the pattern names :nickname");
  });

  /*
   * The flag is derived so it cannot disagree with the field. A field spelled
   * once and a flag spelled again is two names for one thing, and the second
   * one is the one that goes stale.
   */
  it("derives the flag from the field name, and keeps the canonical name on it", () => {
    const option = optionNamed(build(), "--dry-run")!;
    expect(fieldNameOf(option)).toBe("dryRun");
  });

  it("takes a spelling where one is given, and never lets it change the shape", () => {
    const command = build({
      input: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag it",
          cli: { flag: "--tag", short: "-t", value: "TAG" },
        },
      },
      required: [],
      surfaces: { cli: { pattern: ["pet", "add"] } },
    });
    const option = optionNamed(command, "--tag")!;
    expect(option.short).toBe("-t");
    expect(option.value).toBe("TAG");
    expect(option.repeatable).toBe(true);
    expect(fieldNameOf(option)).toBe("tags");
  });

  /*
   * A boolean has no value to take, and that absence is what the parser reads
   * as a flag - so a `value` invented for one would make `--dry-run true` the
   * only accepted form.
   */
  it("gives a boolean no placeholder, which is what makes it a flag", () => {
    expect(isFlag(optionNamed(build(), "--dry-run")!)).toBe(true);
  });

  it("carries a default, a requirement and an environment variable onto the option", () => {
    const command = build({
      input: {
        limit: { type: "integer", minimum: 1, default: 20, description: "How many", env: "PETS_LIMIT" },
        url: { type: "string", description: "Where", cli: { hidden: true } },
      },
      required: ["limit"],
      surfaces: { cli: { pattern: ["pet", "add"] } },
    });
    const limit = optionNamed(command, "--limit")!;
    expect(limit.default).toBe(20);
    expect(limit.required).toBe(true);
    expect(limit.env).toBe("PETS_LIMIT");
    expect(visible(optionsOf(command)).map((option) => option.name)).toEqual(["--limit"]);
  });

  it("keeps the item's rules on a list, not the list's", () => {
    const command = build({
      input: { tags: { type: "array", items: { type: "string", maxLength: 4 }, description: "" } },
      required: [],
      surfaces: { cli: { pattern: ["pet", "add"] } },
    });
    expect(optionNamed(command, "--tags")!.coerce?.schema).toEqual({ type: "string", maxLength: 4 });
  });
});

describe("what each surface is handed", () => {
  /*
   * `cli` is a spelling and nothing else, so it must not reach an agent: a
   * model shown `"cli": { "short": "-a" }` has been told about a terminal it
   * will never type into.
   */
  it("strips the terminal spelling out of the schema", () => {
    const command = build({
      input: { age: { type: "integer", minimum: 0, description: "How old", cli: { short: "-a" } } },
      required: [],
      surfaces: { cli: { pattern: ["pet", "add"] } },
    });
    expect(optionNamed(command, "--age")!.coerce?.schema).toEqual({
      type: "integer",
      minimum: 0,
      description: "How old",
    });
  });

  it("turns presence into the surface flags, and absence into off", () => {
    const both = build({ surfaces: { cli: { pattern: ["pet", "add", ":name"] }, mcp: true } });
    expect(surfaceEnabled(both, "cli")).toBe(true);
    expect(surfaceEnabled(both, "mcp")).toBe(true);

    const agentOnly = build({ surfaces: { mcp: true } });
    expect(surfaceEnabled(agentOnly, "cli")).toBe(false);
    expect(surfaceEnabled(agentOnly, "docs")).toBe(false);
  });

  /*
   * An action with no command line still needs a pattern, because a pattern is
   * how everything else addresses a command. Nothing matches it: the parser is
   * never offered the words of a command whose `cli` surface is off.
   */
  it("gives an action with no command line an id-shaped pattern", () => {
    expect(build({ surfaces: { mcp: true } }).pattern).toEqual(["pet", "add"]);
  });

  it("hands a surface's own configuration to that surface, under its own key", () => {
    const command = build({
      surfaces: { cli: { pattern: ["pet", "add", ":name"] }, http: { method: "POST", path: "/pets" } },
    } as never);
    expect((command.meta as { http?: unknown }).http).toEqual({ method: "POST", path: "/pets" });
  });
});

describe("reading a pattern", () => {
  it("tells a literal from a slot, and an optional or variadic one from a plain one", () => {
    expect(parsePattern(["note", ":id", ":tags?...", ":at?"])).toEqual([
      { kind: "literal", word: "note" },
      { kind: "slot", name: "id", optional: false, variadic: false },
      { kind: "slot", name: "tags", optional: true, variadic: true },
      { kind: "slot", name: "at", optional: true, variadic: false },
    ]);
  });

  it("writes a usage line a person can read back", () => {
    expect(commandPattern({ pattern: ["note", ":id", ":tags?..."] } as unknown as Command))
      .toBe("note <id> [tags...]");
  });

  it("is under a prefix only when every word of the prefix is one of its own literals", () => {
    const command = build();
    expect(literalPrefix(command)).toEqual(["pet", "add"]);
    expect(underPrefix(command, ["pet"])).toBe(true);
    expect(underPrefix(command, ["pet", "add"])).toBe(true);
    expect(underPrefix(command, ["pets"])).toBe(false);
  });
});

describe("what an option is worth telling somebody", () => {
  it("names the facts help has to show, and only the ones that are there", () => {
    const withAll = build({
      input: { status: { type: "string", enum: ["open", "done"], default: "open", env: "S", description: "" } },
      required: ["status"],
      surfaces: { cli: { pattern: ["pet", "add"] } },
    });
    const notes = optionNotes(optionNamed(withAll, "--status")!).map((note) => note.kind);
    expect(notes).toEqual(expect.arrayContaining(["required", "default", "env", "candidates"]));

    expect(optionNotes({ name: "--x", description: "", value: "V" })).toEqual([]);
  });
});

describe("a field is a schema, and TypeScript reads it as one", () => {
  /*
   * Not a runtime check: the point of the schema being the declaration is that
   * the compiler is one more surface reading it. If these stop holding, the
   * handler's `input` has stopped being typed by the schemas that produced it.
   */
  it("types a field from its own schema", () => {
    const _fields = {
      name: { type: "string" },
      breed: { type: "string", enum: ["beagle", "corgi"] },
    } as const satisfies Record<string, Field>;

    type Input = import("./command.js").InputOf<typeof _fields, ["name"]>;
    const held: Input = { name: "Rex" };
    expect(held.name).toBe("Rex");
    // @ts-expect-error breed is not required, so it may be absent
    const _absent: string = held.breed;
    // @ts-expect-error and it is the union the enum named, not any string
    const _wrong: Input = { name: "Rex", breed: "poodle" };
  });
});
