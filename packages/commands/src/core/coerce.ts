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

import { compact } from "./compact.js";
import { ArgumentError } from "./errors.js";

/**
 * The JSON Schema subset this enforces.
 *
 * Nothing is carried that is not checked. A keyword an agent is shown and a
 * request is not held to reads as a promise, and is worse than one nobody
 * wrote - `$ref`, `anyOf`, `allOf` and `oneOf` are absent for that reason and
 * are refused at registration rather than passed along.
 */
export interface JsonSchema {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: readonly unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
}

/**
 * How a word becomes a value, and what shape that value has.
 *
 * `schema` is required and `parse` is not: a value whose text reading is the
 * ordinary one for its type needs no function at all. A coercer that declares
 * one is saying its *text* form is not its value form - `KEY=VALUE` becoming a
 * pair - and `schema` then describes what arrives, because that is what a
 * client has to send and an agent has to be shown.
 */
export interface Coercer<T = unknown> {
  readonly schema: JsonSchema;
  /** Only where the text form differs from the value. Runs after `check`. */
  parse?(raw: string, label: string): T;
  /** Overrides the sentence built from the schema. */
  readonly expects?: string;
  /** Fixed candidates, when there are any. Feeds shell completion. */
  readonly candidates?: readonly string[];
}

/** What a person is told the value must be, built from the schema alone. */
export function expectationOf(schema: JsonSchema): string {
  if (schema.enum !== undefined) return `one of ${schema.enum.map(String).join(", ")}`;
  if (schema.const !== undefined) return String(schema.const);

  if (schema.type === "integer" || schema.type === "number") {
    const kind = schema.type === "integer" ? "an integer" : "a number";
    if (schema.minimum !== undefined && schema.maximum !== undefined) {
      return `${kind} between ${schema.minimum} and ${schema.maximum}`;
    }
    if (schema.minimum !== undefined) return `${kind} >= ${schema.minimum}`;
    if (schema.maximum !== undefined) return `${kind} <= ${schema.maximum}`;
    return kind;
  }

  if (schema.type === "boolean") return "true or false";
  if (schema.type === "array") {
    return schema.items === undefined ? "a list" : `a list of ${expectationOf(schema.items)}`;
  }

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
  if (schema.type === "array" || schema.type === "object") {
    try { return JSON.parse(raw) as unknown; } catch { return raw; }
  }
  if (schema.type === "integer" || schema.type === "number") {
    const parsed = Number(raw);
    return raw.trim() === "" || Number.isNaN(parsed) ? raw : parsed;
  }
  if (schema.type === "boolean") {
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
 */
export function check(value: unknown, schema: JsonSchema, label: string, expects?: string): void {
  const fault = (): never => { throw new ArgumentError(`${label} must be ${expects ?? expectationOf(schema)}`); };

  if (schema.enum !== undefined && !schema.enum.includes(value)) fault();
  if (schema.const !== undefined && value !== schema.const) fault();

  if (schema.type === "integer" || schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) fault();
    if (schema.type === "integer" && !Number.isSafeInteger(value)) fault();
    if (schema.minimum !== undefined && (value as number) < schema.minimum) fault();
    if (schema.maximum !== undefined && (value as number) > schema.maximum) fault();
    return;
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") fault();
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) fault();
    if (schema.items !== undefined) for (const one of value as unknown[]) check(one, schema.items, label);
    return;
  }

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) fault();
    const held = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (held[name] === undefined) throw new ArgumentError(`${label}.${name} is required`);
    }
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (held[name] !== undefined) check(held[name], property, `${label}.${name}`);
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") fault();
    const text = value as string;
    if (schema.minLength !== undefined && text.length < schema.minLength) fault();
    if (schema.maxLength !== undefined && text.length > schema.maxLength) fault();
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(text)) fault();
    if (schema.format === "date-time" && Number.isNaN(Date.parse(text))) fault();
  }
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
const UNSUPPORTED = ["$ref", "anyOf", "allOf", "oneOf", "not", "additionalProperties", "patternProperties"] as const;

export function assertSupported(schema: JsonSchema, where: string): void {
  const held = schema as Record<string, unknown>;
  for (const keyword of UNSUPPORTED) {
    if (held[keyword] !== undefined) {
      throw new Error(`${where} uses ${keyword}, which facio does not enforce and will not advertise`);
    }
  }
  if (schema.items !== undefined) assertSupported(schema.items, `${where}[]`);
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    assertSupported(property, `${where}.${name}`);
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
