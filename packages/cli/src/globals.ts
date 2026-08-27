import type { OptionSpec } from "@softcli/core";

/**
 * The options every program on this framework has.
 *
 * They are here rather than left to each program because they are a contract
 * with whoever is calling: `--json` means the output is stable and parseable,
 * `--quiet` means one identifier and nothing else, and a program where those
 * mean something else has broken somebody's script. A program may add to this
 * list; overriding an entry is refused when the program is built.
 */
export const globalOptions: readonly OptionSpec[] = [
  { name: "--help", short: "-h", description: "Show help for the current command" },
  { name: "--version", description: "Print the version" },
  { name: "--json", description: "Emit stable machine-readable JSON" },
  { name: "--quiet", short: "-q", description: "Print only identifiers or requested values" },
  { name: "--verbose", description: "Include diagnostics on stderr" },
  { name: "--no-color", description: "Disable colour, as does a non-terminal or NO_COLOR" },
];

export const GLOBAL_NAMES: readonly string[] = globalOptions.map((option) => option.name);

export type OutputMode = "human" | "json" | "quiet";
