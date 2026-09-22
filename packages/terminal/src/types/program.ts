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
}
