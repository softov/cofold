import { stderr } from "node:process";
import { exitCodeFor, FacioError } from "../index.js";
import type { Program } from "./program.js";

/**
 * What every binary does around its program.
 *
 * Shared because none of it is about any command: turn whatever escaped into an
 * exit code a script can switch on, and make sure no secret reaches a terminal
 * on the way out. Both are easy to forget per program and impossible to forget
 * here.
 */

export interface EntryOptions {
  /**
   * Everything this installation knows that must never be printed.
   *
   * A token appears in an error message the day a request fails with the URL it
   * was sent to. Redaction belongs at the last edge rather than at each place a
   * message is built, because the messages are written by people who are
   * thinking about something else.
   */
  secrets?(): readonly (string | undefined)[];
  /** For a program that logs somewhere as well as printing. */
  onError?(error: unknown): void;
}

export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret === undefined || secret.length < 8) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

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
    const expected = error instanceof FacioError;
    const raw = expected
      ? (error as FacioError).message
      : `${error instanceof Error ? error.message : "Unexpected failure"}`;
    let secrets: readonly (string | undefined)[] = [];
    try {
      secrets = options.secrets?.() ?? [];
    } catch {
      secrets = [];
    }
    stderr.write(`${program.name}: ${redact(raw, secrets)}\n`);
    if (!expected && process.env["FACIO_TRACE"] !== undefined && error instanceof Error) {
      stderr.write(`${redact(error.stack ?? "", secrets)}\n`);
    }
    process.exitCode = exitCodeFor(error);
  }
}
