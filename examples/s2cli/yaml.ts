/**
 * A YAML subset, read without a dependency.
 *
 * `softcli` promises zero runtime dependencies, and a command document is
 * useless if reading it costs one. So this reads the subset a command document
 * is written in - block mappings, block sequences, flow collections, quoted and
 * plain scalars - and *refuses* everything else by name rather than guessing at
 * it. A hand-written YAML parser is a liability exactly to the extent that it
 * accepts a document and reads it differently from a real one; refusing
 * anchors, aliases, tags, block scalars, merge keys and multiple documents is
 * how that liability is bounded.
 *
 * It is also deliberately replaceable. Nothing downstream reads YAML: the
 * document reader takes parsed data, so swapping this for a full parser is one
 * import in `load.ts` and changes no other file.
 */

export class YamlError extends Error {
  public readonly line: number;

  public constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = "YamlError";
    this.line = line;
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
export function parseYaml(text: string): unknown {
  const lines = scan(text);
  if (lines.length === 0) return null;
  const first = lines[0]!;
  if (first.indent !== 0) throw new YamlError("The document starts indented", first.number);
  const [value, at] = block(lines, 0, 0);
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

  text.split(/\r?\n/u).forEach((raw, index) => {
    const number = index + 1;
    const stripped = stripComment(raw);
    const trimmed = stripped.trim();
    if (trimmed === "") return;

    if (trimmed === "---") {
      if (opened || lines.length > 0) throw new YamlError("s2cli reads one document per file", number);
      opened = true;
      return;
    }
    if (trimmed === "...") throw new YamlError("s2cli reads one document per file", number);

    const indent = stripped.length - stripped.trimStart().length;
    if (stripped.slice(0, indent).includes("\t")) {
      throw new YamlError("YAML is indented with spaces, and this line uses a tab", number);
    }
    lines.push({ indent, text: trimmed, number });
  });

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
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "#" && (at === 0 || /\s/u.test(raw[at - 1]!))) return raw.slice(0, at);
  }
  return raw;
}

function isItem(line: Line): boolean {
  return line.text === "-" || line.text.startsWith("- ");
}

function block(lines: Line[], at: number, indent: number): [unknown, number] {
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
    if (key === "<<") throw new YamlError("s2cli does not read merge keys", line.number);
    if (Object.hasOwn(map, key)) throw new YamlError(`${key} is given twice`, line.number);

    const rest = line.text.slice(colon + 1).trim();
    if (rest !== "") {
      map[key] = rest.startsWith("[") || rest.startsWith("{")
        ? parseFlow(rest, line.number)
        : scalar(rest, line.number);
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
      map[key] = value;
      cursor = after;
      continue;
    }
    map[key] = null;
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
    if (char === '"' || char === "'") { quote = char; continue; }
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
      throw new YamlError(`s2cli does not read ${what}; quote the value if it is text`, line);
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
    if (reader.text[reader.at] !== ":") {
      throw new YamlError("A flow mapping entry is written name: value", reader.line);
    }
    reader.at += 1;
    if (Object.hasOwn(map, key)) throw new YamlError(`${key} is given twice`, reader.line);
    map[key] = flowValue(reader);

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
      throw new YamlError(`\\${escape ?? ""} is not an escape s2cli reads`, reader.line);
    }

    out += char;
    reader.at += 1;
  }

  throw new YamlError("A quoted value is not closed", reader.line);
}
