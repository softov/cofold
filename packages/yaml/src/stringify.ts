import { YamlError } from "./yaml.js";

/**
 * The writer of the subset `parseYaml` reads: block mappings and sequences,
 * `{}` and `[]` for empty collections, literal block scalars for multi-line
 * text, and plain or double-quoted scalars. What it writes reads back as the
 * same value.
 */

/** A literal block scalar's header and its content lines, before indentation. */
interface Literal {
  header: string;
  lines: string[];
}

/** What a plain scalar may not start with: a YAML indicator or a quote. */
const INDICATORS = "-?:,[]{}#&*!|>'\"%@`";

/**
 * Plain text that `scalar`, or another reader of the YAML 1.2 core schema,
 * reads as null, a boolean or a number.
 */
const TYPED = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?\d+|0o[0-7]+|0x[\da-fA-F]+|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/u;

/** Characters plain text may not hold: controls, line separators, lone surrogates, and flow brackets. */
const UNPLAIN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff[\]{}]|:\s|:$|\s#|[:-]\s+[|>][1-9+-]*$/u;

/** Characters a key may not hold plain, because `keyAt` reads them as quotes or flow brackets. */
const UNPLAIN_KEY = /["',]/u;

/** Characters a literal block scalar cannot carry through `blockScalars`. */
const UNLITERAL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u;

/** Characters a double-quoted scalar writes as an escape. */
const ESCAPED = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff"\\]/gu;

const ESCAPES: Readonly<Record<string, string>> = { "\n": "\\n", "\t": "\\t", "\r": "\\r", '"': '\\"', "\\": "\\\\" };

/** The value as YAML text that `parseYaml` reads back as the same value. */
export function stringifyYaml(value: unknown): string {
  const out: string[] = [];
  if (Array.isArray(value) && value.length > 0) sequence(value, 0, out);
  else if (isObject(value) && entries(value).length > 0) mapping(value, 0, out, "");
  else out.push(inline(value, out));
  return `${out.join("\n")}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The keys JSON writes: own enumerable keys whose value is not `undefined`. */
function entries(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

/** A block sequence whose dashes sit at `indent`. */
function sequence(items: unknown[], indent: number, out: string[]): void {
  const pad = " ".repeat(indent);
  for (let at = 0; at < items.length; at += 1) {
    const item = items[at];
    /*
     * A mapping opens on the dash's own line unless its first value is a
     * literal block scalar, whose content `blockScalars` measures from the dash.
     */
    if (isObject(item)) {
      const keys = entries(item);
      if (keys.length > 0 && literalOf(item[keys[0]!]) === undefined) {
        mapping(item, indent + 2, out, `${pad}- `);
        continue;
      }
    }
    entry(`${pad}-`, item, indent, out);
  }
}

/** A block mapping whose keys sit at `indent`; the first key's line starts with `first` when it is not empty. */
function mapping(value: Record<string, unknown>, indent: number, out: string[], first: string): void {
  const pad = " ".repeat(indent);
  entries(value).forEach((key, at) => {
    if (key === "<<") throw new YamlError("The key << is a merge key, which parseYaml refuses", out.length + 1);
    entry(`${at === 0 && first !== "" ? first : pad}${keyOf(key)}:`, value[key], indent, out);
  });
}

/** One entry: `lead` is the dash or the key with its colon, already indented to `indent`. */
function entry(lead: string, value: unknown, indent: number, out: string[]): void {
  if (Array.isArray(value) && value.length > 0) {
    out.push(lead);
    sequence(value, indent + 2, out);
    return;
  }
  if (isObject(value) && entries(value).length > 0) {
    out.push(lead);
    mapping(value, indent + 2, out, "");
    return;
  }
  const literal = literalOf(value);
  if (literal !== undefined) {
    const pad = " ".repeat(indent + 2);
    out.push(`${lead} ${literal.header}`);
    for (const line of literal.lines) out.push(line === "" ? "" : pad + line);
    return;
  }
  out.push(`${lead} ${inline(value, out)}`);
}

/** A value on one line: a scalar, or an empty collection. */
function inline(value: unknown, out: string[]): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new YamlError(`${value} is not a JSON value`, out.length + 1);
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (typeof value === "string") return plain(value) ? value : quoted(value);
  if (Array.isArray(value)) return "[]";
  if (isObject(value)) return "{}";
  throw new YamlError(`${value === undefined ? "undefined" : `A ${typeof value}`} is not a JSON value`, out.length + 1);
}

/** Text `scalar` reads back unquoted as the same text. */
function plain(text: string): boolean {
  return text !== ""
    && text !== "..."
    && text === text.trim()
    && !INDICATORS.includes(text[0]!)
    && !UNPLAIN.test(text)
    && !TYPED.test(text);
}

function keyOf(key: string): string {
  return plain(key) && !UNPLAIN_KEY.test(key) ? key : quoted(key);
}

function quoted(text: string): string {
  return `"${text.replace(ESCAPED, (char) => ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}

/**
 * Multi-line text as a literal block scalar, or `undefined` when the block
 * cannot carry it: a line of only spaces, which `blockScalars` reads as empty,
 * no line with text, or a character a quoted scalar has to escape.
 */
function literalOf(value: unknown): Literal | undefined {
  if (typeof value !== "string" || !value.includes("\n") || UNLITERAL.test(value)) return undefined;
  const trailing = /\n*$/u.exec(value)![0].length;
  const lines = (trailing > 0 ? value.slice(0, -1) : value).split("\n");
  if (lines.some((line) => line !== "" && line.trim() === "")) return undefined;
  const text = lines.find((line) => line !== "");
  if (text === undefined) return undefined;
  const indicator = /^\s/u.test(text) ? "2" : "";
  const chomping = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
  return { header: `|${indicator}${chomping}`, lines };
}
