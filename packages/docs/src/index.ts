import type { DocumentOptions } from "./types/document.js";
import {
  argumentFields,
  commandPattern,
  displayValue,
  isFlag,
  optionNotes,
  optionsOf,
  sectionsOf,
  surfaceEnabled,
  visible,
  type Command,
  type CommandSection,
  type OptionNote,
  type OptionSpec,
  type Runner,
} from "@doopx/commands";

export type { DocumentOptions } from "./types/document.js";

/**
 * @doopx/docs - the registry, written down.
 *
 * Two readings, and the difference between them is the point. The reference is
 * for a person and lists everything. The skill is for an agent and lists only
 * what an agent can act on: nobody's model needs the command that rotates a
 * token or edits the local configuration, and printing those to something that
 * cannot usefully run them is an invitation rather than a reference.
 *
 * Both are generated, so documentation cannot describe a surface that no longer
 * exists - which is what a hand-maintained README always ends up doing.
 */

export function mdTable(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  // The escaping is the only markdown-specific part: a pipe would end the cell
  // and a newline would end the row.
  const cell = (value: unknown): string =>
    displayValue(value, "").replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function noteText(note: OptionNote): string {
  if (note.kind === "env") return `env \`${note.name}\``;
  if (note.kind === "default") return `default \`${JSON.stringify(note.value)}\``;
  if (note.kind === "candidates") return note.values.map((one) => `\`${one}\``).join(", ");
  return note.kind;
}

function optionRow(option: OptionSpec): readonly unknown[] {
  return [
    `\`${option.name}${isFlag(option) ? "" : ` ${option.value}`}\``,
    option.short === undefined ? "" : `\`${option.short}\``,
    option.description,
    optionNotes(option).map(noteText).join(", "),
  ];
}

function argumentRows(command: Command): readonly (readonly unknown[])[] {
  return argumentFields(command).map((field) => [
    `\`${field.label}\``,
    field.repeated ? "one or more" : field.required ? "required" : "optional",
    field.description,
    field.coerce.expects,
  ]);
}

export function commandSection(command: Command, options: DocumentOptions, level = 3): string {
  const heading = "#".repeat(level);
  const own = visible(optionsOf(command));
  const parts: string[] = [
    `${heading} \`${options.name} ${commandPattern(command)}\``,
    "",
    command.summary,
    "",
  ];
  if (command.description !== undefined) parts.push(command.description.trim(), "");
  const args = argumentRows(command);
  if (args.length > 0) {
    parts.push(mdTable(["Argument", "", "Description", "Type"], args), "");
  }
  if (own.length > 0) {
    parts.push(mdTable(["Option", "", "Description", ""], own.map(optionRow)), "");
  }
  if (command.needs !== undefined && command.needs.length > 0) {
    parts.push(`Needs: ${command.needs.map((need) => `\`${need}\``).join(", ")}`, "");
  }
  if (command.examples !== undefined && command.examples.length > 0) {
    parts.push("```sh", ...command.examples.map((example) =>
      example.description === undefined ? example.command : `# ${example.description}\n${example.command}`), "```", "");
  }
  return parts.join("\n");
}

/** Everything, for a person: the manual page this library replaces. */
export function reference(registry: Runner, options: DocumentOptions): string {
  const listed = visible(registry.commands).filter((command) => surfaceEnabled(command, "docs"));
  const parts: string[] = [
    `# ${options.name}${options.version === undefined ? "" : ` ${options.version}`}`,
    "",
    ...(options.description === undefined ? [] : [options.description, ""]),
    ...(options.preamble === undefined ? [] : [options.preamble.trim(), ""]),
  ];

  for (const section of sectionsOf(registry.groups, listed)) {
    parts.push(`## ${section.title}`, "");
    for (const command of section.commands) parts.push(commandSection(command, options));
  }

  if (options.globals !== undefined && options.globals.length > 0) {
    parts.push("## Global options", "",
      mdTable(["Option", "", "Description", ""], visible(options.globals).map(optionRow)), "");
  }
  return parts.join("\n");
}

/**
 * The short reading, for whatever is driving the program.
 *
 * A table of what exists and how it is typed, and nothing about installation,
 * configuration or administration. An agent reads this to decide which command
 * to run, so what belongs in it is exactly the commands it could run.
 */
export function agentSkill(registry: Runner, options: DocumentOptions): string {
  const listed = visible(registry.commands).filter((command) => surfaceEnabled(command, "docs"));
  const sections: CommandSection[] = sectionsOf(
    registry.groups.filter((group) => group.agent !== false),
    listed,
  );

  const parts: string[] = [
    `# ${options.name}`,
    "",
    ...(options.description === undefined ? [] : [options.description, ""]),
    ...(options.preamble === undefined ? [] : [options.preamble.trim(), ""]),
    `Every command takes \`--json\` and answers with stable JSON. Read that rather than the prose.`,
    "",
  ];

  for (const section of sections) {
    parts.push(`## ${section.title}`, "",
      mdTable(["Command", "Does"], section.commands.map((command) =>
        [`\`${options.name} ${commandPattern(command)}\``, command.summary])), "");
  }
  return parts.join("\n");
}
