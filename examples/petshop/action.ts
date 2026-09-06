/**
 * The declaration shape, tried on before the machinery moves.
 *
 * An action declares its input once, as JSON Schema, and says which surfaces
 * render it. Everything a surface needs is either in that schema or derived
 * from it: the MCP `inputSchema` is the schema itself, the HTTP body is the
 * fields the path did not take, and the command line is the same fields with a
 * spelling attached.
 *
 * This file translates one into the `CommandDefinition` the current engine
 * takes, so the shape can be run on all three surfaces before anything inside
 * `src/` changes. What survives the move is the types and `check`; the
 * translation at the bottom is scaffolding.
 */

import { coerce, type Coercer, type CommandDefinition, type JsonSchemaFragment, type Registry } from "softcli";

/**
 * The JSON Schema subset this enforces.
 *
 * Nothing is carried that is not checked: a keyword an agent is shown and a
 * request is not held to is worse than one nobody wrote, because it reads as a
 * promise. `$ref`, `anyOf` and friends are absent for that reason rather than
 * from lack of interest.
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
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
}

/**
 * How one field is typed at a terminal. Spelling, never shape.
 *
 * `flag` only where it is not the field's own name, `value` only where the
 * placeholder in the help text should read as something other than the type.
 */
export interface CliField {
  flag?: string;
  short?: string;
  value?: string;
}

/** One input field: what the value is, and how a terminal spells it. */
export type Field = JsonSchema & { cli?: CliField };

/** Which surfaces render an action. Presence is the switch. */
export interface Surfaces {
  cli?: { pattern: readonly string[] };
  http?: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };
  mcp?: boolean;
}

/** The TypeScript type a field's schema describes. */
export type Value<S> =
  S extends { enum: readonly (infer E)[] } ? E
    : S extends { const: infer C } ? C
      : S extends { type: "string" } ? string
        : S extends { type: "integer" | "number" } ? number
          : S extends { type: "boolean" } ? boolean
            : S extends { type: "array"; items: infer I } ? Value<I>[]
              : unknown;

/** Whether a field is always there: named in `required`, or carrying a default. */
type Always<I, R extends readonly string[], K extends keyof I> =
  K extends R[number] ? true : I[K] extends { default: unknown } ? true : false;

/** The object a handler is given, typed from the schemas that produced it. */
export type Input<I, R extends readonly string[]> =
  { [K in keyof I as Always<I, R, K> extends true ? K : never]: Value<I[K]> }
  & { [K in keyof I as Always<I, R, K> extends true ? never : K]?: Value<I[K]> };

export interface ActionDefinition<
  I extends Record<string, Field>,
  R extends readonly (keyof I & string)[],
  Deps extends object,
> {
  id: string;
  group?: string;
  summary: string;
  description?: string;
  needs?: readonly string[];
  input: I;
  required?: R;
  surfaces: Surfaces;
  run(context: { input: Input<I, R> } & Deps): unknown;
}

/** What a person is told the field accepts, built from the schema alone. */
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

  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    return `${schema.minLength} to ${schema.maxLength} characters`;
  }
  if (schema.minLength !== undefined) return `at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`;
  if (schema.maxLength !== undefined) return `at most ${schema.maxLength} character${schema.maxLength === 1 ? "" : "s"}`;
  if (schema.pattern !== undefined) return `text matching ${schema.pattern}`;
  return "text";
}

/** A value read from text, by the type the schema names. */
export function decode(raw: string, schema: JsonSchema): unknown {
  if (schema.type === "integer" || schema.type === "number") return Number(raw);
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
 * The only place a constraint is enforced, so what an agent is shown and what a
 * request is held to cannot come apart - which is what happened when the bound
 * lived in a parse function and the schema beside it was written by hand.
 */
export function check(value: unknown, schema: JsonSchema, label: string): void {
  const fault = (): never => { throw new Error(`${label} must be ${expectationOf(schema)}`); };

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
    if (schema.items !== undefined) {
      for (const one of value as unknown[]) check(one, schema.items, label);
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") fault();
    const text = value as string;
    if (schema.minLength !== undefined && text.length < schema.minLength) fault();
    if (schema.maxLength !== undefined && text.length > schema.maxLength) fault();
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(text)) fault();
  }
}

/**
 * The schema as the current engine's `Coercer`.
 *
 * `parse` decodes and then checks, so the rules hold on every surface - the
 * command line hands it text, and an object arriving over HTTP or MCP is
 * stringified into the same door.
 *
 * The cast is the one piece of scaffolding here: `JsonSchemaFragment` predates
 * `minLength`, `maxLength` and `pattern`, so the fuller schema travels as a
 * runtime value that its own type does not admit. Moving the machinery is what
 * removes it.
 */
function coercerFor(field: Field): Coercer<unknown> {
  // The spelling is softcli's and the rest is the schema. Unknown keywords are
  // legal JSON Schema, so leaving `cli` in would validate fine and still put
  // `"cli": { "short": "-a" }` in front of a model reading the tool.
  const { cli: _spelling, ...schema } = field;
  return {
    expects: expectationOf(schema),
    jsonSchema: schema as JsonSchemaFragment,
    ...(schema.enum === undefined ? {} : { candidates: schema.enum.map(String) }),
    parse(raw: string, label: string): unknown {
      const value = decode(raw, schema);
      check(value, schema, label);
      return value;
    },
  };
}

/** `dryRun` -> `--dry-run`, so a flag is not spelled twice. */
const flagFor = (name: string): string => `--${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`;

/** The `:slot` names a cli pattern takes, in order. */
const slotsOf = (pattern: readonly string[]): string[] =>
  pattern.filter((word) => word.startsWith(":")).map((word) => word.replace(/^:|\.\.\.$|\?$/gu, ""));

/**
 * One action, as the command the current engine registers.
 *
 * Every surface is fed from the same declaration: the pattern says which fields
 * are positional and the rest become options, `mcp` passes the flag through,
 * and `http` goes where `softcli/remote` already looks for it.
 */
export function action<
  I extends Record<string, Field>,
  const R extends readonly (keyof I & string)[],
  Deps extends object,
>(registry: Registry, definition: ActionDefinition<I, R, Deps>): void {
  const { input, surfaces } = definition;
  const pattern = surfaces.cli?.pattern ?? ["__no_cli__", definition.id];
  const slots = slotsOf(pattern);
  const required = definition.required ?? [];

  const args: Record<string, { description?: string; coerce: Coercer<unknown> }> = {};
  for (const name of slots) {
    const field = input[name];
    if (field === undefined) throw new Error(`${definition.id}: the pattern names :${name}, which is not an input field`);
    args[name] = {
      ...(field.description === undefined ? {} : { description: field.description }),
      coerce: coercerFor(field),
    };
  }

  const options = Object.entries(input)
    .filter(([name]) => !slots.includes(name))
    .map(([name, field]) => {
      const list = field.type === "array";
      const each = list ? field.items ?? { type: "string" } : field;
      return {
        name: field.cli?.flag ?? flagFor(name),
        ...(field.cli?.short === undefined ? {} : { short: field.cli.short }),
        ...(each.type === "boolean" && field.cli?.value === undefined
          ? {}
          : { value: field.cli?.value ?? "VALUE" }),
        description: field.description ?? "",
        ...(list ? { repeatable: true } : {}),
        ...(field.default === undefined ? {} : { default: field.default }),
        ...(required.includes(name as never) ? { required: true } : {}),
        coerce: coercerFor(each),
        field: name,
      };
    });

  const command: CommandDefinition = {
    id: definition.id,
    pattern,
    summary: definition.summary,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.group === undefined ? {} : { group: definition.group }),
    ...(definition.needs === undefined ? {} : { needs: definition.needs }),
    ...(Object.keys(args).length === 0 ? {} : { arguments: args }),
    ...(options.length === 0 ? {} : { options }),
    surfaces: {
      mcp: surfaces.mcp === true,
      cli: surfaces.cli !== undefined,
      docs: surfaces.cli !== undefined,
    },
    ...(surfaces.http === undefined ? {} : { meta: { http: surfaces.http } }),
    /*
     * The context is already the shape an action's handler wants: `input` is
     * the canonical object and each capability answers by its own name. It is
     * a proxy, so it is passed rather than copied - spreading one drops every
     * capability, which live in its `get` trap and not in its own keys.
     */
    run: (context) => definition.run(context as unknown as { input: Input<I, R> } & Deps),
  } as CommandDefinition;

  // The engine's generics are the command author's; an action declares its
  // capabilities as `needs` strings, so there is nothing to thread through here.
  registry.register(registry.command(command as never));
}

export { coerce };
