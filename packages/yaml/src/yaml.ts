import type { YamlParseOptions } from "./types/parse.js";

/**
 * @doopx/yaml reads a documented YAML subset as plain data, without I/O or dependencies.
 * Unsupported syntax is rejected rather than interpreted approximately.
 * File loading, document composition, and reference resolution belong to callers.
 */

export class YamlError extends Error {
  public readonly line: number;
  public readonly source: string | undefined;
  public readonly detail: string;

  public constructor(message: string, line: number, source?: string) {
    super(`${message} (${source === undefined ? "" : `${source}: `}line ${line})`);
    this.name = "YamlError";
    this.line = line;
    this.source = source;
    this.detail = message;
  }
}

/** One significant line: its depth, its content without the comment, and where it came from. */
interface Line {
  indent: number;
  text: string;
  number: number;
}

/** A cursor over one line's text, for the flow collections and the quoted scalars. */
interface Reader {
  text: string;
  at: number;
  line: number;
}

/** What a plain scalar may not start with, because each one means a feature this does not read. */
const REFUSED: readonly { start: string; what: string }[] = [
  { start: "&", what: "anchors" },
  { start: "*", what: "aliases" },
  { start: "!", what: "tags" },
  { start: "|", what: "block scalars" },
  { start: ">", what: "folded scalars" },
  { start: "%", what: "directives" },
  { start: "`", what: "reserved indicators" },
  { start: "@", what: "reserved indicators" },
];

/** The document as data. Mappings become objects, sequences arrays, scalars themselves. */
export function parseYaml(text: string, options: YamlParseOptions = {}): unknown {
  try {
    if (Buffer.byteLength(text, "utf8") > (options.maxBytes ?? 16 * 1024 * 1024)) {
      throw new YamlError("YAML exceeds maxBytes", 1);
    }
    return parse(text, options.maxDepth ?? 128);
  } catch (error) {
    if (error instanceof YamlError && options.source !== undefined) {
      throw new YamlError(error.detail, error.line, options.source);
    }
    throw error;
  }
}

function parse(text: string, maxDepth: number): unknown {
  const lines = scan(text);
  const levels: number[] = [];
  for (const line of lines) {
    while (levels.length && levels.at(-1)! >= line.indent) levels.pop();
    levels.push(line.indent);
    let flowDepth = 0;
    let quote = "";
    for (let i = 0; i < line.text.length; i++) {
      const char = line.text[i]!;
      if (quote) { if (char === "\\" && quote === '"') i++; else if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") quote = char;
      else if (char === "[" || char === "{") { if (++flowDepth + levels.length > maxDepth) throw new YamlError("YAML exceeds maxDepth", line.number); }
      else if (char === "]" || char === "}") flowDepth--;
    }
    if (levels.length > maxDepth) throw new YamlError("YAML exceeds maxDepth", line.number);
  }
  if (lines.length === 0) return null;
  const first = lines[0]!;
  if (lines.length === 1 && keyAt(first.text) === -1 && !isItem(first)) {
    return first.text.startsWith("[") || first.text.startsWith("{") ? parseFlow(first.text, first.number) : scalar(first.text, first.number);
  }
  const [value, at] = block(lines, 0, first.indent);
  if (at < lines.length) {
    throw new YamlError("This line is outside the document above it", lines[at]!.number);
  }
  return value;
}

/**
 * Text as the lines that carry meaning.
 *
 * Comments and blank lines are dropped here rather than in the parser, so
 * nothing below has to ask whether a `#` is a comment or part of a value.
 */
function scan(text: string): Line[] {
  const lines: Line[] = [];
  let opened = false;

  blockScalars(text).forEach((raw, index) => {
    const number = index + 1;
    const stripped = stripComment(raw);
    const trimmed = stripped.trim();
    if (trimmed === "") return;

    if (trimmed === "---") {
      if (opened || lines.length > 0) throw new YamlError("This parser reads one document per file", number);
      opened = true;
      return;
    }
    if (trimmed === "...") throw new YamlError("This parser reads one document per file", number);

    const indent = stripped.length - stripped.trimStart().length;
    if (stripped.slice(0, indent).includes("\t")) {
      throw new YamlError("YAML is indented with spaces, and this line uses a tab", number);
    }
    lines.push({ indent, text: trimmed, number });
  });

  return lines;
}

/** Turn block scalars into quoted values while retaining physical line numbers. */
function blockScalars(text: string): string[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]!);
    const match = /^(.*?(?::\s+|-\s+))([|>])([1-9][+-]?|[+-][1-9]?|)\s*$/u.exec(raw);
    if (!match) continue;
    const parent = raw.length - raw.trimStart().length;
    const modifier = match[3]!;
    const explicit = /[1-9]/u.exec(modifier);
    let end = i + 1;
    while (end < lines.length && (lines[end]!.trim() === "" || lines[end]!.search(/\S/u) > parent)) end++;
    const held = lines.slice(i + 1, end);
    const nonempty = held.find((line) => line.trim() !== "");
    const indent = explicit ? parent + Number(explicit[0]) : nonempty?.search(/\S/u) ?? parent + 1;
    const parts = held.map((line, at) => {
      if (!line.trim()) return "";
      if (line.search(/\S/u) < indent) throw new YamlError("Block scalar indentation is inconsistent", i + at + 2);
      return line.slice(indent);
    });
    let value = "";
    for (let j = 0; j < parts.length; j++) {
      const current = parts[j]!;
      const next = parts[j + 1];
      value += current;
      if (match[2] === "|" || next === undefined || current.startsWith(" ") || next.startsWith(" ")) value += "\n";
      else if (current !== "" && next !== "") value += " ";
      else if (current === "" || (next === "" && parts.slice(j + 1).every((part) => part === ""))) value += "\n";
    }
    if (!modifier.includes("+")) value = value.replace(/\n+$/u, "") + (modifier.includes("-") || !parts.some((part) => part !== "") ? "" : "\n");
    lines[i] = match[1]! + JSON.stringify(value);
    for (let j = i + 1; j < end; j++) lines[j] = "";
    i = end - 1;
  }
  return lines;
}

/** A `#` that opens a comment: one at the start of the line or after a space, outside quotes. */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at]!;
    if (quote !== null) {
      if (char === "\\" && quote === '"') { at += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if ((char === '"' || char === "'") && (at === 0 || /[\s[{:,]/u.test(raw[at - 1]!))) { quote = char; continue; }
    if (char === "#" && (at === 0 || /\s/u.test(raw[at - 1]!))) return raw.slice(0, at);
  }
  return raw;
}

function isItem(line: Line): boolean {
  return line.text === "-" || line.text.startsWith("- ");
}

function block(lines: Line[], at: number, indent: number): [unknown, number] {
  const first = lines[at]!;
  if (!isItem(first) && keyAt(first.text) === -1) {
    return [first.text.startsWith("[") || first.text.startsWith("{") ? parseFlow(first.text, first.number) : scalar(first.text, first.number), at + 1];
  }
  return isItem(lines[at]!) ? sequence(lines, at, indent) : mapping(lines, at, indent);
}

function sequence(lines: Line[], at: number, indent: number): [unknown[], number] {
  const items: unknown[] = [];
  let cursor = at;

  while (cursor < lines.length && lines[cursor]!.indent === indent && isItem(lines[cursor]!)) {
    const line = lines[cursor]!;
    const body = line.text === "-" ? "" : line.text.slice(2);
    const rest = body.trim();

    if (rest === "") {
      const next = lines[cursor + 1];
      if (next !== undefined && next.indent > indent) {
        const [value, after] = block(lines, cursor + 1, next.indent);
        items.push(value);
        cursor = after;
      } else {
        items.push(null);
        cursor += 1;
      }
      continue;
    }

    if (rest.startsWith("[") || rest.startsWith("{")) {
      items.push(parseFlow(rest, line.number));
      cursor += 1;
      continue;
    }

    if (keyAt(rest) === -1) {
      items.push(scalar(rest, line.number));
      cursor += 1;
      continue;
    }

    /*
     * `- key: value` opens a mapping whose first key sits on the dash's own
     * line. The line is restated at the column that key actually starts in, so
     * the following keys - indented to that column - read as the same mapping.
     */
    const offset = indent + 2 + (body.length - body.trimStart().length);
    lines[cursor] = { indent: offset, text: rest, number: line.number };
    const [value, after] = mapping(lines, cursor, offset);
    items.push(value);
    cursor = after;
  }

  return [items, cursor];
}

function mapping(lines: Line[], at: number, indent: number): [Record<string, unknown>, number] {
  const map: Record<string, unknown> = {};
  let cursor = at;

  while (cursor < lines.length && lines[cursor]!.indent === indent) {
    const line = lines[cursor]!;
    if (isItem(line)) break;

    const colon = keyAt(line.text);
    if (colon === -1) {
      throw new YamlError(`"${line.text}" is not a mapping entry: a key is written "name: value"`, line.number);
    }
    const key = String(scalar(line.text.slice(0, colon).trim(), line.number));
    if (key === "<<") throw new YamlError("This parser does not read merge keys", line.number);
    if (Object.hasOwn(map, key)) throw new YamlError(`${key} is given twice`, line.number);

    const rest = line.text.slice(colon + 1).trim();
    if (rest !== "") {
      Object.defineProperty(map, key, { value: rest.startsWith("[") || rest.startsWith("{")
        ? parseFlow(rest, line.number) : scalar(rest, line.number), enumerable: true, writable: true, configurable: true });
      cursor += 1;
      continue;
    }

    /*
     * A key with nothing after it opens a block, which is either indented under
     * it or - for a sequence, which YAML lets sit at the key's own column - at
     * the same depth.
     */
    const next = lines[cursor + 1];
    if (next !== undefined && (next.indent > indent || (next.indent === indent && isItem(next)))) {
      const [value, after] = block(lines, cursor + 1, next.indent);
      Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
      cursor = after;
      continue;
    }
    Object.defineProperty(map, key, { value: null, enumerable: true, writable: true, configurable: true });
    cursor += 1;
  }

  if (cursor < lines.length && lines[cursor]!.indent > indent) {
    throw new YamlError("This line is indented further than anything above it opened", lines[cursor]!.number);
  }
  return [map, cursor];
}

/**
 * Where a key ends: a colon followed by a space or the end of the line.
 *
 * The space is what keeps `endpoint: http://host/path` one key and one value
 * rather than two keys, and it is the same rule YAML itself uses.
 */
function keyAt(text: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (quote !== null) {
      if (char === "\\" && quote === '"') { at += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if ((char === '"' || char === "'") && (at === 0 || /[\s[{:,]/u.test(text[at - 1]!))) { quote = char; continue; }
    if (char === "[" || char === "{") { depth += 1; continue; }
    if (char === "]" || char === "}") { depth -= 1; continue; }
    if (char === ":" && depth === 0 && (text[at + 1] === undefined || text[at + 1] === " ")) return at;
  }
  return -1;
}

/** One scalar: quoted text as written, or a plain word read as null, a boolean, a number or text. */
function scalar(text: string, line: number): unknown {
  if (text === "") return null;

  if (text.startsWith('"') || text.startsWith("'")) {
    const reader: Reader = { text, at: 0, line };
    const value = quotedFrom(reader);
    skipSpace(reader);
    if (reader.at < text.length) throw new YamlError("There is text after the closing quote", line);
    return value;
  }

  for (const { start, what } of REFUSED) {
    if (text.startsWith(start)) {
      throw new YamlError(`This parser does not read ${what}; quote the value if it is text`, line);
    }
  }

  if (text === "~" || text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/u.test(text)) return Number(text);
  if (/^-?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(text)) return Number(text);
  if (/^-?\d+[eE][-+]?\d+$/u.test(text)) return Number(text);
  return text;
}

function parseFlow(text: string, line: number): unknown {
  const reader: Reader = { text, at: 0, line };
  const value = flowValue(reader);
  skipSpace(reader);
  if (reader.at < text.length) throw new YamlError("There is text after the flow collection", line);
  return value;
}

function skipSpace(reader: Reader): void {
  while (reader.at < reader.text.length && /\s/u.test(reader.text[reader.at]!)) reader.at += 1;
}

function flowValue(reader: Reader): unknown {
  skipSpace(reader);
  const char = reader.text[reader.at];
  if (char === undefined) throw new YamlError("A flow collection ends with a value missing", reader.line);
  if (char === "[") return flowSequence(reader);
  if (char === "{") return flowMapping(reader);
  if (char === '"' || char === "'") return quotedFrom(reader);

  const start = reader.at;
  while (reader.at < reader.text.length && !",]}".includes(reader.text[reader.at]!)) reader.at += 1;
  return scalar(reader.text.slice(start, reader.at).trim(), reader.line);
}

function flowSequence(reader: Reader): unknown[] {
  reader.at += 1;
  const items: unknown[] = [];
  skipSpace(reader);
  if (reader.text[reader.at] === "]") { reader.at += 1; return items; }

  for (;;) {
    items.push(flowValue(reader));
    skipSpace(reader);
    const char = reader.text[reader.at];
    if (char === "]") { reader.at += 1; return items; }
    if (char !== ",") throw new YamlError("A flow sequence separates values with , and ends with ]", reader.line);
    reader.at += 1;
    skipSpace(reader);
    if (reader.text[reader.at] === "]") { reader.at += 1; return items; }
  }
}

function flowMapping(reader: Reader): Record<string, unknown> {
  reader.at += 1;
  const map: Record<string, unknown> = {};
  skipSpace(reader);
  if (reader.text[reader.at] === "}") { reader.at += 1; return map; }

  for (;;) {
    skipSpace(reader);
    const opener = reader.text[reader.at];
    const key = opener === '"' || opener === "'" ? quotedFrom(reader) : plainKey(reader);
    skipSpace(reader);
    let value: unknown = null;
    if (reader.text[reader.at] === ":") {
      reader.at += 1;
      skipSpace(reader);
      if (reader.text[reader.at] !== "," && reader.text[reader.at] !== "}") value = flowValue(reader);
    } else if (reader.text[reader.at] !== "," && reader.text[reader.at] !== "}") {
      throw new YamlError("A flow mapping entry is written name: value", reader.line);
    }
    if (Object.hasOwn(map, key)) throw new YamlError(`${key} is given twice`, reader.line);
    Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });

    skipSpace(reader);
    const char = reader.text[reader.at];
    if (char === "}") { reader.at += 1; return map; }
    if (char !== ",") throw new YamlError("A flow mapping separates entries with , and ends with }", reader.line);
    reader.at += 1;
    skipSpace(reader);
    if (reader.text[reader.at] === "}") { reader.at += 1; return map; }
  }
}

function plainKey(reader: Reader): string {
  const start = reader.at;
  while (reader.at < reader.text.length && !":,}".includes(reader.text[reader.at]!)) reader.at += 1;
  const key = reader.text.slice(start, reader.at).trim();
  if (key === "") throw new YamlError("A flow mapping entry needs a name", reader.line);
  return key;
}

/** A quoted scalar from the cursor. Single quotes are literal but for `''`; double quotes escape. */
function quotedFrom(reader: Reader): string {
  const quote = reader.text[reader.at]!;
  reader.at += 1;
  let out = "";

  while (reader.at < reader.text.length) {
    const char = reader.text[reader.at]!;

    if (char === quote) {
      if (quote === "'" && reader.text[reader.at + 1] === "'") {
        out += "'";
        reader.at += 2;
        continue;
      }
      reader.at += 1;
      return out;
    }

    if (char === "\\" && quote === '"') {
      const escape = reader.text[reader.at + 1];
      reader.at += 2;
      if (escape === "n") { out += "\n"; continue; }
      if (escape === "t") { out += "\t"; continue; }
      if (escape === "r") { out += "\r"; continue; }
      if (escape === "0") { out += "\0"; continue; }
      if (escape === '"' || escape === "\\" || escape === "/" || escape === "'") { out += escape; continue; }
      if (escape === "u") {
        const digits = reader.text.slice(reader.at, reader.at + 4);
        if (!/^[0-9a-fA-F]{4}$/u.test(digits)) throw new YamlError("\\u needs four hex digits", reader.line);
        out += String.fromCharCode(Number.parseInt(digits, 16));
        reader.at += 4;
        continue;
      }
      throw new YamlError(`\\${escape ?? ""} is not an escape this parser reads`, reader.line);
    }

    out += char;
    reader.at += 1;
  }

  throw new YamlError("A quoted value is not closed", reader.line);
}
