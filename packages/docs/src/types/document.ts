import type { OptionSpec } from "@facio/commands";
export interface DocumentOptions {
  name: string;
  version?: string;
  description?: string;
  /** Included in the option tables, because they are part of every command. */
  globals?: readonly OptionSpec[];
  /** Prepended verbatim: the paragraph only a human can write. */
  preamble?: string;
}
