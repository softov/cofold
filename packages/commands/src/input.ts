import type { Coercer } from "./types/coerce.js";
import type { Command } from "./types/command.js";
import type { ArgumentSpec, FieldDescriptor } from "./types/field.js";
import type { RawCliInput } from "./types/input.js";
import { fieldNameOf, isFlag, optionsOf, parsePattern } from "./command.js";
import { coerceValue, text } from "./coerce.js";
import { ArgumentError } from "./errors.js";
import { validate } from "./schema.js";

/**
 * One object, whatever typed it.
 *
 * The canonical input is the seam of the whole library. A handler never sees
 * argv, an MCP tool call or an HTTP query - it sees the object all three become,
 * with the same field names, the same types and the same defaults applied. Two
 * surfaces that disagreed about what `--limit` means would be a bug in exactly
 * one file, this one, rather than in each of them.
 */

function environment(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** A value as the coercer wants to read it: coercers parse text. */
function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function coerceOne(coercer: Coercer<unknown>, raw: string, label: string): unknown {
  return coerceValue(coercer, raw, label);
}

function slotSpec(command: Command, name: string): ArgumentSpec | undefined {
  return command.arguments?.[name];
}

export function fieldsOf(command: Command): FieldDescriptor[] {
  const fields: FieldDescriptor[] = [];
  for (const token of parsePattern(command.pattern)) {
    if (token.kind !== "slot") continue;
    const spec = slotSpec(command, token.name);
    fields.push({
      name: spec?.field ?? token.name,
      source: "argument",
      label: token.name,
      description: spec?.description ?? "",
      required: !token.optional,
      repeated: token.variadic,
      coerce: (spec?.coerce ?? text) as Coercer<unknown>,
    });
  }
  for (const option of optionsOf(command)) {
    fields.push({
      name: fieldNameOf(option),
      source: "option",
      label: option.name,
      description: option.description,
      required: option.required === true,
      repeated: option.repeatable === true,
      coerce: (option.coerce ?? (isFlag(option) ? BOOLEAN_PRESENT : text)) as Coercer<unknown>,
      option,
    });
  }
  return fields;
}

/** A flag's "type" for schema purposes; never used to parse a word. */
const BOOLEAN_PRESENT: Coercer<boolean> = {
  schema: { type: "boolean" },
  expects: "a flag",
  parse: () => true,
};

/**
 * The checks that belong to the whole input rather than to one value.
 *
 * `naming` is how a missing field is named back to whoever asked for it: its
 * terminal spelling at a terminal, its own name everywhere else, because a
 * client that sends an object has no flags to be told about.
 */
async function finish(
  command: Command,
  input: Record<string, unknown>,
  naming: (field: FieldDescriptor) => string,
): Promise<Record<string, unknown>> {
  for (const field of fieldsOf(command)) {
    if (field.required && input[field.name] === undefined) {
      throw new ArgumentError(`${naming(field)} is required`);
    }
  }
  if (command.refine === undefined) return input;
  return await validate(command.refine, input, (message) => new ArgumentError(message)) as Record<string, unknown>;
}

/**
 * The command line's reading of the input.
 *
 * Order matters and is the same everywhere: what was typed, then the
 * environment, then the declared default. An environment variable that beat an
 * explicit flag would be a surprise nobody could debug from the terminal.
 */
export async function canonicalFromCli(command: Command, raw: RawCliInput): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};

  for (const token of parsePattern(command.pattern)) {
    if (token.kind !== "slot") continue;
    const given = raw.slots[token.name];
    if (given === undefined) continue;
    const spec = slotSpec(command, token.name);
    const coercer = (spec?.coerce ?? text) as Coercer<unknown>;
    const name = spec?.field ?? token.name;
    input[name] = Array.isArray(given)
      ? given.map((one) => coerceOne(coercer, one, token.name))
      : coerceOne(coercer, given, token.name);
  }

  for (const option of optionsOf(command)) {
    const name = fieldNameOf(option);
    const given = raw.options[option.name];

    if (isFlag(option)) {
      if (typeof given === "boolean") input[name] = given;
      else if (environment(option.env) !== undefined) input[name] = environment(option.env) !== "0";
      else if (option.default !== undefined) input[name] = option.default;
      else input[name] = false;
      continue;
    }

    const coercer = (option.coerce ?? text) as Coercer<unknown>;
    const raws = given === undefined || typeof given === "boolean"
      ? (environment(option.env) === undefined ? [] : [environment(option.env)!])
      : (Array.isArray(given) ? given : [given]);

    if (raws.length === 0) {
      if (option.default !== undefined) input[name] = option.default;
      continue;
    }
    const values = raws.map((one) => coerceOne(coercer, one, option.name));
    input[name] = option.repeatable === true ? values : values[values.length - 1];
  }

  if (command.stdin !== undefined && input[command.stdin] === undefined && raw.stdin !== undefined && raw.stdin !== "") {
    input[command.stdin] = raw.stdin;
  }

  return await finish(command, input, (field) => field.label);
}

/**
 * An already-structured reading: MCP tool arguments, an HTTP body, a test.
 *
 * Values arrive typed, so coercion runs only for the strings that were meant to
 * be something else - an agent that sends `"10"` for a count gets the same
 * number the terminal would have produced rather than a type error two layers
 * down.
 */
export async function canonicalFromObject(
  command: Command,
  value: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const field of fieldsOf(command)) {
    const given = value[field.name];
    // `null` is how a JSON client says nothing, so it takes the same road as a
    // key that was never there - including `finish`'s required check.
    if (given === undefined || given === null) {
      const fallback = environment(field.option?.env) ?? field.option?.default;
      if (fallback !== undefined) input[field.name] = fallback;
      else if (field.option !== undefined && isFlag(field.option)) input[field.name] = false;
      continue;
    }
    /*
     * Every value goes through the declared coercer, whatever it arrived as.
     *
     * This used to coerce only what arrived as text, which made validation a
     * property of the wire encoding rather than of the declaration: `--age -5`
     * was refused at the command line and `{"age": -5}` was accepted over HTTP
     * and MCP, because a JSON number is not a string. `oneOf` was never
     * enforced here at all, because its type *is* string. A bound the coercer
     * never sees is a bound nobody checks.
     *
     * The fault is named as the caller named it: `label` is the terminal
     * spelling, and a client that sent `{"age": -5}` has no `--age` to correct.
     */
    const convert = (one: unknown): unknown => coerceOne(field.coerce, asText(one), field.name);
    input[field.name] = Array.isArray(given) && !(field.coerce.schema.type === "array" && !field.repeated)
      ? given.map(convert) : convert(given);
  }
  return await finish(command, input, (field) => field.name);
}

/**
 * Just the `:slot` fields, in pattern order.
 *
 * Help and the generated reference both want to describe the slots, and both
 * used to re-walk the pattern to do it - which is how one of them ended up
 * defaulting a missing coercer to `text` and the other to nothing.
 */
export function argumentFields(command: Command): FieldDescriptor[] {
  return fieldsOf(command).filter((field) => field.source === "argument");
}
