import { compact } from "./compact.js";
import { ArgumentError } from "./errors.js";

/**
 * Turning a word into a value, and saying what shape that value has.
 *
 * A coercer is two things at once on purpose: the runtime parse, and the JSON
 * Schema fragment describing what it accepts. The second is what lets the MCP
 * adapter exist at all - a tool needs a typed input schema, and inferring one
 * from a parse function is impossible. Declaring both together means a command
 * cannot accept an integer on the command line and advertise a string to an
 * agent.
 */

export interface JsonSchemaFragment {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  format?: string;
  items?: JsonSchemaFragment;
  description?: string;
  default?: unknown;
}

export interface Coercer<T = unknown> {
  /** For messages: "must be a positive integer". */
  readonly expects: string;
  readonly jsonSchema: JsonSchemaFragment;
  parse(raw: string, label: string): T;
  /** Fixed candidates, when there are any. Feeds shell completion. */
  readonly candidates?: readonly string[];
}

function fault(label: string, expects: string): never {
  throw new ArgumentError(`${label} must be ${expects}`);
}

export const text: Coercer<string> = {
  expects: "text",
  jsonSchema: { type: "string" },
  parse: (raw) => raw,
};

export function integer(bounds: { min?: number; max?: number } = {}): Coercer<number> {
  const { min, max } = bounds;
  const expects = min === 1 && max === undefined
    ? "a positive integer"
    : `an integer${min === undefined ? "" : ` >= ${min}`}${max === undefined ? "" : ` <= ${max}`}`;
  return {
    expects,
    jsonSchema: { type: "integer", ...compact({ minimum: min, maximum: max }) },
    parse(raw, label) {
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed)) fault(label, expects);
      if (min !== undefined && parsed < min) fault(label, expects);
      if (max !== undefined && parsed > max) fault(label, expects);
      return parsed;
    },
  };
}

export function decimal(bounds: { min?: number; max?: number } = {}): Coercer<number> {
  const expects = "a number";
  return {
    expects,
    jsonSchema: { type: "number" },
    parse(raw, label) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) fault(label, expects);
      if (bounds.min !== undefined && parsed < bounds.min) fault(label, `at least ${bounds.min}`);
      if (bounds.max !== undefined && parsed > bounds.max) fault(label, `at most ${bounds.max}`);
      return parsed;
    },
  };
}

/**
 * One of a fixed set.
 *
 * The set is also the completion source and the JSON Schema enum, so adding a
 * value to a command teaches the shell, the agent and the help text at once.
 */
export function oneOf<const T extends readonly string[]>(values: T): Coercer<T[number]> {
  const expects = `one of ${values.join(", ")}`;
  return {
    expects,
    jsonSchema: { type: "string", enum: values },
    candidates: values,
    parse(raw, label) {
      if (!values.includes(raw)) fault(label, expects);
      return raw as T[number];
    },
  };
}

export const boolean: Coercer<boolean> = {
  expects: "true or false",
  jsonSchema: { type: "boolean" },
  parse(raw, label) {
    if (["true", "yes", "1", "on"].includes(raw.toLowerCase())) return true;
    if (["false", "no", "0", "off"].includes(raw.toLowerCase())) return false;
    return fault(label, "true or false");
  },
};

/**
 * An ISO-8601 instant, kept as the string it was given.
 *
 * Deliberately not a `Date`: the value travels to a server as JSON either way,
 * and turning it into an object here would mean turning it back at every edge.
 * What is checked is that it is a real instant, which is the part a person gets
 * wrong.
 */
export const timestamp: Coercer<string> = {
  expects: "an ISO-8601 timestamp",
  jsonSchema: { type: "string", format: "date-time" },
  parse(raw, label) {
    if (Number.isNaN(Date.parse(raw))) fault(label, "an ISO-8601 timestamp");
    return raw;
  },
};

export const json: Coercer<unknown> = {
  expects: "valid JSON",
  jsonSchema: {},
  parse(raw, label) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return fault(label, "valid JSON");
    }
  },
};

/** `KEY=VALUE`, for the options that are given several times to build a map. */
export const pair: Coercer<readonly [string, string]> = {
  expects: "KEY=VALUE",
  jsonSchema: { type: "string" },
  parse(raw, label) {
    const index = raw.indexOf("=");
    if (index <= 0) fault(label, "KEY=VALUE");
    return [raw.slice(0, index), raw.slice(index + 1)] as const;
  },
};

/** `a,b,c` in one word, for the lists nobody wants to repeat a flag for. */
export function commaSeparated(item: Coercer<string> = text): Coercer<string[]> {
  return {
    expects: "a comma-separated list",
    jsonSchema: { type: "array", items: item.jsonSchema },
    parse: (raw, label) => raw.split(",").map((part) => item.parse(part.trim(), label)),
  };
}
