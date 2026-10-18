import type { FaultKind } from "@cofold/commands";

/** A failure as data: the object `--json` prints, and the one `writeFailure` writes. */
export interface Failure {
  /** The sentence a person reads, already redacted. */
  message: string;
  kind: FaultKind;
  exitCode: number;
  /** The scopes that would have allowed an authorization failure. */
  missing?: readonly string[];
}
