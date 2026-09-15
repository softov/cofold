/**
 * What a value is allowed to be, and how a word becomes one.
 *
 * A schema is the declaration and the only place a rule is written. Every
 * surface reads it: the command line checks against it, the MCP adapter serves
 * it as a tool's `inputSchema`, and the manifest carries it to a remote client
 * unchanged. So a bound cannot be advertised and not enforced, which is what
 * happened while each coercer stated its rules three times - once in a message,
 * once in a schema written by hand, and once inside its own `parse`.
 *
 * `parse` is left with the one job a schema cannot do: reading a value out of
 * text. `check` does the rest, once, for everybody.
 */

import type { Coercer } from "./types/coerce.js";
import type { JsonSchema } from "@facio/sdk";
import { compact } from "./compact.js";
import { ArgumentError } from "./errors.js";

/** What a person is told the value must be, built from the schema alone. */
export function expectationOf(schema: JsonSchema): string {
  if (schema.enum !== undefined) return `one of ${schema.enum.map(String).join(", ")}`;
  if (schema.const !== undefined) return String(schema.const);
  const type = primaryType(schema);

  if (type === "integer" || type === "number") {
    const kind = type === "integer" ? "an integer" : "a number";
    if (schema.minimum !== undefined && schema.maximum !== undefined) {
      return `${kind} between ${schema.minimum} and ${schema.maximum}`;
    }
    if (schema.minimum !== undefined) return `${kind} >= ${schema.minimum}`;
    if (schema.maximum !== undefined) return `${kind} <= ${schema.maximum}`;
    return kind;
  }

  if (type === "boolean") return "true or false";
  if (type === "array") {
    return schema.items === undefined ? "a list" : `a list of ${expectationOf(schema.items)}`;
  }
  if (type === "object") return "an object";

  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    return `${schema.minLength} to ${schema.maxLength} characters`;
  }
  if (schema.minLength !== undefined) {
    return `at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`;
  }
  if (schema.maxLength !== undefined) {
    return `at most ${schema.maxLength} character${schema.maxLength === 1 ? "" : "s"}`;
  }
  if (schema.pattern !== undefined) return `text matching ${schema.pattern}`;
  if (schema.format === "date-time") return "an ISO-8601 timestamp";
  return "text";
}

/**
 * A value read from text, by the type the schema names.
 *
 * The ordinary reading, which is all most fields need. Anything given back
 * unchanged is then checked, so a word that is not a number faults by the same
 * route as one that is out of range.
 */
export function decode(raw: string, schema: JsonSchema): unknown {
  const type = primaryType(schema);
  if (type === "array" || type === "object") {
    try { return JSON.parse(raw) as unknown; } catch { return raw; }
  }
  if (type === "integer" || type === "number") {
    const parsed = Number(raw);
    return raw.trim() === "" || Number.isNaN(parsed) ? raw : parsed;
  }
  if (type === "boolean") {
    if (["true", "yes", "1", "on"].includes(raw.toLowerCase())) return true;
    if (["false", "no", "0", "off"].includes(raw.toLowerCase())) return false;
    return raw;
  }
  return raw;
}

/**
 * Every rule the schema states, held against one value.
 *
 * The only place a constraint is enforced. A surface that reaches a value by a
 * different road - text at a terminal, a number in a JSON body, an argument
 * from an agent - arrives at this same function, so the three cannot disagree.
 * Every keyword `JsonSchema` carries is held here; `assertSupported` refuses
 * the rest at declaration time.
 */
export function check(value: unknown, schema: JsonSchema, label: string, expects?: string): void {
  const fault = (): never => { throw new ArgumentError(`${label} must be ${expects ?? expectationOf(schema)}`); };

  const types = typesOf(schema);
  if (value === null && (schema.nullable === true || types.includes("null"))) return;
  if (schema.enum !== undefined && !schema.enum.includes(value)) fault();
  if (schema.const !== undefined && value !== schema.const) fault();
  if (types.length > 0 && !types.some((type) => isOfType(value, type))) fault();

  if (typeof value === "number") {
    if (types.includes("integer") && !types.includes("number") && !Number.isSafeInteger(value)) fault();
    if (schema.minimum !== undefined && value < schema.minimum) fault();
    if (schema.maximum !== undefined && value > schema.maximum) fault();
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fault();
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fault();
    if (schema.multipleOf !== undefined && !isMultiple(value, schema.multipleOf)) fault();
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fault();
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fault();
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) fault();
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) fault();
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fault();
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fault();
    if (schema.uniqueItems === true && new Set(value.map((one) => JSON.stringify(one))).size !== value.length) fault();
    // An item is named for its list: `--tag must be at most 4 characters` is what a repeated option reads as.
    const prefix = schema.prefixItems ?? [];
    value.forEach((one, index) => {
      const itemSchema = prefix[index] ?? schema.items;
      if (itemSchema !== undefined) check(one, itemSchema, label);
    });
  }

  if (isPlainObject(value)) {
    const held = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (held[name] === undefined) throw new ArgumentError(`${label}.${name} is required`);
    }
    const properties = schema.properties ?? {};
    for (const [name, property] of Object.entries(properties)) {
      if (held[name] !== undefined) check(held[name], property, `${label}.${name}`);
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(held)) {
        if (!(name in properties)) throw new ArgumentError(`${label}.${name} is not a field`);
      }
    }
  }

  if (schema.allOf !== undefined) for (const one of schema.allOf) check(value, one, label, expects);
  if (schema.anyOf !== undefined && !schema.anyOf.some((one) => passes(value, one, label))) fault();
  if (schema.oneOf !== undefined && schema.oneOf.filter((one) => passes(value, one, label)).length !== 1) fault();
}

function passes(value: unknown, schema: JsonSchema, label: string): boolean {
  try { check(value, schema, label); return true; }
  catch (error) { if (error instanceof ArgumentError) return false; throw error; }
}

/** The `type` keyword as a list; `nullable` adds `null`; none means any. */
function typesOf(schema: JsonSchema): readonly string[] {
  const listed = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  return schema.nullable === true && !listed.includes("null") ? [...listed, "null"] : listed;
}

/** The type a text reading and a sentence are built for: the first one that is not `null`. */
function primaryType(schema: JsonSchema): string | undefined {
  return typesOf(schema).find((type) => type !== "null");
}

function isOfType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    default: return false;
  }
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `multipleOf` without the floating-point lie: 0.3 is a multiple of 0.1. */
function isMultiple(value: number, step: number): boolean {
  const quotient = value / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

/**
 * One word, as the value a coercer describes.
 *
 * Decode, then check - and for a coercer with its own `parse`, check the text
 * against the schema first, because the schema of such a coercer describes what
 * arrives rather than what it becomes.
 */
export function coerceValue<T>(coercer: Coercer<T>, raw: string, label: string): T {
  if (coercer.parse !== undefined) {
    check(raw, coercer.schema, label, coercer.expects);
    return coercer.parse(raw, label);
  }
  const value = decode(raw, coercer.schema);
  check(value, coercer.schema, label, coercer.expects);
  return value as T;
}

/**
 * The keywords this does not enforce, and so will not carry.
 *
 * Checked at registration rather than trusted to the type, because a schema
 * built at runtime or written in JavaScript reaches the MCP `inputSchema` and
 * the manifest verbatim. A keyword an agent is shown and a request is not held
 * to reads as a promise, which is worse than one nobody wrote.
 */
const UNSUPPORTED = ["$ref", "not", "patternProperties"] as const;

export function assertSupported(schema: JsonSchema, where: string): void {
  const held = schema as Record<string, unknown>;
  for (const keyword of UNSUPPORTED) {
    if (held[keyword] !== undefined) {
      throw new Error(`${where} uses ${keyword}, which facio does not enforce and will not advertise`);
    }
  }
  if (schema.pattern !== undefined) {
    try { new RegExp(schema.pattern, "u"); }
    catch (error) { throw new Error(`${where} has a pattern that does not compile: ${(error as Error).message}`); }
  }
  if (schema.items !== undefined) assertSupported(schema.items, `${where}[]`);
  (schema.prefixItems ?? []).forEach((one, index) => assertSupported(one, `${where}[${index}]`));
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    assertSupported(property, `${where}.${name}`);
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    (schema[keyword] ?? []).forEach((one, index) => assertSupported(one, `${where}.${keyword}[${index}]`));
  }
}

export const text: Coercer<string> = { schema: { type: "string" } };

/** Text with a length, a pattern, or both. */
export function string(rules: { minLength?: number; maxLength?: number; pattern?: string } = {}): Coercer<string> {
  return { schema: { type: "string", ...compact(rules) } };
}

export function integer(bounds: { min?: number; max?: number } = {}): Coercer<number> {
  return {
    schema: { type: "integer", ...compact({ minimum: bounds.min, maximum: bounds.max }) },
    ...(bounds.min === 1 && bounds.max === undefined ? { expects: "a positive integer" } : {}),
  };
}

export function decimal(bounds: { min?: number; max?: number } = {}): Coercer<number> {
  return { schema: { type: "number", ...compact({ minimum: bounds.min, maximum: bounds.max }) } };
}

/**
 * One of a fixed set.
 *
 * The set is the completion source, the JSON Schema enum and the check, so
 * adding a value teaches the shell, the agent and the help text at once.
 */
export function oneOf<const T extends readonly string[]>(values: T): Coercer<T[number]> {
  return { schema: { type: "string", enum: values }, candidates: values };
}

export const boolean: Coercer<boolean> = { schema: { type: "boolean" } };

/**
 * An ISO-8601 instant, kept as the string it was given.
 *
 * Deliberately not a `Date`: the value travels to a server as JSON either way,
 * and turning it into an object here would mean turning it back at every edge.
 */
export const timestamp: Coercer<string> = { schema: { type: "string", format: "date-time" } };

/** Arbitrary JSON in one word. The text is a string; what it becomes is not. */
export const json: Coercer<unknown> = {
  schema: { type: "string" },
  expects: "valid JSON",
  parse(raw, label) {
    try {
      return JSON.parse(raw) as unknown;
    }
    catch {
      throw new ArgumentError(`${label} must be valid JSON`);
    }
  },
};

/** `KEY=VALUE`, for the options that are given several times to build a map. */
export const pair: Coercer<readonly [string, string]> = {
  // The shape is in the pattern rather than only in the message, so a client
  // sending one is told the rule before it is refused by it.
  schema: { type: "string", pattern: "^[^=]+=.*$" },
  expects: "KEY=VALUE",
  parse(raw) {
    const index = raw.indexOf("=");
    return [raw.slice(0, index), raw.slice(index + 1)] as const;
  },
};

/** `a,b,c` in one word, for the lists nobody wants to repeat a flag for. */
export function commaSeparated(item: Coercer<string> = text): Coercer<string[]> {
  return {
    schema: { type: "string" },
    expects: "a comma-separated list",
    parse: (raw, label) => raw.split(",").map((part) => coerceValue(item, part.trim(), label)),
  };
}
