import type { Failure } from "./types/failure.js";
import type { OutputMode } from "./types/output.js";
import {
  AuthorizationError,
  CofoldError,
  exitCodeFor,
  type Io,
} from "@cofold/commands";

/**
 * The one shape a failure takes.
 *
 * An exit code is part of a program's surface, and under `--json` so is the
 * sentence. Both are data here rather than a line each writer builds for
 * itself, so a program that fails before `runEntry` writes exactly what
 * `runEntry` writes.
 */

/** Replace every secret with `[redacted]`; a short one is noise, not a secret. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret === undefined || secret.length < 8) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

/** An error as the flat object a script reads, with its message redacted. */
export function failureOf(
  error: unknown,
  secrets: readonly (string | undefined)[] = [],
): Failure {
  const message = redact(
    error instanceof Error ? error.message : "Unexpected failure",
    secrets,
  );
  const exitCode = exitCodeFor(error);
  if (error instanceof CofoldError) {
    return error instanceof AuthorizationError
      ? { message, kind: error.kind, exitCode, missing: error.missing }
      : { message, kind: error.kind, exitCode };
  }
  return { message, kind: "internal", exitCode };
}

/**
 * Write a failure for the mode the run is in.
 *
 * Under `--json` it is one flat line on stderr, so stdout holds only the
 * result; in every other mode it is the line of today.
 */
export function writeFailure(
  io: Pick<Io, "err">,
  name: string,
  failure: Failure,
  mode: OutputMode,
): void {
  if (mode === "json") {
    io.err(`${JSON.stringify(failure)}\n`);
    return;
  }
  io.err(`${name}: ${failure.message}\n`);
}

/**
 * Whether the words ask for JSON, read before the parser can give a mode.
 *
 * A parse failure is the one moment there is no invocation to ask, so the
 * literal word is the whole answer. Nothing after `--` is an option.
 */
export function jsonRequested(argv: readonly string[]): boolean {
  for (const word of argv) {
    if (word === "--") return false;
    if (word === "--json") return true;
  }
  return false;
}
