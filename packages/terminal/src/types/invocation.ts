import type { Command } from "@doopx/commands";
export interface Invocation {
  command: Command | null;
  slots: Record<string, string | string[]>;
  options: Record<string, string | string[] | boolean>;
  /** The words typed, for help on a command that is only half written. */
  words: string[];
  passthrough: string[];
}
