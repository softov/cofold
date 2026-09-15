import type { OutputMode } from "./types/output.js";
import { displayValue, type Io, type Output } from "@facio/commands";
import { renderDocument, renderJson, renderTable } from "./render.js";

/**
 * The one place a result is printed.
 *
 * Three readings of the same value, chosen by the caller rather than by the
 * handler: JSON for anything that will be parsed, one identifier for a shell
 * script, and prose for a person. Handlers that print for themselves opt out of
 * all three, which is right for about two commands per program and wrong
 * everywhere else - so `write` exists, and is the exception you have to ask for.
 */

/**
 * What to show when a handler did not say.
 *
 * Worth doing rather than printing JSON at people: a list of records is a
 * table, one record is a field per line, and a string is itself. A command that
 * wants something better says so; a command that does not still reads well,
 * which is the difference between a library that is pleasant for the first
 * twenty commands and one that is pleasant only after you have styled them all.
 */
export function renderPlain(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data.endsWith("\n") ? data : `${data}\n`;
  if (typeof data === "number" || typeof data === "boolean") return `${String(data)}\n`;
  if (Array.isArray(data)) {
    if (data.length === 0) return "";
    const rows = data.filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item));
    if (rows.length !== data.length) return renderJson(data);
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return renderTable(headers, rows.map((row) => headers.map((header) => displayValue(row[header]))));
  }
  if (typeof data === "object") {
    return renderDocument(Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, displayValue(value)])));
  }
  return renderJson(data);
}

export function emit(io: Io, result: Output | null, mode: OutputMode): void {
  if (result === null) return;
  if (mode === "json") {
    io.out(renderJson(result.data));
    return;
  }
  if (mode === "quiet") {
    const identifier = result.quiet ?? identifierOf(result.data);
    if (identifier !== undefined) io.out(`${String(identifier)}\n`);
    return;
  }
  const plain = typeof result.plain === "function" ? result.plain() : result.plain;
  io.out(plain ?? renderPlain(result.data));
}

/**
 * `--quiet` with nothing declared.
 *
 * A `create` command whose author forgot to pass an identifier still prints the
 * id rather than nothing, because printing nothing is what breaks the shell
 * script that was piping it somewhere.
 */
function identifierOf(data: unknown): string | number | undefined {
  if (typeof data === "string" || typeof data === "number") return data;
  if (Array.isArray(data)) {
    const each = data.map((item) => identifierOf(item)).filter((one) => one !== undefined);
    return each.length === 0 ? undefined : each.join("\n");
  }
  if (typeof data === "object" && data !== null) {
    for (const key of ["id", "identifier", "name", "key"]) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === "string" || typeof value === "number") return value;
    }
  }
  return undefined;
}
