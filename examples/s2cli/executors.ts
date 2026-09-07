import { spawn } from "node:child_process";
import {
  canonicalFromObject,
  compact,
  SoftcliError,
  ConfigurationError,
  type Runner,
  type Surface,
} from "softcli";
import { httpTransport, type HttpBinding } from "softcli/remote";
import {
  checkArgument,
  resolveEntry,
  resolveList,
  resolveValue,
  type Argument,
  type Scope,
} from "./values.js";

/**
 * Named execution, because a document cannot hold a function.
 *
 * This is the one thing `s2cli` adds to the model. Everything else a document
 * declares - the input schemas, the surfaces, the summary - already exists;
 * `run` is where an action holds a closure, and a YAML file has to state that
 * as data instead. So execution is a *named* executor and an ordered list of
 * steps, and the name is registered here rather than discovered at run time.
 *
 * Each executor validates its own step when the document is read. By the time
 * anything runs, everything that could have been wrong about the step is
 * already a startup error.
 */

export interface StepResult {
  data: unknown;
  /** What a person is shown, when this step has a better answer than its data. */
  plain?: string;
}

export interface PrepareContext {
  /** How this step is named in an error: `deploy step 2 (exec)`. */
  where: string;
  /** The command's input field names: what a `{placeholder}` may name. */
  fields: ReadonlySet<string>;
  /** Every command the document declares, so `internal` cannot name one that is not there. */
  commands: ReadonlySet<string>;
}

export interface StepContext {
  readonly input: Readonly<Record<string, unknown>>;
  readonly scope: Scope;
  readonly surface: Surface;
  readonly signal: AbortSignal | undefined;
  /** A line on stderr: what a wrapped process wrote there stays there. */
  error(text: string): void;
}

export interface Executor {
  /**
   * Whether a command holding this step may be published off this machine.
   *
   * False is a claim about the executor rather than about a document: `exec`
   * runs a process, and a file anybody can edit must not be able to hand that
   * to an agent or to an HTTP route by writing one more line.
   */
  readonly remoteSafe: boolean;
  prepare(raw: unknown, context: PrepareContext): unknown;
  run(step: unknown, context: StepContext): Promise<StepResult>;
  /** Command ids this step hands control to. Read for the safety closure and the cycle check. */
  calls?(step: unknown): readonly string[];
}

/** One executor, with its step type erased so a registry can hold all of them. */
function executor<S>(spec: {
  remoteSafe: boolean;
  prepare(raw: unknown, context: PrepareContext): S;
  run(step: S, context: StepContext): Promise<StepResult>;
  calls?(step: S): readonly string[];
}): Executor {
  return {
    remoteSafe: spec.remoteSafe,
    prepare: (raw, context) => spec.prepare(raw, context),
    run: (step, context) => spec.run(step as S, context),
    ...(spec.calls === undefined ? {} : { calls: (step: unknown) => spec.calls!(step as S) }),
  };
}

export interface ExecutorOptions {
  /** The registry the document was registered into. A thunk, because it does not exist yet when the document is read. */
  runner?: () => Runner;
  /** Where a relative `command` or `cwd` is taken from. The document's own directory by default. */
  directory?: string;
  /** What a process inherits and what `{env.NAME}` reads. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Injectable, so a test never opens a socket. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Reading a step's own fields                                                */
/* -------------------------------------------------------------------------- */

function asMap(value: unknown, where: string): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function only(map: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(map)) {
    if (!allowed.includes(key)) {
      throw new Error(`${where} has no ${key}; it takes ${allowed.join(", ")}`);
    }
  }
}

function required(map: Record<string, unknown>, key: string, where: string): unknown {
  const value = map[key];
  if (value === undefined || value === null) throw new Error(`${where} needs ${key}`);
  return value;
}

function asArgument(value: unknown, where: string, fields: ReadonlySet<string>): Argument {
  checkArgument(value, where, { fields }, "single");
  return value as Argument;
}

function asArgumentList(value: unknown, where: string, fields: ReadonlySet<string>): Argument[] {
  if (!Array.isArray(value)) {
    throw new Error(`${where} must be a list; it is never read as a command line`);
  }
  checkArgument(value, where, { fields }, "list");
  return value as Argument[];
}

/** A mapping whose values are step arguments: headers, a query, a request body. */
function asArgumentMap(
  value: unknown,
  where: string,
  fields: ReadonlySet<string>,
): Record<string, Argument> {
  const map = asMap(value, where);
  for (const [name, item] of Object.entries(map)) {
    checkArgument(item, `${where}.${name}`, { fields }, "entry");
  }
  return map as Record<string, Argument>;
}

function resolveMap(
  map: Readonly<Record<string, Argument>>,
  scope: Scope,
  where: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, argument] of Object.entries(map)) {
    const { present, value } = resolveEntry(argument, scope, `${where}.${name}`);
    if (present) out[name] = value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* noop                                                                       */
/* -------------------------------------------------------------------------- */

interface NoopStep {
  message: string | undefined;
}

/** Nothing, on purpose: the command that exists to hold subcommands under its word. */
const noop = executor<NoopStep>({
  remoteSafe: true,
  prepare(raw, context) {
    const step = asMap(raw, context.where);
    only(step, ["message"], context.where);
    const message = step["message"];
    if (message !== undefined && typeof message !== "string") {
      throw new Error(`${context.where}: message is a line of text`);
    }
    return { message: message as string | undefined };
  },
  run: async (step) => ({
    data: step.message ?? null,
    ...compact({ plain: step.message === undefined ? undefined : `${step.message}\n` }),
  }),
});

/* -------------------------------------------------------------------------- */
/* internal                                                                   */
/* -------------------------------------------------------------------------- */

interface InternalStep {
  command: string;
  input: Record<string, Argument>;
}

/**
 * Another command of the same registry, run through the same front door.
 *
 * `registry.execute` rather than a direct call, so the target's own schema,
 * defaults and capabilities apply exactly as they would to anybody else - a
 * command called from a document is not a command with the checks turned off.
 */
function internalExecutor(options: ExecutorOptions): Executor {
  return executor<InternalStep>({
    remoteSafe: true,
    prepare(raw, context) {
      const step = asMap(raw, context.where);
      only(step, ["command", "input"], context.where);
      const command = required(step, "command", context.where);
      if (typeof command !== "string") throw new Error(`${context.where}: command names another command, as text`);
      if (!context.commands.has(command)) {
        throw new Error(`${context.where} calls ${command}, which this document does not declare`);
      }
      return { command, input: asArgumentMap(step["input"], `${context.where}.input`, context.fields) };
    },
    calls: (step) => [step.command],
    async run(step, context) {
      const runner = options.runner?.();
      if (runner === undefined) {
        throw new ConfigurationError(`${step.command} cannot be called: this document was read without a registry`);
      }
      const target = runner.find(step.command);
      if (target === undefined) {
        throw new ConfigurationError(`${step.command} is not registered`);
      }
      const raw = resolveMap(step.input, context.scope, `${step.command} input`);
      const input = await canonicalFromObject(target, raw);
      const result = await runner.execute(target, {
        surface: context.surface,
        input,
        ...compact({ signal: context.signal }),
      });
      const plain = typeof result?.plain === "function" ? result.plain() : result?.plain;
      return { data: result?.data ?? null, ...compact({ plain }) };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* exec                                                                       */
/* -------------------------------------------------------------------------- */

interface ExecStep {
  command: Argument;
  args: Argument[];
  cwd: Argument | undefined;
  env: Record<string, Argument>;
  shell: boolean;
}

/** A step whose process answered with something other than success. */
export class StepError extends SoftcliError {
  public readonly code: number | null;

  public constructor(message: string, code: number | null) {
    super("conflict", message);
    this.code = code;
  }
}

/**
 * One process, given its arguments as argv.
 *
 * `args` is a list and is never joined into a command line, because
 * interpolating a value into a shell string is command injection the moment
 * that value comes from anywhere but the author's own keyboard - and here it
 * comes from whoever typed the command. `shell: true` is the way to ask for the
 * other behaviour, and asking is the point.
 */
function execExecutor(options: ExecutorOptions): Executor {
  return executor<ExecStep>({
    remoteSafe: false,
    prepare(raw, context) {
      const step = asMap(raw, context.where);
      only(step, ["command", "args", "cwd", "env", "shell"], context.where);

      const shell = step["shell"] ?? false;
      if (typeof shell !== "boolean") throw new Error(`${context.where}: shell is true or false`);
      if (shell && step["args"] !== undefined) {
        throw new Error(`${context.where} is a shell step, so it is one command line: put the arguments in command`);
      }

      return {
        command: asArgument(required(step, "command", context.where), `${context.where}.command`, context.fields),
        args: step["args"] === undefined
          ? []
          : asArgumentList(step["args"], `${context.where}.args`, context.fields),
        cwd: step["cwd"] === undefined
          ? undefined
          : asArgument(step["cwd"], `${context.where}.cwd`, context.fields),
        env: asArgumentMap(step["env"], `${context.where}.env`, context.fields),
        shell,
      };
    },
    async run(step, context) {
      const command = String(resolveValue(step.command, context.scope, "command"));
      const args = resolveList(step.args, context.scope, "args").map(String);
      const cwd = step.cwd === undefined
        ? options.directory
        : String(resolveValue(step.cwd, context.scope, "cwd"));

      const environment: Record<string, string> = {};
      for (const [name, value] of Object.entries({
        ...options.environment,
        ...resolveMap(step.env, context.scope, "env"),
      })) {
        if (value !== undefined && value !== null) environment[name] = String(value);
      }

      const child = spawn(command, args, {
        env: environment,
        shell: step.shell,
        stdio: ["ignore", "pipe", "pipe"],
        ...compact({ cwd, signal: context.signal }),
      });

      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });

      const code = await new Promise<number | null>((done, failed) => {
        child.on("error", (error) => { failed(new StepError(`${command} could not be run: ${error.message}`, null)); });
        child.on("close", (status) => { done(status); });
      });

      if (err !== "") context.error(err);
      if (code !== 0) {
        throw new StepError(`${command} exited with ${code === null ? "a signal" : String(code)}`, code);
      }
      return { data: { command, args, code, stdout: out, stderr: err }, plain: out };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* rest                                                                       */
/* -------------------------------------------------------------------------- */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface RestStep {
  method: HttpBinding["method"];
  endpoint: Argument;
  query: Record<string, Argument>;
  body: Record<string, Argument>;
  headers: Record<string, Argument>;
}

/**
 * One HTTP call, made by the transport a remote command already uses.
 *
 * Not a second HTTP client: `httpTransport` owns the timeout, the JSON, the
 * distinction between "the server refused you" and "the server did not answer",
 * and the exit code each of those becomes. A document naming a URL should reach
 * exactly the same behaviour a manifest-driven command does.
 */
function restExecutor(options: ExecutorOptions): Executor {
  return executor<RestStep>({
    remoteSafe: true,
    prepare(raw, context) {
      const step = asMap(raw, context.where);
      only(step, ["method", "endpoint", "query", "body", "headers"], context.where);

      const method = String(required(step, "method", context.where)).toUpperCase();
      if (!(METHODS as readonly string[]).includes(method)) {
        throw new Error(`${context.where}: method is one of ${METHODS.join(", ")}`);
      }

      const endpoint = asArgument(
        required(step, "endpoint", context.where),
        `${context.where}.endpoint`,
        context.fields,
      );
      // A URL with nothing to interpolate can be checked now rather than on the
      // day somebody runs the command.
      if (typeof endpoint === "string" && !endpoint.includes("{") && !isAbsolute(endpoint)) {
        throw new Error(`${context.where}: endpoint is an absolute URL, and ${endpoint} is not one`);
      }

      const query = asArgumentMap(step["query"], `${context.where}.query`, context.fields);
      const body = asArgumentMap(step["body"], `${context.where}.body`, context.fields);
      const both = Object.keys(query).filter((name) => Object.hasOwn(body, name));
      if (both.length > 0) {
        throw new Error(`${context.where} sends ${both.join(", ")} as both query and body`);
      }

      return {
        method: method as HttpBinding["method"],
        endpoint,
        query,
        body,
        headers: asArgumentMap(step["headers"], `${context.where}.headers`, context.fields),
      };
    },
    async run(step, context) {
      const endpoint = String(resolveValue(step.endpoint, context.scope, "endpoint"));
      if (!isAbsolute(endpoint)) {
        throw new ConfigurationError(`${endpoint} is not an absolute URL`);
      }
      const url = new URL(endpoint);
      if (url.pathname.includes("{")) {
        throw new ConfigurationError(`${url.pathname} still holds a brace after the values were filled in`);
      }

      const query: Record<string, unknown> = Object.fromEntries(url.searchParams);
      Object.assign(query, resolveMap(step.query, context.scope, "query"));
      const body = resolveMap(step.body, context.scope, "body");

      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(resolveMap(step.headers, context.scope, "headers"))) {
        headers[name] = String(value);
      }

      const transport = httpTransport({
        baseUrl: url.origin,
        headers,
        timeoutMs: options.timeoutMs ?? 30_000,
        ...compact({ fetch: options.fetch }),
      });

      const binding: HttpBinding = {
        method: step.method,
        path: url.pathname,
        query: Object.keys(query),
        body: Object.keys(body),
      };
      return { data: await transport.request(binding, { ...query, ...body }) };
    },
  });
}

function isAbsolute(endpoint: string): boolean {
  return URL.canParse(endpoint) && /^https?:/u.test(endpoint);
}

/* -------------------------------------------------------------------------- */

/**
 * The executors a document may name.
 *
 * A closed set, so an unknown name is a registration error with the four
 * written out rather than a command that fails the first time somebody runs it.
 */
export function defaultExecutors(options: ExecutorOptions = {}): Record<string, Executor> {
  return {
    noop,
    internal: internalExecutor(options),
    exec: execExecutor(options),
    rest: restExecutor(options),
  };
}
