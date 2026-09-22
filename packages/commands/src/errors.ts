/**
 * Failures, and what each one costs.
 *
 * An exit code is part of a program's surface - a script switches on it - so
 * the taxonomy belongs to the framework rather than to whichever handler
 * happened to throw. Every error here carries its own code, which is why the
 * entry point can be six lines and has no `instanceof` ladder to maintain.
 */

import type { FaultKind } from "./types/errors.js";


const EXIT_CODES: Record<FaultKind, number> = {
  argument: 2,
  configuration: 3,
  authorization: 3,
  unavailable: 4,
  conflict: 1,
  internal: 1,
};

export class CofoldError extends Error {
  public readonly kind: FaultKind;
  /**
   * Whether the message can be shown to whoever ran the command.
   *
   * False means "an internal detail escaped": the entry point prints a generic
   * sentence instead. Anything raised deliberately is safe by construction.
   */
  public readonly expected: boolean;

  public constructor(kind: FaultKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.kind = kind;
    this.expected = true;
  }

  public get exitCode(): number {
    return EXIT_CODES[this.kind];
  }
}

/** Something about the words typed. Never about the state of the machine. */
export class ArgumentError extends CofoldError {
  public constructor(message: string) {
    super("argument", message);
  }
}

/** The program is not configured, or is configured wrongly. */
export class ConfigurationError extends CofoldError {
  public constructor(message: string) {
    super("configuration", message);
  }
}

/**
 * Refused, with the scopes that would have allowed it.
 *
 * The scopes are on the error rather than in the message so a caller that is
 * not a terminal - an MCP client, a test - can act on them.
 */
export class AuthorizationError extends CofoldError {
  public readonly missing: readonly string[];

  public constructor(message: string, missing: readonly string[] = []) {
    super("authorization", message);
    this.missing = missing;
  }
}

export class UnavailableError extends CofoldError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super("unavailable", message, options);
  }
}

export function exitCodeFor(error: unknown): number {
  return error instanceof CofoldError ? error.exitCode : 1;
}
