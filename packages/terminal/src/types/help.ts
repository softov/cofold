import type { Command, CommandGroup, OptionSpec } from "@cofold/commands";
import type { Style } from "./output.js";

export interface HelpOptions {
  name: string;
  version?: string;
  description?: string;
  commands: readonly Command[];
  globals: readonly OptionSpec[];
  groups?: readonly CommandGroup[];
  style?: Style;
}
