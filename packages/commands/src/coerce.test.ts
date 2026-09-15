/**
 * The schema is the rulebook, and the only copy of it.
 *
 * These are the shapes that used to be stated more than once - a bound in a
 * message, in a hand-written schema, and inside a parse function - where one
 * copy could fall behind the others without anything noticing.
 */

import { describe, expect, it } from "vitest";
import { assertSupportedSchema } from "./json-schema.js";
import * as coerce from "./coerce.js";
import { check, coerceValue, decode, expectationOf } from "./coerce.js";

describe("what a builder declares", () => {
  /*
   * `decimal` enforced its bounds and advertised none of them, so an agent was
   * told "any number", sent one, and was refused by a rule it was never shown.
   * There is one declaration now, so the two cannot come apart.
   */
  it("puts a decimal's bounds in the schema, not only in the check", () => {
    expect(coerce.decimal({ min: 0, max: 1 }).schema).toEqual({ type: "number", minimum: 0, maximum: 1 });
  });

  it("puts an integer's bounds there too", () => {
    expect(coerce.integer({ min: 0, max: 10 }).schema).toEqual({ type: "integer", minimum: 0, maximum: 10 });
  });

  it("can say what no builder could say before: a length and a pattern", () => {
    expect(coerce.string({ minLength: 1, maxLength: 8, pattern: "^a" }).schema)
      .toEqual({ type: "string", minLength: 1, maxLength: 8, pattern: "^a" });
  });

  it("makes a set the schema, the candidates and the check at once", () => {
    const breed = coerce.oneOf(["beagle", "corgi"]);
    expect(breed.schema).toEqual({ type: "string", enum: ["beagle", "corgi"] });
    expect(breed.candidates).toEqual(["beagle", "corgi"]);
  });
});

describe("one word, as the value the schema describes", () => {
  it("reads a number out of text and holds it to its bounds", () => {
    expect(coerceValue(coerce.integer({ min: 0, max: 10 }), "7", "--n")).toBe(7);
    expect(() => coerceValue(coerce.integer({ min: 0, max: 10 }), "11", "--n"))
      .toThrow("--n must be an integer between 0 and 10");
    expect(() => coerceValue(coerce.integer(), "half", "--n")).toThrow("--n must be an integer");
  });

  it("holds a length", () => {
    expect(() => coerceValue(coerce.string({ maxLength: 3 }), "long", "name"))
      .toThrow("name must be at most 3 characters");
  });

  /*
   * A coercer with its own `parse` describes what *arrives*, so the text is
   * checked before it is turned into something else - which is how `KEY=VALUE`
   * becomes a rule a client is shown rather than only a message it is refused
   * with.
   */
  it("checks the text of a coercer that parses into another shape", () => {
    expect(coerceValue(coerce.pair, "a=b", "--set")).toEqual(["a", "b"]);
    expect(() => coerceValue(coerce.pair, "nope", "--set")).toThrow("--set must be KEY=VALUE");
  });

  it("keeps a timestamp as its text, and refuses one that is not an instant", () => {
    expect(coerceValue(coerce.timestamp, "2026-09-06T00:00:00Z", "--at")).toBe("2026-09-06T00:00:00Z");
    expect(() => coerceValue(coerce.timestamp, "yesterday", "--at")).toThrow("an ISO-8601 timestamp");
  });
});

describe("check", () => {
  it("holds a value to a type list, and to null only when the schema allows it", () => {
    expect(() => check(null, { type: ["string", "null"] }, "x")).not.toThrow();
    expect(() => check(null, { type: "string", nullable: true }, "x")).not.toThrow();
    expect(() => check(null, { type: "string" }, "x")).toThrow("x must be text");
    expect(() => check(3, { type: ["string", "integer"] }, "x")).not.toThrow();
    expect(() => check(true, { type: ["string", "integer"] }, "x")).toThrow();
  });

  it("holds numbers to exclusive bounds and a step", () => {
    expect(() => check(5, { type: "number", exclusiveMaximum: 5 }, "x")).toThrow();
    expect(() => check(0.3, { type: "number", multipleOf: 0.1 }, "x")).not.toThrow();
    expect(() => check(0.35, { type: "number", multipleOf: 0.1 }, "x")).toThrow();
  });

  it("holds lists to a size, uniqueness and a prefix", () => {
    expect(() => check([1], { type: "array", minItems: 2 }, "x")).toThrow();
    expect(() => check([1, 1], { type: "array", uniqueItems: true }, "x")).toThrow();
    expect(() => check(["a", 1], { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }] }, "x")).not.toThrow();
    expect(() => check(["a", "b"], { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }] }, "x")).toThrow();
  });

  it("refuses a property the object does not declare, when asked to", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false } as const;
    expect(() => check({ a: "x" }, schema, "who")).not.toThrow();
    expect(() => check({ a: "x", b: 1 }, schema, "who")).toThrow("who.b is not a field");
    expect(() => check({ a: "x", b: 1 }, { ...schema, additionalProperties: true }, "who")).not.toThrow();
  });

  it("holds a value to anyOf, oneOf and allOf", () => {
    const either = { anyOf: [{ type: "string" }, { type: "integer" }] } as const;
    expect(() => check("a", either, "x")).not.toThrow();
    expect(() => check(true, either, "x")).toThrow();
    const exactlyOne = { oneOf: [{ type: "integer", minimum: 0 }, { type: "integer", maximum: 0 }] } as const;
    expect(() => check(5, exactlyOne, "x")).not.toThrow();
    expect(() => check(0, exactlyOne, "x")).toThrow();
    expect(() => check("ab", { allOf: [{ type: "string", minLength: 2 }, { type: "string", maxLength: 3 }] }, "x")).not.toThrow();
    expect(() => check("abcd", { allOf: [{ type: "string", minLength: 2 }, { type: "string", maxLength: 3 }] }, "x")).toThrow();
  });

  it("walks the items of a list", () => {
    expect(() => check(["ok", "far too long"], { type: "array", items: { type: "string", maxLength: 4 } }, "--tag"))
      .toThrow("--tag must be at most 4 characters");
  });

  it("walks the properties of an object and reports which one", () => {
    const schema = { type: "object" as const, properties: { age: { type: "integer" as const, minimum: 0 } } };
    expect(() => check({ age: -1 }, schema, "who")).toThrow("who.age must be an integer >= 0");
  });

  it("refuses a value of the wrong type rather than coercing it quietly", () => {
    expect(() => check("3", { type: "integer" }, "x")).toThrow();
    expect(() => check(3, { type: "string" }, "x")).toThrow();
  });
});

describe("the sentence a schema reads as", () => {
  it("says the bound, the length, the set or the pattern", () => {
    expect(expectationOf({ type: "integer", minimum: 1 })).toBe("an integer >= 1");
    expect(expectationOf({ type: "string", minLength: 1, maxLength: 4 })).toBe("1 to 4 characters");
    expect(expectationOf({ type: "string", enum: ["a", "b"] })).toBe("one of a, b");
    expect(expectationOf({ type: "string", pattern: "^a" })).toBe("text matching ^a");
    expect(expectationOf({ type: "array", items: { type: "integer" } })).toBe("a list of an integer");
  });
});

describe("decode", () => {
  it("gives text back unchanged when it is not the type the schema names", () => {
    expect(decode("half", { type: "integer" })).toBe("half");
    expect(decode("maybe", { type: "boolean" })).toBe("maybe");
  });
});

describe("what will not be carried", () => {
  /*
   * The schema is served to an agent and to a remote client verbatim, so a
   * keyword nothing enforces would be a rule advertised and never applied. It
   * is refused where a mistake is cheapest: at registration.
   */
  it("refuses a keyword it does not enforce, and says where", () => {
    expect(() => assertSupportedSchema({ schema: { patternProperties: {} } as never, path: "note.add --tag" }))
      .toThrow("note.add --tag uses patternProperties");
    expect(() => assertSupportedSchema({ schema: { $ref: "#/x" } as never, path: "x" })).toThrow("$ref");
    expect(() => assertSupportedSchema({ schema: { type: "string", pattern: "(" }, path: "x" })).toThrow("does not compile");
  });

  it("looks inside a list, an object and a union, not only at the top", () => {
    expect(() => assertSupportedSchema({ schema: { type: "array", items: { not: {} } as never }, path: "x" }))
      .toThrow("x[] uses not");
    expect(() => assertSupportedSchema({ schema: { type: "object", properties: { a: { not: {} } as never } }, path: "who" }))
      .toThrow("who.a uses not");
    expect(() => assertSupportedSchema({ schema: { anyOf: [{ type: "string" }, { $ref: "#" } as never] }, path: "u" }))
      .toThrow("u.anyOf[1] uses $ref");
  });

  it("says nothing about a schema it can hold to", () => {
    expect(() => assertSupportedSchema({ schema: coerce.integer({ min: 1 }).schema, path: "x" })).not.toThrow();
  });
});
