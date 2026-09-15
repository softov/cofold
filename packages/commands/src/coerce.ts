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
import { validateSchema } from "./json-schema.js";

/** What a person is told the value must be, built from the schema alone. */
export function expectationOf(schema: JsonSchema): string {
  if (schema.enum !== undefined) return `one of ${schema.enum.map(String).join(", ")}`;
  if (schema.const !== undefined) return String(schema.const);
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives !== undefined) return alternatives.map(expectationOf).join(" or ");
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
 * Every rule the schema states, held against one value, as a sentence.
 *
 * `validateSchema` is the one place a constraint is enforced; this is what a
 * terminal says about its first finding: `who.age must be an integer >= 0`,
 * `--tag must be at most 4 characters`, `who.name is required`. An item is
 * named for its list, because that is what a repeated option reads as.
 */
export function check(value: unknown, schema: JsonSchema, label: string, expects?: string): void {
  const result = validateSchema({ schema, value });
  if (result.ok) return;
  const first = result.issues[0]!;
  const steps = first.path.slice(1).match(/\.[^.[]+|\[\d+\]/gu) ?? [];
  let at = schema;
  let name = label;
  for (const step of steps) {
    if (step.startsWith(".")) {
      const key = step.slice(1);
      const next = at.properties?.[key];
      name = `${name}.${key}`;
      if (next === undefined) {
        // A property the schema does not describe: required and missing, or present and refused.
        throw new ArgumentError(first.message === "required" ? `${name} is required` : `${name} is not a field`);
      }
      at = next;
    } else {
      const index = Number(step.slice(1, -1));
      at = at.prefixItems?.[index] ?? at.items ?? at;
    }
  }
  if (first.message === "required") throw new ArgumentError(`${name} is required`);
  if (first.message === "unexpected property") throw new ArgumentError(`${name} is not a field`);
  throw new ArgumentError(`${name} must be ${at === schema && expects !== undefined ? expects : expectationOf(at)}`);
}

/** The type a text reading and a sentence are built for: the first the schema names that is not `null`. */
function primaryType(schema: JsonSchema): string | undefined {
  const listed = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  return listed.find((type) => type !== "null");
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
