import {
  assertSupported,
  commandFor,
  compact,
  output,
  type ActionDefinition,
  type Command,
  type CommandContext,
  type CommandExample,
  type Field,
  type JsonSchema,
  type Output,
  type Surfaces,
} from "softcli";
import type { HttpBinding } from "softcli/remote";
import { defaultExecutors, type Executor, type ExecutorOptions, type StepResult } from "./executors.js";
import type { Scope } from "./values.js";

/**
 * A document, as the commands every surface already knows how to render.
 *
 * The seam is the same one a remote manifest and an OpenAPI specification go
 * through: something this library did not author becomes `ActionDefinition`s,
 * and everything after that - parsing, help, completion, `--json`, the
 * generated reference, HTTP routes, MCP tools - is code that already exists and
 * does not care where the description came from.
 *
 * Nothing here reads YAML. The reader takes parsed data, so JSON documents and
 * YAML documents are the same document and the parser is replaceable.
 */

/** How one value is spelled at a terminal. Spelling, never shape. */
const CLI_KEYS = ["flag", "short", "value", "hidden"] as const;

/** The JSON Schema keywords this library enforces, and therefore the ones a document may state. */
const SCHEMA_KEYS = [
  "type", "description", "enum", "const", "default",
  "minimum", "maximum", "minLength", "maxLength",
  "pattern", "format", "items", "properties", "required",
] as const;

const TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;

const DOCUMENT_KEYS = ["name", "version", "description", "config", "commands"] as const;

const COMMAND_KEYS = [
  "summary", "description", "group", "input", "required",
  "surfaces", "allowRemoteExec", "examples", "hidden", "run",
] as const;

const SURFACE_KEYS = ["cli", "http", "mcp", "docs"] as const;

export interface ReadOptions extends ExecutorOptions {
  /** What a document may name in `run`. The four built-in executors by default. */
  executors?: Readonly<Record<string, Executor>>;
  /** `{config.…}`. Whatever the document itself declared, unless a caller supplies its own. */
  config?: Readonly<Record<string, unknown>>;
}

/** One prepared step: which executor runs it, and that executor's own reading of it. */
interface Step {
  name: string;
  value: unknown;
}

interface ReadCommand {
  id: string;
  steps: Step[];
  action: ActionDefinition<never, never, Record<string, Field>, readonly string[]>;
  allowRemoteExec: boolean;
  published: string[];
}

/* -------------------------------------------------------------------------- */
/* Reading the shapes                                                          */
/* -------------------------------------------------------------------------- */

function asMap(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function only(map: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(map)) {
    if (!allowed.includes(key)) throw new Error(`${where} has no ${key}; it takes ${allowed.join(", ")}`);
  }
}

function asText(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} must be text`);
  return value;
}

function asTextList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${where} must be a list`);
  return value.map((one, at) => asText(one, `${where}[${at}]`));
}

function asFlag(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${where} is true or false`);
  return value;
}

/**
 * One input field, as the schema every surface is fed from.
 *
 * Only the keywords this library actually enforces are carried, and an unknown
 * one is refused rather than dropped: a document that writes `maxlength` and is
 * silently unbounded is the exact failure this design exists to prevent.
 */
function fieldFrom(raw: unknown, where: string): Field {
  const held = asMap(raw, where);
  only(held, [...SCHEMA_KEYS, "cli", "env"], where);

  const schema: Record<string, unknown> = {};
  for (const key of SCHEMA_KEYS) {
    if (held[key] !== undefined) schema[key] = held[key];
  }

  if (schema["type"] !== undefined && !(TYPES as readonly unknown[]).includes(schema["type"])) {
    throw new Error(`${where}: type is one of ${TYPES.join(", ")}`);
  }
  if (held["items"] !== undefined) schema["items"] = schemaFrom(held["items"], `${where}.items`);
  if (held["properties"] !== undefined) {
    schema["properties"] = Object.fromEntries(
      Object.entries(asMap(held["properties"], `${where}.properties`))
        .map(([name, property]) => [name, schemaFrom(property, `${where}.properties.${name}`)]));
  }
  assertSupported(schema as JsonSchema, where);

  const field = schema as Field;
  if (held["env"] !== undefined) field.env = asText(held["env"], `${where}.env`);
  if (held["cli"] !== undefined) {
    const cli = asMap(held["cli"], `${where}.cli`);
    only(cli, CLI_KEYS, `${where}.cli`);
    field.cli = {
      ...compact({
        flag: cli["flag"] === undefined ? undefined : asText(cli["flag"], `${where}.cli.flag`),
        short: cli["short"] === undefined ? undefined : asText(cli["short"], `${where}.cli.short`),
        value: cli["value"] === undefined ? undefined : asText(cli["value"], `${where}.cli.value`),
        hidden: cli["hidden"] === undefined ? undefined : asFlag(cli["hidden"], `${where}.cli.hidden`),
      }),
    };
  }
  return field;
}

/** A nested schema: the same keywords, without the terminal spelling a nested value cannot have. */
function schemaFrom(raw: unknown, where: string): JsonSchema {
  const held = asMap(raw, where);
  only(held, SCHEMA_KEYS, where);
  const schema: Record<string, unknown> = { ...held };
  if (schema["type"] !== undefined && !(TYPES as readonly unknown[]).includes(schema["type"])) {
    throw new Error(`${where}: type is one of ${TYPES.join(", ")}`);
  }
  if (held["items"] !== undefined) schema["items"] = schemaFrom(held["items"], `${where}.items`);
  return schema as JsonSchema;
}

function surfacesFrom(raw: unknown, id: string, where: string): Surfaces {
  if (raw === undefined || raw === null) return { cli: { pattern: id.split(".") } };
  const held = asMap(raw, where);
  only(held, SURFACE_KEYS, where);

  const surfaces: Surfaces = {};

  if (held["cli"] !== undefined) {
    const cli = asMap(held["cli"], `${where}.cli`);
    only(cli, ["pattern", "stdin"], `${where}.cli`);
    surfaces.cli = {
      pattern: cli["pattern"] === undefined
        ? id.split(".")
        : asTextList(cli["pattern"], `${where}.cli.pattern`),
      ...compact({ stdin: cli["stdin"] === undefined ? undefined : asText(cli["stdin"], `${where}.cli.stdin`) }),
    };
  }

  if (held["http"] !== undefined) {
    const http = asMap(held["http"], `${where}.http`);
    only(http, ["method", "path", "query", "body"], `${where}.http`);
    const method = asText(http["method"] ?? "", `${where}.http.method`).toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Error(`${where}.http: method is one of GET, POST, PUT, PATCH, DELETE`);
    }
    surfaces.http = {
      method: method as HttpBinding["method"],
      path: asText(http["path"], `${where}.http.path`),
      ...compact({
        query: http["query"] === undefined ? undefined : asTextList(http["query"], `${where}.http.query`),
        body: http["body"] === undefined ? undefined : asTextList(http["body"], `${where}.http.body`),
      }),
    };
  }

  if (held["mcp"] !== undefined) surfaces.mcp = asFlag(held["mcp"], `${where}.mcp`);
  if (held["docs"] !== undefined) surfaces.docs = asFlag(held["docs"], `${where}.docs`);

  // A command that names no surface at all would be unreachable; the terminal
  // is the reading a document without a `surfaces` block already meant.
  if (surfaces.cli === undefined && surfaces.http === undefined && surfaces.mcp !== true) {
    surfaces.cli = { pattern: id.split(".") };
  }
  return surfaces;
}

function examplesFrom(raw: unknown, where: string): CommandExample[] {
  if (!Array.isArray(raw)) throw new Error(`${where} must be a list`);
  return raw.map((one, at) => {
    const held = asMap(one, `${where}[${at}]`);
    only(held, ["command", "description"], `${where}[${at}]`);
    return {
      command: asText(held["command"], `${where}[${at}].command`),
      ...compact({
        description: held["description"] === undefined
          ? undefined
          : asText(held["description"], `${where}[${at}].description`),
      }),
    };
  });
}

/**
 * `run`, as the list of steps it always is.
 *
 * A single step may be written unwrapped, because most commands have one and
 * making everybody type a list for it is a tax on the common case. A bare name
 * is the same thing with nothing to configure, which is what `run: noop` is.
 */
function stepsFrom(raw: unknown, where: string): { name: string; raw: unknown }[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((one, at) => {
    const label = Array.isArray(raw) ? `${where}[${at}]` : where;
    if (typeof one === "string") return { name: one, raw: {} };

    const held = asMap(one, label);
    const names = Object.keys(held);
    if (names.length === 0) throw new Error(`${label} names no executor`);
    if (names.length > 1) {
      throw new Error(`${label} names ${names.join(" and ")}: one step is one executor, and several steps are a list`);
    }
    return { name: names[0]!, raw: held[names[0]!] };
  });
}

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

export interface DocumentProgram {
  name: string;
  version: string;
  description?: string;
}

/** What the document says about itself, for the program that hosts it. */
export function programOf(raw: unknown, fallback: DocumentProgram): DocumentProgram {
  const document = asMap(raw, "the document");
  return {
    name: document["name"] === undefined ? fallback.name : asText(document["name"], "name"),
    version: document["version"] === undefined ? fallback.version : asText(document["version"], "version"),
    ...compact({
      description: document["description"] === undefined
        ? fallback.description
        : asText(document["description"], "description"),
    }),
  };
}

export function configOf(raw: unknown): Record<string, unknown> {
  const document = asMap(raw, "the document");
  return document["config"] === undefined ? {} : asMap(document["config"], "config");
}

/**
 * The document's commands, ready to register.
 *
 * Everything that can be wrong is raised here rather than when somebody runs
 * something: an unknown executor, a placeholder naming no field, an `internal`
 * step calling a command that is not declared, a cycle between two of them, and
 * a command that would publish a process to the network.
 */
export function commandsFromDocument(raw: unknown, options: ReadOptions = {}): Command[] {
  const document = asMap(raw, "the document");
  for (const key of ["imports", "env"]) {
    if (document[key] !== undefined) {
      throw new Error(`${key} is resolved when the document is loaded; this reader takes a composed document`);
    }
  }
  only(document, DOCUMENT_KEYS, "the document");

  const config = options.config ?? configOf(document);
  const executors = options.executors ?? defaultExecutors(options);
  const environment = options.environment ?? process.env;

  const commands = asMap(document["commands"] ?? {}, "commands");
  const ids = new Set(Object.keys(commands));
  if (ids.size === 0) throw new Error("the document declares no commands");

  const read = Object.entries(commands).map(([id, body]) =>
    readCommand(id, body, ids, executors));

  refuseCycles(read, executors);
  refuseRemoteExecution(read, executors);

  return read.map((one) => commandFor({
    ...one.action,
    run: (context: CommandContext): Promise<Output> => runSteps(one, executors, {
      input: context.input,
      env: environment,
      config,
    }, context),
  } as unknown as ActionDefinition<never, never, Record<string, Field>, readonly string[]>));
}

function readCommand(
  id: string,
  body: unknown,
  ids: ReadonlySet<string>,
  executors: Readonly<Record<string, Executor>>,
): ReadCommand {
  const held = asMap(body, id);
  only(held, COMMAND_KEYS, id);

  const input = Object.fromEntries(
    Object.entries(asMap(held["input"] ?? {}, `${id}.input`))
      .map(([name, field]) => [name, fieldFrom(field, `${id}.input.${name}`)]));
  const fields = new Set(Object.keys(input));

  const required = held["required"] === undefined ? [] : asTextList(held["required"], `${id}.required`);
  for (const name of required) {
    if (!fields.has(name)) throw new Error(`${id}.required names ${name}, which is not an input field`);
  }

  const surfaces = surfacesFrom(held["surfaces"], id, `${id}.surfaces`);
  if (surfaces.cli?.stdin !== undefined && !fields.has(surfaces.cli.stdin)) {
    throw new Error(`${id}.surfaces.cli.stdin names ${surfaces.cli.stdin}, which is not an input field`);
  }

  if (held["run"] === undefined) throw new Error(`${id} has no run: a command has to say what it does`);
  const steps = stepsFrom(held["run"], `${id}.run`).map(({ name, raw }, at) => {
    const executor = executors[name];
    if (executor === undefined) {
      throw new Error(`${id}.run names the executor ${name}, and this program has ${Object.keys(executors).sort().join(", ")}`);
    }
    return { name, value: executor.prepare(raw, { where: `${id} step ${at + 1} (${name})`, fields, commands: ids }) };
  });

  const published: string[] = [];
  if (surfaces.mcp === true) published.push("an MCP tool");
  if (surfaces.http !== undefined) published.push("an HTTP route");

  const action = {
    id,
    summary: asText(held["summary"] ?? "", `${id}.summary`),
    input,
    surfaces,
    ...compact({
      description: held["description"] === undefined ? undefined : asText(held["description"], `${id}.description`),
      group: held["group"] === undefined ? undefined : asText(held["group"], `${id}.group`),
      required: required.length === 0 ? undefined : required,
      examples: held["examples"] === undefined ? undefined : examplesFrom(held["examples"], `${id}.examples`),
      hidden: held["hidden"] === undefined ? undefined : asFlag(held["hidden"], `${id}.hidden`),
    }),
    run: () => {},
  } as unknown as ActionDefinition<never, never, Record<string, Field>, readonly string[]>;

  return {
    id,
    steps,
    action,
    allowRemoteExec: held["allowRemoteExec"] === undefined
      ? false
      : asFlag(held["allowRemoteExec"], `${id}.allowRemoteExec`),
    published,
  };
}

/* -------------------------------------------------------------------------- */
/* Publication safety                                                          */
/* -------------------------------------------------------------------------- */

function callsOf(command: ReadCommand, executors: Readonly<Record<string, Executor>>): string[] {
  return command.steps.flatMap((step) => [...(executors[step.name]!.calls?.(step.value) ?? [])]);
}

/** `internal` makes a graph, and a graph can close on itself; a document should not hang. */
function refuseCycles(read: readonly ReadCommand[], executors: Readonly<Record<string, Executor>>): void {
  const byId = new Map(read.map((one) => [one.id, one]));

  const walk = (id: string, seen: readonly string[]): void => {
    if (seen.includes(id)) throw new Error(`${[...seen, id].join(" -> ")} call each other`);
    for (const next of callsOf(byId.get(id)!, executors)) walk(next, [...seen, id]);
  };
  for (const one of read) walk(one.id, []);
}

/**
 * A command that runs a process must not become a tool or a route by accident.
 *
 * `surfaces.mcp` being off by default already prevents the worst of it, but a
 * document is a file anybody can edit: if MCP came for free, one more line in a
 * YAML file would hand an agent arbitrary shell. So the opt-in is a second one,
 * separate from `surfaces`, and it is refused at registration rather than
 * quietly dropped - a surface silently missing is a surface somebody debugs.
 *
 * The unsafety travels through `internal`: a command whose only step calls
 * another command that runs a process is a command that runs a process.
 */
function refuseRemoteExecution(
  read: readonly ReadCommand[],
  executors: Readonly<Record<string, Executor>>,
): void {
  const byId = new Map(read.map((one) => [one.id, one]));

  const unsafeIn = (id: string, seen: readonly string[]): string | undefined => {
    if (seen.includes(id)) return undefined;
    const command = byId.get(id);
    if (command === undefined) return undefined;
    const own = command.steps.find((step) => !executors[step.name]!.remoteSafe);
    if (own !== undefined) return seen.length === 0 ? own.name : `${own.name} in ${id}`;
    for (const next of callsOf(command, executors)) {
      const found = unsafeIn(next, [...seen, id]);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  for (const command of read) {
    if (command.published.length === 0 || command.allowRemoteExec) continue;
    const unsafe = unsafeIn(command.id, []);
    if (unsafe === undefined) continue;
    throw new Error(
      `${command.id} runs ${unsafe} and is published as ${command.published.join(" and ")}. `
      + "A document must not hand a process to an agent or to the network by declaring a surface. "
      + `Write allowRemoteExec: true on ${command.id} if that is what it is for.`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Running                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The steps, in order, stopping at the first failure.
 *
 * A command with one step answers with that step's value, and a command with
 * several answers with the list - the shape is fixed per command, which is what
 * `--json` needs, and the list is what a batch actually produced.
 */
async function runSteps(
  command: ReadCommand,
  executors: Readonly<Record<string, Executor>>,
  scope: Scope,
  context: { surface: string; signal: AbortSignal | undefined; error(text: string): void },
): Promise<Output> {
  const results: StepResult[] = [];
  for (const step of command.steps) {
    results.push(await executors[step.name]!.run(step.value, {
      input: scope.input,
      scope,
      surface: context.surface,
      signal: context.signal,
      error: (text) => { context.error(text); },
    }));
  }

  const data = results.length === 1 ? results[0]!.data : results.map((one) => one.data);
  const plain = results.map((one) => one.plain ?? "").join("");
  return plain === "" ? output(data) : output(data, plain);
}
