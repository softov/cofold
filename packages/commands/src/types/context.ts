import type { Command, Surface } from "./command.js";

export interface Output {
  data: unknown;
  /** A function when rendering is expensive: never called for `--json`. */
  plain?: string | (() => string);
  quiet?: string | number;
}

/** Trusted adapter data, never populated from action input. */
export interface RequestContext {
  readonly actor?: unknown;
  readonly id?: string | number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly progress?: (value: { progress: number; total?: number; message?: string }) => Promise<void>;
}

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export interface CommandContext {
  readonly command: Command;
  /** Everything registered - for the commands whose subject is the surface itself. */
  readonly commands: readonly Command[];
  readonly surface: Surface;
  /**
   * The canonical input: slots and options in one object, coerced and
   * validated. The same object whichever surface produced it, which is what
   * makes a handler transport-blind.
   */
  readonly input: Readonly<Record<string, unknown>>;
  /**
   * The program-wide options, kept out of `input` on purpose.
   *
   * `--config`, `--url`, `--verbose`: what capability providers read to decide
   * where to look. They are not part of what the command *means* - an MCP call
   * has none of them - so mixing them into the canonical input would put fields
   * into every schema that only one surface can ever produce.
   */
  readonly globals: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal | undefined;
  readonly request: Readonly<RequestContext> | undefined;

  /** A field that is certainly present, because the parse said so. */
  value<T = string>(name: string): T;
  optional<T = string>(name: string): T | undefined;
  flag(name: string): boolean;
  list<T = string>(name: string): T[];
  /** A repeatable `KEY=VALUE` option, as the object a request body wants. */
  pairs(name: string): Record<string, string>;
  /** A field that must be there, faulted by its own name when it is not. */
  required<T = string>(name: string): T;

  /** Whatever was piped in. Read once; a second call returns the same text. */
  stdin(): Promise<string>;

  out(value: Output): void;
  /** Straight to stdout, for the commands whose output *is* the payload. */
  write(text: string): void;
  /** A sentence on stderr, for a handler answering with a non-zero code. */
  error(text: string): void;
}

export interface BaseContextOptions {
  command: Command;
  commands: readonly Command[];
  surface: Surface;
  input: Record<string, unknown>;
  globals?: Record<string, unknown>;
  io: Io;
  signal?: AbortSignal;
  request?: Readonly<RequestContext>;
  readStdin?: () => Promise<string>;
  onOutput?: (value: Output) => void;
}
