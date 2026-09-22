import type { HelpOptions } from "./types/help.js";
import {
  argumentFields,
  commandPattern,
  isFlag,
  optionNotes,
  optionsOf,
  sectionsOf,
  underPrefix,
  visible,
  type Command,
  type CommandGroup,
  type OptionNote,
  type OptionSpec,
} from "@doopx/commands";
import { renderDefinitions, styleFor } from "./render.js";

/**
 * `--help`, derived from the registry.
 *
 * Every line is generated. Nothing about a command is written twice, which is
 * the only way help stays true of a surface that keeps changing - a hand-written
 * usage string is a comment, and comments rot.
 */

function noteText(note: OptionNote): string {
  if (note.kind === "env") return `env ${note.name}`;
  if (note.kind === "default") return `default ${JSON.stringify(note.value)}`;
  if (note.kind === "candidates") return note.values.join("|");
  return note.kind;
}

function optionLine(option: OptionSpec): readonly [string, string] {
  const short = option.short === undefined ? "    " : `${option.short}, `;
  const value = isFlag(option) ? "" : ` ${option.value}`;
  const notes = optionNotes(option).map(noteText);
  const suffix = notes.length === 0 ? "" : ` (${notes.join(", ")})`;
  return [`${short}${option.name}${value}`, `${option.description}${suffix}`] as const;
}

export function helpForCommand(command: Command, options: HelpOptions): string {
  const style = options.style ?? styleFor();
  const own = visible(optionsOf(command));
  const slots = argumentFields(command).map((field) => [field.label, field.description] as const);

  const sections: string[] = [
    `${style.bold("Usage:")} ${options.name} ${commandPattern(command)}${own.length === 0 ? "" : " [options]"}\n`,
    `\n${command.summary}\n`,
  ];
  if (command.description !== undefined) sections.push(`\n${command.description.trim()}\n`);
  if (slots.some(([, description]) => description !== "")) {
    sections.push(`\n${style.heading("Arguments:")}\n${renderDefinitions(slots)}`);
  }
  if (own.length > 0) {
    sections.push(`\n${style.heading("Options:")}\n${renderDefinitions(own.map(optionLine))}`);
  }
  if (command.needs !== undefined && command.needs.length > 0) {
    sections.push(`\n${style.dim(`Needs: ${command.needs.join(", ")}`)}\n`);
  }
  if (command.examples !== undefined && command.examples.length > 0) {
    sections.push(`\n${style.heading("Examples:")}\n${renderDefinitions(
      command.examples.map((example) => [example.command, example.description ?? ""] as const))}`);
  }
  sections.push(`\n${style.heading("Global options:")}\n${renderDefinitions(visible(options.globals).map(optionLine))}`);
  return sections.join("");
}

function commandLines(commands: readonly Command[]): readonly (readonly [string, string])[] {
  return visible(commands).map((command) => [commandPattern(command), command.summary] as const);
}

export function helpForProgram(options: HelpOptions): string {
  const style = options.style ?? styleFor();
  const listed = visible(options.commands);
  // The version belongs here as much as behind `--version`: a bug report that
  // says "notes, latest" is a bug report nobody can act on.
  const named = options.version === undefined ? options.name : `${options.name} ${options.version}`;
  const head = `${style.bold("Usage:")} ${options.name} [global options] <command> [arguments] [options]\n`
    + `\n${named}${options.description === undefined ? "" : ` - ${options.description}`}\n`;

  const body = sectionsOf(options.groups ?? [], listed)
    .map((section) => `\n${style.heading(`${section.title}:`)}\n${renderDefinitions(commandLines(section.commands))}`)
    .join("");

  return `${head}${body}\n${style.heading("Global options:")}\n${renderDefinitions(visible(options.globals).map(optionLine))}`;
}

/**
 * Help for a command that is only half typed.
 *
 * `prog case --help` is not a command and should not be an error: it is
 * somebody asking what can follow that word. `matched` - what the parser
 * resolved the same words to - is the fallback rather than the answer, because
 * a slot matches any word: `report submit --help` parses as `report <id>` with
 * the id "submit", and answering with that command's help answers a question
 * nobody asked. A literal prefix is always the better reading.
 */
export function help(
  options: HelpOptions & { prefix?: readonly string[]; matched?: Command | undefined },
): string {
  const { prefix = [], matched } = options;
  if (prefix.length === 0) return helpForProgram(options);

  const matches = options.commands.filter((command) => underPrefix(command, prefix));

  if (matches.length === 1) return helpForCommand(matches[0]!, options);
  if (matches.length === 0) {
    return matched === undefined ? helpForProgram(options) : helpForCommand(matched, options);
  }
  const style = options.style ?? styleFor();
  return `${style.bold("Usage:")} ${options.name} ${prefix.join(" ")} <command>\n`
    + `\n${style.heading("Commands:")}\n${renderDefinitions(commandLines(matches))}`;
}
