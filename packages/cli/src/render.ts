import { displayValue } from "@softcli/core";

/**
 * Turning values into something to read.
 *
 * Nothing here knows which command is running or what the person asked for.
 * A renderer that reaches for the invocation starts deciding policy, and the
 * policy - human, JSON, or a bare identifier - belongs to the program.
 */

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  heading(text: string): string;
}

/**
 * The control sequence introducer, built rather than typed.
 *
 * A source file that literally contains an escape character is a file that
 * looks corrupt in a diff and gets mangled by anything that touches it.
 */
const CSI = `${String.fromCharCode(27)}[`;

const plain: Style = { bold: (text) => text, dim: (text) => text, heading: (text) => text };

const coloured: Style = {
  bold: (text) => `${CSI}1m${text}${CSI}22m`,
  dim: (text) => `${CSI}2m${text}${CSI}22m`,
  heading: (text) => `${CSI}1m${text}${CSI}22m`,
};

/**
 * Colour, unless anything says otherwise.
 *
 * `NO_COLOR` is honoured because it is the convention, and a pipe is honoured
 * because escape codes in a file somebody is grepping are somebody's afternoon.
 */
export function styleFor(options: { color?: boolean; tty?: boolean } = {}): Style {
  if (options.color === false) return plain;
  if (process.env["NO_COLOR"] !== undefined) return plain;
  if (options.color === true) return coloured;
  return (options.tty ?? process.stdout.isTTY) === true ? coloured : plain;
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cells = rows.map((row) => row.map((value) => displayValue(value)));
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...cells.map((row) => row[index]?.length ?? 0)));
  const line = (row: readonly string[]): string =>
    row.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  return `${[line(headers), ...cells.map(line)].join("\n")}\n`;
}

/** One record, one field per line: what a `show` command answers with. */
export function document(value: Record<string, unknown>): string {
  const width = Math.max(...Object.keys(value).map((key) => key.length));
  return `${Object.entries(value).map(([key, item]) =>
    `${`${key}:`.padEnd(width + 1)} ${displayValue(item)}`).join("\n")}\n`;
}

/** Two columns that stay aligned however long the left one gets. */
export function definitions(entries: readonly (readonly [string, string])[], indent = "  "): string {
  if (entries.length === 0) return "";
  const width = Math.max(...entries.map(([left]) => left.length));
  return `${entries.map(([left, right]) =>
    right === "" ? `${indent}${left}` : `${indent}${left.padEnd(width)}  ${right}`).join("\n")}\n`;
}
