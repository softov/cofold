import type { Command, Surface } from "./types/command.js";
import type {
  BaseContextOptions,
  CommandContext,
  Io,
  Output,
  RequestContext,
} from "./types/context.js";
import { compact } from "./compact.js";
import { ArgumentError } from "./errors.js";

/**
 * What a handler is given, and the one place it answers.
 *
 * The answer is a value, not a print. A handler that writes to stdout has
 * decided it is running in a terminal, and the whole point of this library is
 * that it might be running as an MCP tool, or as an HTTP route, or in a test.
 * `Output` carries the three readings of one result and lets each surface pick:
 * the data (JSON, and what an agent gets), a plain rendering, and the bare
 * identifier a shell script wants.
 */

export function output(data: unknown, plain?: string | (() => string), quiet?: string | number): Output {
  return { data, ...compact({ plain, quiet }) };
}

/**
 * Names a provider may not take.
 *
 * Capabilities are merged into the handler's context so a command can say
 * `ctx.server`, which is worth the one constraint that they cannot be called
 * `ctx.input`. Enforced when the provider is declared, not when a command
 * mysteriously stops working.
 */
export const RESERVED_CONTEXT_KEYS: readonly string[] = [
  "command", "commands", "surface", "input", "globals", "signal", "request",
  "value", "optional", "flag", "list", "pairs", "required",
  "stdin", "out", "write", "error",
];

export class BaseContext implements CommandContext {
  public readonly command: Command;
  public readonly commands: readonly Command[];
  public readonly surface: Surface;
  public readonly input: Record<string, unknown>;
  public readonly globals: Record<string, unknown>;
  public readonly signal: AbortSignal | undefined;
  public readonly request: Readonly<RequestContext> | undefined;
  readonly #io: Io;
  readonly #readStdin: () => Promise<string>;
  readonly #onOutput: (value: Output) => void;
  #stdin: Promise<string> | null = null;
  #collected: Output | null = null;

  public constructor(options: BaseContextOptions) {
    this.command = options.command;
    this.commands = options.commands;
    this.surface = options.surface;
    this.input = options.input;
    this.globals = options.globals ?? {};
    this.signal = options.signal;
    this.request = options.request;
    this.#io = options.io;
    this.#readStdin = options.readStdin ?? (async () => "");
    this.#onOutput = options.onOutput ?? ((value) => { this.#collected = value; });
  }

  /** What `out` was called with, for a surface that returns rather than prints. */
  public get collected(): Output | null {
    return this.#collected;
  }

  public value<T = string>(name: string): T {
    return this.input[name] as T;
  }

  public optional<T = string>(name: string): T | undefined {
    return this.input[name] as T | undefined;
  }

  public flag(name: string): boolean {
    return this.input[name] === true;
  }

  public list<T = string>(name: string): T[] {
    const value = this.input[name];
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]) as T[];
  }

  public pairs(name: string): Record<string, string> {
    const entries = this.list<readonly [string, string] | string>(name).map((entry) => {
      if (Array.isArray(entry)) return entry as unknown as [string, string];
      const raw = String(entry);
      const index = raw.indexOf("=");
      if (index <= 0) throw new ArgumentError(`${name} must be KEY=VALUE`);
      return [raw.slice(0, index), raw.slice(index + 1)] as [string, string];
    });
    return Object.fromEntries(entries);
  }

  public required<T = string>(name: string): T {
    const value = this.input[name];
    if (value === undefined || value === null || value === "") {
      throw new ArgumentError(`${name} is required`);
    }
    return value as T;
  }

  public async stdin(): Promise<string> {
    this.#stdin ??= this.#readStdin();
    return await this.#stdin;
  }

  public out(value: Output): void {
    this.#onOutput(value);
  }

  public write(text: string): void {
    this.#io.out(text);
  }

  public error(text: string): void {
    this.#io.err(text.endsWith("\n") ? text : `${text}\n`);
  }
}

export const silentIo: Io = { out: () => {}, err: () => {} };
