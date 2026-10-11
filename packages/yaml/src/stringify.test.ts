/**
 * What the writer writes, read back by the parser.
 *
 * Every case is a round trip: a value written by `stringifyYaml` and read by
 * `parseYaml` equals the value it started as.
 */

import { describe, expect, it } from "vitest";
import { stringifyYaml } from "./stringify.js";
import { parseYaml, YamlError } from "./yaml.js";

function roundTrip(value: unknown): string {
  const text = stringifyYaml(value);
  expect(parseYaml(text)).toStrictEqual(value);
  return text;
}

describe("structure", () => {
  it("writes nested mappings and sequences with two spaces of indent", () => {
    const text = roundTrip({ a: { b: { c: 1 } }, run: ["one", { exec: "x", args: ["a", "b"] }, [1, [2]]] });
    expect(text).toBe([
      "a:",
      "  b:",
      "    c: 1",
      "run:",
      "  - one",
      "  - exec: x",
      "    args:",
      "      - a",
      "      - b",
      "  -",
      "    - 1",
      "    -",
      "      - 2",
      "",
    ].join("\n"));
  });

  it("writes empty values", () => {
    expect(roundTrip({ o: {}, a: [], n: null, s: "", items: [{}, [], null, ""] })).toBe(
      'o: {}\na: []\nn: null\ns: ""\nitems:\n  - {}\n  - []\n  - null\n  - ""\n',
    );
  });

  it("writes a value at the top of the document", () => {
    for (const value of [{}, [], null, true, 0, "text", "two\nlines", "a: b"]) roundTrip(value);
    expect(stringifyYaml([])).toBe("[]\n");
  });

  it("writes a mapping that holds a sequence of mappings", () => {
    roundTrip({ bots: [{ name: "a", model: { id: "m", effort: "high" } }, { name: "b", tools: [] }] });
  });
});

describe("scalars", () => {
  it("writes numbers, booleans and null as plain scalars", () => {
    const value = { i: 3, f: 1.5, neg: -2, zero: -0, big: 1e21, small: 1.5e-7, t: true, f2: false, n: null };
    expect(roundTrip(value)).toContain("i: 3\nf: 1.5\nneg: -2\nzero: -0\n");
  });

  it("quotes text that the parser reads as another type", () => {
    const words = ["true", "false", "null", "~", "1", "-1", "1.5", ".5", "1.", "1e3", "0"];
    const text = roundTrip(Object.fromEntries(words.map((word) => [`k${word}`, word])));
    for (const word of words) expect(text).toContain(`: "${word}"`);
  });

  it("quotes text that a YAML 1.2 core schema reader reads as another type", () => {
    const words = ["True", "TRUE", "False", "FALSE", "Null", "NULL", "+1", "+1.5", "0x1F", "0o17", ".inf", "-.Inf", "+.INF", ".nan", ".NaN", ".NAN"];
    const text = roundTrip(Object.fromEntries(words.map((word) => [word, word])));
    for (const word of words) expect(text).toContain(`"${word}": "${word}"`);
  });

  it("quotes text that starts with an indicator", () => {
    const text = roundTrip(["- a", "a: b", "#x", "[a]", "{a}", "&a", "*a", "!a", "|", ">", "%a", "@a", "`a", "'a'", '"a"', "? a", ",a"]);
    expect(text).toContain('- "- a"\n- "a: b"\n- "#x"\n');
  });

  it("quotes text a plain scalar would lose or misread", () => {
    roundTrip([" lead", "trail ", "a #b", "a:", "x - |", "x: >-", "...", "---", "tab\there", "a [b", "nbsp ", "line sep"]);
  });

  it("leaves ordinary text plain", () => {
    expect(roundTrip({ url: "http://host/path", version: "1.0.0", word: "don't", hash: "C#", Yes: "on" })).toBe(
      "url: http://host/path\nversion: 1.0.0\nword: don't\nhash: C#\nYes: on\n",
    );
  });

  it("escapes control characters and lone surrogates", () => {
    roundTrip(["\u0000\u0001\b\f\r\u007f\u0085", "quote \" and \\", "\ud800 lone", "pair 😀", "é ü 日本"]);
  });
});

describe("multi-line text", () => {
  it("writes a literal block scalar with the chomping its last newline needs", () => {
    expect(roundTrip({ strip: "a\nb", clip: "a\nb\n", keep: "a\nb\n\n\n" })).toBe(
      "strip: |-\n  a\n  b\nclip: |\n  a\n  b\nkeep: |+\n  a\n  b\n\n\n",
    );
  });

  it("keeps blank lines inside and a block that ends the document", () => {
    roundTrip({ prompt: "first\n\n\nsecond\n" });
    roundTrip({ a: "x\n\n" });
    roundTrip(["x\n\n", "y\n"]);
  });

  it("keeps a comment marker, quotes and indentation as text", () => {
    roundTrip({ code: "# title\nkey: value\n  - item\n'quoted' \"too\"\n---\n" });
  });

  it("writes an indentation indicator when the first line starts with a space", () => {
    const text = roundTrip({ code: "  indented\nflush\n", tab: "\tx\ny" });
    expect(text).toContain("code: |2\n    indented\n  flush\n");
  });

  it("opens a sequence item on its own line when its first value is a block", () => {
    const value = [{ prompt: "a\nb\n", name: "x" }, { prompt: "  a\nb", name: "y" }, { name: "z", prompt: "a\nb" }];
    expect(roundTrip(value)).toBe([
      "-",
      "  prompt: |",
      "    a",
      "    b",
      "  name: x",
      "-",
      "  prompt: |2-",
      "      a",
      "    b",
      "  name: y",
      "- name: z",
      "  prompt: |-",
      "    a",
      "    b",
      "",
    ].join("\n"));
  });

  it("writes a block as a sequence item and deep in the document", () => {
    roundTrip(["a\nb", { x: [{ y: { z: "c\nd\n" } }] }]);
  });

  it("quotes multi-line text a literal block cannot carry", () => {
    const value = { spaces: "a\n  \nb", only: "\n\n", carriage: "a\r\nb", bell: "a\u0007\nb" };
    const text = roundTrip(value);
    expect(text).toContain('spaces: "a\\n  \\nb"');
  });
});

describe("keys", () => {
  it("quotes the key <<, which plain is a merge key", () => {
    expect(roundTrip({ "<<": 1, a: { "<<": "x" } })).toBe('"<<": 1\na:\n  "<<": x\n');
  });

  it("quotes a key that is not a plain key", () => {
    const keys = ["a:b", "a: b", "with space", "- dash", "-", "", "1", "true", "null", "#x", "a #b", "it's 'q'", "a[0]", "x,y", "line\nbreak", "__proto__"];
    const value: Record<string, unknown> = {};
    for (const key of keys) Object.defineProperty(value, key, { value: key, enumerable: true });
    const text = roundTrip(value);
    expect(text).toContain('"a: b": "a: b"');
    expect(text).toContain("with space: with space");
  });

  it("skips a key whose value is undefined, as JSON.stringify does", () => {
    expect(stringifyYaml({ a: 1, b: undefined })).toBe("a: 1\n");
    expect(stringifyYaml({ b: undefined })).toBe("{}\n");
    expect(stringifyYaml([{ b: undefined, c: 1 }])).toBe("- c: 1\n");
  });
});

describe("what it refuses", () => {
  it("refuses what is not a JSON value", () => {
    for (const value of [undefined, () => 1, Symbol("s"), 1n, Number.NaN, Infinity, -Infinity, [undefined], { a: () => 1 }, { a: [1n] }]) {
      expect(() => stringifyYaml(value)).toThrow(YamlError);
    }
  });

});
