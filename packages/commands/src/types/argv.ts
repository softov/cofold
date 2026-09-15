import type { Command } from "./command.js";
import type { OptionSpec } from "./field.js";

export interface OptionTableEntry {
  spec: OptionSpec;
  negated: boolean;
}

export interface Tokens {
  words: string[];
  /**
   * Options the permissive pass did not recognise.
   *
   * Kept rather than dropped because of how a typo reads without them: an
   * unknown `--limt` becomes a flag, its value becomes a word, no command
   * matches those words, and the program answers "unknown command note list 3"
   * about a command line that named a perfectly good command.
   */
  unknown: string[];
  /** Keyed by the option's long name, with its dashes. */
  options: Record<string, string | string[] | boolean>;
  /** Everything after `--`, untouched. Also appended to `words`. */
  passthrough: string[];
}

export interface Match {
  command: Command;
  slots: Record<string, string | string[]>;
  /** How many literal words matched: how a specific command beats a general one. */
  score: number;
}
