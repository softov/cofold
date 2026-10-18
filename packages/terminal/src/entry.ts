import type { EntryOptions } from "./types/entry.js";
import type { Io } from "@cofold/commands";
import { stderr } from "node:process";
import { CofoldError } from "@cofold/commands";
import { failureOf, jsonRequested, redact, writeFailure } from "./failure.js";
import type { Program } from "./program.js";

/**
 * What every binary does around its program.
 *
 * Shared because none of it is about any command: turn whatever escaped into an
 * exit code a script can switch on, and make sure no secret reaches a terminal
 * on the way out. Both are easy to forget per program and impossible to forget
 * here.
 */

/** Failures always go to stderr, so nothing here writes to stdout. */
const stderrIo: Pick<Io, "err"> = {
  err: (text) => { stderr.write(text); },
};

/** Run a program as a process: the exit code is the answer. */
export async function runEntry(
  program: Program,
  argv: readonly string[],
  options: EntryOptions = {},
): Promise<void> {
  try {
    process.exitCode = await program.run(argv);
  } catch (error: unknown) {
    options.onError?.(error);
    const expected = error instanceof CofoldError;
    let secrets: readonly (string | undefined)[] = [];
    try {
      secrets = options.secrets?.() ?? [];
    } catch {
      secrets = [];
    }
    // The run keeps the mode it chose; a parse failure did not choose one, so
    // the words are read for a literal `--json` before `--`.
    const mode = program.mode ?? (jsonRequested(argv) ? "json" : "plain");
    const failure = failureOf(error, secrets);
    writeFailure(stderrIo, program.name, failure, mode);
    if (!expected && process.env["COFOLD_TRACE"] !== undefined && error instanceof Error) {
      stderr.write(`${redact(error.stack ?? "", secrets)}\n`);
    }
    process.exitCode = failure.exitCode;
  }
}

export { redact };
