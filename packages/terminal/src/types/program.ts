import type { Command, Io, OptionSpec, Runner } from "@cofold/commands";
export interface ProgramOptions {
  name: string;
  version: string;
  description?: string;
  registry: Runner;
  io?: Io;
  /** Program-wide options beyond the standard set: `--url`, `--config`, `--profile`. */
  globals?: readonly OptionSpec[];
  /** `completion` and the hidden `__complete`. On unless a program says otherwise. */
  builtins?: boolean;
  /**
   * Registered names appended under the static help - ids, profiles, whatever
   * only the running program knows. Must not throw.
   */
  liveHelp?(command: Command | null, prefix: readonly string[]): Promise<string>;
  readStdin?(): Promise<string>;
  /**
   * The terminal a `remove` is confirmed on: the question in, whether to run it out.
   *
   * Absent, it asks on stderr and reads stdin when both are terminals, and there
   * is no terminal otherwise. `false` is no terminal, so a `remove` without
   * `--yes` is refused. A function is the terminal, for tests and embedders.
   */
  confirm?: ((question: string) => Promise<boolean>) | false;
}
