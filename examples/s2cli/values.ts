import { ArgumentError } from "softcli";

/**
 * What a document may put where a value goes, and how little that is.
 *
 * There is no template language here on purpose. `{{#if force}}--force{{/if}}`
 * means a dependency, an argument list that gets re-parsed, and a document
 * whose behaviour nothing can inspect. The input is already validated and
 * typed, so the two things a template is actually used for - a conditional and
 * a repetition - are written as data instead:
 *
 *   { when: force, value: "--force" }
 *   { each: files, value: "{$item}" }
 *
 * Uglier for one case, inspectable for all of them, and a registration-time
 * check can say that `{envv}` names nothing rather than quietly producing the
 * word "undefined" in a deploy script.
 */

/** A value in a step. A list element may also be a condition or a repetition. */
export type Argument =
  | string
  | number
  | boolean
  | null
  | readonly Argument[]
  | { readonly when: string; readonly value: Argument }
  | { readonly each: string; readonly value: Argument };

/**
 * What `{...}` is resolved against.
 *
 * `input` is the canonical input, so a placeholder names a field the same way
 * every surface does. `env` and `config` are the two namespaces a document
 * needs and cannot state itself; `item` exists only inside an `each`.
 */
export interface Scope {
  readonly input: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly config: Readonly<Record<string, unknown>>;
  readonly item?: unknown;
}

/**
 * What `$` may name, which is everything that is not an input field.
 *
 * One rule with no exception: a name without the sigil is the input, all the
 * way down, so `{env}` is the field a deploy command always has and
 * `{theme.mode}` reaches into a structured one. Without the sigil there is no
 * rule that covers both, because a bare name would have to be the input and a
 * dotted name a namespace - which is exactly the point at which input subpaths
 * stop being expressible.
 *
 * `$item` rather than a bare `$`, for the same reason `{item}` beat `{}`: it
 * takes a path (`{$item.name}`) and it can say which loop it belongs to.
 */
const NAMESPACES = ["$env", "$config", "$item"] as const;

/** The namespaces that are a value in themselves rather than a thing to path into. */
const WHOLE_NAMESPACES = ["$item"] as const;

const WHOLE = /^\{([^{}]+)\}$/u;
const PARTS = /\{\{|\}\}|\{([^{}]*)\}/gu;

export interface ArgumentScope {
  /** The input fields this command declared: what a bare path is allowed to name. */
  readonly fields: ReadonlySet<string>;
  /** Whether `{$item}` and the `each` form are in scope. */
  readonly item?: boolean;
}

/**
 * Where a value sits, which is what decides whether it may be dropped or repeated.
 *
 * `when` omits whatever it is attached to, so it works on a list element and on
 * a mapping entry - "send this body field only if it was given" is the ordinary
 * case for an optional input. `each` repeats, so only a list can hold it. A
 * lone value - a command, an endpoint - is neither: there is nothing there to
 * drop it from.
 */
export type Position = "single" | "entry" | "list";

/**
 * Everything wrong with an argument that can be known before anybody runs it.
 *
 * Called while the document is read, so a misspelled field is a crash on the
 * first run of the binary rather than an empty string in the middle of a deploy.
 */
export function checkArgument(
  argument: unknown,
  where: string,
  scope: ArgumentScope,
  position: Position = "single",
): void {
  if (argument === null || typeof argument === "number" || typeof argument === "boolean") return;

  if (typeof argument === "string") {
    for (const path of pathsIn(argument)) checkPath(path, `${where}: {${path}}`, scope);
    return;
  }

  if (Array.isArray(argument)) {
    argument.forEach((one, at) => { checkArgument(one, `${where}[${at}]`, scope, "list"); });
    return;
  }

  if (typeof argument !== "object") {
    throw new Error(`${where} is a ${typeof argument}, which is not a value a step can take`);
  }

  const held = argument as Record<string, unknown>;
  const keys = Object.keys(held);
  const kind = keys.includes("when") ? "when" : keys.includes("each") ? "each" : undefined;

  if (kind === undefined) {
    throw new Error(`${where} is an object, and the only objects a step value may hold are { when, value } and { each, value }`);
  }
  if (position === "single") {
    throw new Error(`${where} uses ${kind}, and a lone value has nothing to drop it from: ${kind} belongs in a list${kind === "when" ? " or a mapping entry" : ""}`);
  }
  if (kind === "each" && position !== "list") {
    throw new Error(`${where} uses each, which repeats a value, so it belongs in a list`);
  }
  for (const key of keys) {
    if (key !== kind && key !== "value") throw new Error(`${where} has no ${key}: a ${kind} step value takes ${kind} and value`);
  }
  if (!keys.includes("value")) throw new Error(`${where} has ${kind} but no value`);

  const named = held[kind];
  if (typeof named !== "string" || named === "") {
    throw new Error(`${where}: ${kind} names an input field, as text`);
  }
  checkPath(named, `${where}: ${kind}: ${named}`, scope);
  checkArgument(
    held["value"],
    `${where}.value`,
    { ...scope, ...(kind === "each" ? { item: true } : {}) },
    position,
  );
}

/** Which `{...}` a piece of text holds, with `{{` and `}}` read as literal braces. */
export function pathsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PARTS)) {
    const path = match[1];
    if (path !== undefined) found.push(path);
  }
  return found;
}

function checkPath(path: string, where: string, scope: ArgumentScope): void {
  if (path === "") throw new Error(`${where} names nothing`);
  const dot = path.indexOf(".");
  const root = dot === -1 ? path : path.slice(0, dot);

  if (root.startsWith("$")) {
    if (!(NAMESPACES as readonly string[]).includes(root)) {
      throw new Error(`${where}: ${root} is not a name this program knows, and it has ${NAMESPACES.join(", ")}`);
    }
    if (root === "$item" && scope.item !== true) {
      throw new Error(`${where}: $item is only in scope inside an each`);
    }
    if (dot === -1 && !(WHOLE_NAMESPACES as readonly string[]).includes(root)) {
      throw new Error(`${where}: ${root} is a namespace, so it needs a path into it, as ${root}.something`);
    }
    return;
  }

  if (!scope.fields.has(root)) {
    const known = [...scope.fields].sort().join(", ");
    const hint = root === "item" && scope.item === true ? "; the value of an each is {$item}" : "";
    throw new Error(`${where} is not an input field of this command${known === "" ? "" : ` (it has ${known})`}${hint}`);
  }
}

/**
 * A path against the scope, walked segment by segment.
 *
 * `found` is what separates an absent value from a null one, so an optional
 * input that was never given faults by name rather than becoming the word
 * "undefined" in the middle of a deploy script.
 */
function lookup(path: string, scope: Scope): { found: boolean; value: unknown } {
  const dot = path.indexOf(".");
  const root = dot === -1 ? path : path.slice(0, dot);
  const rest = dot === -1 ? [] : path.slice(dot + 1).split(".");

  let current: unknown;
  if (root === "$env") current = scope.env;
  else if (root === "$config") current = scope.config;
  else if (root === "$item") current = scope.item;
  else current = scope.input[root];

  for (const segment of rest) {
    if (typeof current !== "object" || current === null) return { found: false, value: undefined };
    const held = current as Record<string, unknown>;
    if (!(segment in held)) return { found: false, value: undefined };
    current = held[segment];
  }
  return { found: current !== undefined, value: current };
}

/**
 * Text with its placeholders filled.
 *
 * A string that is nothing but one placeholder keeps the value's own type, so
 * a number in a request body stays a number; anything else is text and the
 * values are spelled into it.
 */
export function interpolate(text: string, scope: Scope, where: string): unknown {
  const whole = WHOLE.exec(text);
  if (whole !== null) return resolvePath(whole[1]!, scope, where);

  return text.replaceAll(PARTS, (match, path: string | undefined) => {
    if (path === undefined) return match === "{{" ? "{" : "}";
    return String(resolvePath(path, scope, where));
  });
}

function resolvePath(path: string, scope: Scope, where: string): unknown {
  const { found, value } = lookup(path, scope);
  if (!found) throw new ArgumentError(`${where} needs {${path}}, and nothing gave it a value`);
  return value;
}

/**
 * Whether a `when` lets its value through.
 *
 * The readings a person means: a false flag, an empty string, an empty list and
 * an absent value are all "no". A zero is *not*, because a count of zero is a
 * value somebody chose.
 */
function truthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** One value, for the places that take exactly one: a command, an endpoint, a header. */
export function resolveValue(argument: Argument, scope: Scope, where: string): unknown {
  if (typeof argument === "string") return interpolate(argument, scope, where);
  if (Array.isArray(argument)) {
    throw new Error(`${where} is a list, and this takes one value`);
  }
  return argument as unknown;
}

/**
 * One mapping entry: a body field, a header, a query parameter.
 *
 * `present` is false when a `when` said no, and an absent entry is left out of
 * the request rather than sent as null - which is the difference between "I did
 * not say" and "I said nothing".
 */
export function resolveEntry(
  argument: Argument,
  scope: Scope,
  where: string,
): { present: boolean; value: unknown } {
  if (argument !== null && typeof argument === "object" && !Array.isArray(argument)) {
    const held = argument as { when: string; value: Argument };
    if (!truthy(lookup(held.when, scope).value)) return { present: false, value: undefined };
    return resolveEntry(held.value, scope, where);
  }
  if (Array.isArray(argument)) return { present: true, value: resolveList(argument, scope, where) };
  return { present: true, value: resolveValue(argument, scope, where) };
}

/** A list, with the conditions applied and the repetitions expanded, in order. */
export function resolveList(args: readonly Argument[], scope: Scope, where: string): unknown[] {
  const out: unknown[] = [];

  args.forEach((argument, at) => {
    const label = `${where}[${at}]`;

    if (argument !== null && typeof argument === "object" && !Array.isArray(argument)) {
      const held = argument as { when?: string; each?: string; value: Argument };

      if (held.when !== undefined) {
        if (truthy(lookup(held.when, scope).value)) out.push(...resolveList([held.value], scope, label));
        return;
      }

      const source = lookup(held.each!, scope).value;
      if (source === undefined || source === null) return;
      if (!Array.isArray(source)) {
        throw new ArgumentError(`${label}: each names ${held.each!}, which is not a list`);
      }
      for (const item of source as unknown[]) {
        out.push(...resolveList([held.value], { ...scope, item }, label));
      }
      return;
    }

    if (Array.isArray(argument)) {
      out.push(...resolveList(argument, scope, label));
      return;
    }
    out.push(resolveValue(argument, scope, label));
  });

  return out;
}
