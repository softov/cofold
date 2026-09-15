/**
 * What the subset reads, and what it refuses to guess at.
 *
 * The refusals matter as much as the readings. A hand-written YAML parser is a
 * liability exactly to the extent that it accepts a document and reads it
 * differently from a real one, so anything outside the subset has to fault by
 * name rather than be quietly mangled.
 */

import { describe, expect, it } from "vitest";
import { parseYaml, YamlError } from "./yaml.js";

describe("block structure", () => {
  it("reads nested mappings", () => {
    expect(parseYaml("a:\n  b:\n    c: 1\n")).toEqual({ a: { b: { c: 1 } } });
  });

  it("reads a sequence indented under its key", () => {
    expect(parseYaml("run:\n  - one\n  - two\n")).toEqual({ run: ["one", "two"] });
  });

  it("reads a sequence at its key's own column, which YAML allows", () => {
    expect(parseYaml("run:\n- one\n- two\n")).toEqual({ run: ["one", "two"] });
  });

  it("reads a mapping whose first key sits on the dash", () => {
    const text = [
      "run:",
      "  - exec:",
      "      command: ./build.sh",
      "      args: [one]",
      "  - rest:",
      "      method: POST",
    ].join("\n");
    expect(parseYaml(text)).toEqual({
      run: [
        { exec: { command: "./build.sh", args: ["one"] } },
        { rest: { method: "POST" } },
      ],
    });
  });

  it("keeps the sibling keys of a dash-opened mapping in that mapping", () => {
    expect(parseYaml("- when: force\n  value: x\n")).toEqual([{ when: "force", value: "x" }]);
  });

  it("reads a key with nothing after it as null", () => {
    expect(parseYaml("a:\nb: 1\n")).toEqual({ a: null, b: 1 });
  });
});

describe("scalars", () => {
  it("reads the types a document needs", () => {
    expect(parseYaml("i: 3\nf: 1.5\nt: true\nf2: false\nn: null\nu: ~\ns: hello\n")).toEqual({
      i: 3, f: 1.5, t: true, f2: false, n: null, u: null, s: "hello",
    });
  });

  it("leaves a version alone rather than reading it as a number", () => {
    expect(parseYaml("version: 1.0.0\n")).toEqual({ version: "1.0.0" });
  });

  it("keeps a colon that is not followed by a space inside the value", () => {
    expect(parseYaml("endpoint: http://host/path\n")).toEqual({ endpoint: "http://host/path" });
  });

  it("reads quoted text as text", () => {
    expect(parseYaml("a: \"3\"\nb: 'true'\n")).toEqual({ a: "3", b: "true" });
  });

  it("reads the escapes it documents", () => {
    expect(parseYaml("a: \"one\\ntwo\"\nb: 'it''s'\n")).toEqual({ a: "one\ntwo", b: "it's" });
  });

  it("drops a comment but not a hash inside a value", () => {
    expect(parseYaml("a: 1 # the count\nb: \"x # y\"\n")).toEqual({ a: 1, b: "x # y" });
  });
});

describe("flow collections", () => {
  it("reads a flow sequence", () => {
    expect(parseYaml("enum: [staging, production]\n")).toEqual({ enum: ["staging", "production"] });
  });

  it("reads a flow mapping", () => {
    expect(parseYaml("cli: { short: -e, value: ENV }\n")).toEqual({ cli: { short: "-e", value: "ENV" } });
  });

  it("reads a flow mapping as a sequence item", () => {
    expect(parseYaml("args:\n  - { when: force, value: \"--force\" }\n")).toEqual({
      args: [{ when: "force", value: "--force" }],
    });
  });

  it("reads them nested", () => {
    expect(parseYaml("a: [{ b: 1 }, [2, 3]]\n")).toEqual({ a: [{ b: 1 }, [2, 3]] });
  });

  it("reads an empty collection", () => {
    expect(parseYaml("a: []\nb: {}\n")).toEqual({ a: [], b: {} });
  });
});

describe("what it refuses", () => {
  const refuses = (text: string, message: string): void => {
    expect(() => parseYaml(text)).toThrow(YamlError);
    expect(() => parseYaml(text)).toThrow(message);
  };

  it("refuses anchors and aliases", () => {
    refuses("a: &base 1\n", "anchors");
    refuses("a: *base\n", "aliases");
  });

  it("refuses tags", () => {
    refuses("a: !!str 1\n", "tags");
  });

  it("reads literal and folded block scalars", () => {
    expect(parseYaml("a: |\n  one\n  two\n")).toEqual({ a: "one\ntwo\n" });
    expect(parseYaml("a: >-\n  one\n  two\n")).toEqual({ a: "one two" });
  });

  it("refuses merge keys", () => {
    refuses("<<: x\n", "merge keys");
  });

  it("refuses more than one document", () => {
    refuses("a: 1\n---\nb: 2\n", "one document per file");
  });

  it("refuses tabs, which YAML does not indent with", () => {
    refuses("a:\n\tb: 1\n", "tab");
  });

  it("refuses a duplicated key rather than letting one win", () => {
    refuses("a: 1\na: 2\n", "a is given twice");
    refuses("x: { a: 1, a: 2 }\n", "a is given twice");
  });

  it("refuses a line that is not an entry", () => {
    refuses("a: 1\nnonsense\n", "not a mapping entry");
  });

  it("refuses an unclosed quote and an unclosed collection", () => {
    refuses("a: \"open\n", "not closed");
    refuses("a: [1, 2\n", "ends with ]");
  });

  it("names the line it faulted on", () => {
    try {
      parseYaml("a: 1\nb: &anchor x\n");
      expect.unreachable();
    } catch (error: unknown) {
      expect((error as YamlError).line).toBe(2);
    }
  });
});

describe("the whole document", () => {
  it("reads a leading --- and an empty file", () => {
    expect(parseYaml("---\na: 1\n")).toEqual({ a: 1 });
    expect(parseYaml("")).toBeNull();
    expect(parseYaml("# only a comment\n")).toBeNull();
  });
});


it("reports the supplied filename or URL without reading it", () => {
  try {
    parseYaml("a: 1\nb: &anchor text\n", { source: "https://example.com/api.yaml" });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(YamlError);
    expect(error).toMatchObject({ source: "https://example.com/api.yaml", line: 2 });
    expect((error as Error).message).toContain("https://example.com/api.yaml: line 2");
  }
});

it("keeps reference objects as data rather than importing them during parsing", () => {
  expect(parseYaml('schema: { $ref: "./types.yaml#/Pet" }', { source: "api.yaml" }))
    .toEqual({ schema: { $ref: "./types.yaml#/Pet" } });
});


it("reads block scalar chomping, blank lines, indentation, and plain embedded quotes", () => {
  expect(parseYaml('literal: |+\n  a\n\nfolded: >-\n  a\n  b\n\n  c\nnext: yes\n'))
    .toEqual({ literal: "a\n\n", folded: "a b\nc", next: "yes" });
  expect(parseYaml('  key: 1\n  other: 2\n')).toEqual({ key: 1, other: 2 });
  expect(parseYaml('key": false\n')).toEqual({ 'key"': false });
  expect(parseYaml('a: { implicit }')).toEqual({ a: { implicit: null } });
});
it("bounds bytes and nesting and keeps prototype keys as data", () => {
  expect(() => parseYaml('a: 1', { maxBytes: 2 })).toThrow('maxBytes');
  expect(() => parseYaml('a: [[[1]]]', { maxDepth: 2 })).toThrow('maxDepth');
  const data = parseYaml('__proto__: { polluted: true }') as Record<string, unknown>;
  expect(Object.hasOwn(data, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
});
