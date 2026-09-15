import { ArgumentError } from "./errors.js";
import { isFlag, parsePattern, type Command, type OptionSpec } from "./command.js";
import { didYouMean } from "./suggest.js";

/**
 * argv as a grammar.
 *
 * Words, options, clusters, negations and everything after `--`, with no
 * terminal anywhere: the lexer a command line shares with anything else that
 * hands a program a line of arguments. What a terminal adds on top of it -
 * help, colour, completion, exit codes - is `facio/cli`.
 *
 * Two commands may declare the same option name with different shapes, so a
 * table is built per command rather than once per program. `permissive` is for
 * a caller that has to read the words before it knows which command they name,
 * and so has to tokenise against the union of every table first.
 */

export interface OptionTableEntry {
  spec: OptionSpec;
  negated: boolean;
}

function addToTable(table: Map<string, OptionTableEntry>, option: OptionSpec, permissive: boolean): void {
  const existing = table.get(option.name);
  // Permissive pass: when two commands disagree, assume the one that takes a
  // value, so its value is never mistaken for a word.
  if (existing !== undefined && permissive && isFlag(option) && !isFlag(existing.spec)) return;
  table.set(option.name, { spec: option, negated: false });
  if (option.short !== undefined) table.set(option.short, { spec: option, negated: false });
  if (option.negatable === true || (isFlag(option) && option.name.startsWith("--no-"))) {
    const inverse = option.name.startsWith("--no-") ? `--${option.name.slice(5)}` : `--no-${option.name.slice(2)}`;
    if (!table.has(inverse)) table.set(inverse, { spec: option, negated: true });
  }
}

export function optionTable(options: readonly OptionSpec[], permissive = false): Map<string, OptionTableEntry> {
  const table = new Map<string, OptionTableEntry>();
  for (const option of options) addToTable(table, option, permissive);
  return table;
}

export interface Tokens {
  words: string[];
  /**
   * Options the permissive pass did not recognise.
   *
   * Kept rather than dropped because of how a typo reads without them: an
   * unknown `--limt` becomes a flag, its value becomes a word, no command
   * matches those words, and the program answers "unknown command note list 3"
   * about a command line that named a perfectly good command.
   */
  unknown: string[];
  /** Keyed by the option's long name, with its dashes. */
  options: Record<string, string | string[] | boolean>;
  /** Everything after `--`, untouched. Also appended to `words`. */
  passthrough: string[];
}

interface TokenizeOptions {
  /** Unknown options are guesses rather than errors: the first pass. */
  permissive: boolean;
}

function record(
  options: Record<string, string | string[] | boolean>,
  spec: OptionSpec,
  value: string | boolean,
): void {
  if (spec.repeatable === true && typeof value === "string") {
    const collected = options[spec.name];
    options[spec.name] = [...(Array.isArray(collected) ? collected : []), value];
    return;
  }
  options[spec.name] = value;
}

/**
 * A value that begins with a dash.
 *
 * `--summary --draft` is almost always a forgotten value rather than a summary
 * of "--draft", so it is refused - but only when the next word is an option
 * this program actually knows. Anything else is taken verbatim, which is what
 * makes `--pattern -foo` and negative numbers work at all. The error names the
 * escape hatch, because `--summary=--draft` is unambiguous and always available.
 */
function valueLooksLikeOption(value: string, table: Map<string, OptionTableEntry>): boolean {
  return table.has(value.split("=", 1)[0]!);
}

export function tokenize(
  table: Map<string, OptionTableEntry>,
  argv: readonly string[],
  { permissive }: TokenizeOptions,
): Tokens {
  const words: string[] = [];
  const passthrough: string[] = [];
  const unknown: string[] = [];
  const options: Record<string, string | string[] | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;

    if (argument === "--") {
      passthrough.push(...argv.slice(index + 1));
      words.push(...passthrough);
      break;
    }

    const isLong = argument.startsWith("--");
    const isShort = !isLong && argument.startsWith("-") && argument.length > 1 && !/^-\d/u.test(argument);

    if (!isLong && !isShort) {
      words.push(argument);
      continue;
    }

    const [rawName, inline] = splitInline(argument);
    if (isShort && rawName.length > 2) {
      index = expandCluster(table, argv, index, rawName, inline, options, permissive);
      continue;
    }

    const entry = table.get(rawName);
    if (entry === undefined) {
      if (!permissive) {
        const known = [...table.keys()].filter((name) => name.startsWith("--"));
        throw new ArgumentError(`Unknown option ${rawName}.${didYouMean(rawName, known)}`);
      }
      // Best guess, and only for finding words: `--x=y` consumed its value, a
      // bare `--x` might or might not take the next word, and assuming it does
      // not is the reading that keeps a real command matchable.
      unknown.push(rawName);
      options[rawName] = inline ?? true;
      continue;
    }

    if (isFlag(entry.spec)) {
      if (inline !== undefined) {
        throw new ArgumentError(`${rawName} does not take a value`);
      }
      record(options, entry.spec, !entry.negated);
      continue;
    }

    const next = argv[index + 1];
    const value = inline ?? next;
    if (value === undefined || (inline === undefined && valueLooksLikeOption(value, table))) {
      // In the permissive pass this is not necessarily wrong: the union table
      // may have guessed "takes a value" from a *different* command that
      // declares the same name. Assume a flag, find the words, and let the
      // strict pass against the real command decide.
      if (permissive) {
        record(options, entry.spec, true);
        continue;
      }
      throw new ArgumentError(
        `${rawName} requires ${entry.spec.value ?? "a value"}; use ${rawName}=VALUE if it starts with a dash`,
      );
    }
    record(options, entry.spec, value);
    if (inline === undefined) index += 1;
  }

  return { words, options, passthrough, unknown };
}

function splitInline(argument: string): [string, string | undefined] {
  const at = argument.indexOf("=");
  return at === -1 ? [argument, undefined] : [argument.slice(0, at), argument.slice(at + 1)];
}

/** `-abc`, and `-n5` - the last letter of a cluster may take the value. */
function expandCluster(
  table: Map<string, OptionTableEntry>,
  argv: readonly string[],
  index: number,
  cluster: string,
  inline: string | undefined,
  options: Record<string, string | string[] | boolean>,
  permissive: boolean,
): number {
  const letters = cluster.slice(1).split("");
  for (const [position, letter] of letters.entries()) {
    const entry = table.get(`-${letter}`);
    if (entry === undefined) {
      if (permissive) continue;
      throw new ArgumentError(`Unknown option -${letter} in ${cluster}`);
    }
    if (isFlag(entry.spec)) {
      record(options, entry.spec, !entry.negated);
      continue;
    }
    const attached = letters.slice(position + 1).join("");
    if (attached !== "") {
      record(options, entry.spec, inline === undefined ? attached : `${attached}=${inline}`);
      return index;
    }
    const next = inline ?? argv[index + 1];
    if (next === undefined) {
      throw new ArgumentError(`-${letter} requires ${entry.spec.value ?? "a value"}`);
    }
    record(options, entry.spec, next);
    return inline === undefined ? index + 1 : index;
  }
  return index;
}

export interface Match {
  command: Command;
  slots: Record<string, string | string[]>;
  /** How many literal words matched: how a specific command beats a general one. */
  score: number;
}

/**
 * Which command those words are.
 *
 * Scored rather than first-wins, so `report submit <case> <type>` beats
 * `report <id>` for the words "report submit x y" - a literal is always a
 * better reading of what somebody typed than a slot that happens to fit.
 */
export function matchCommand(commands: readonly Command[], words: readonly string[]): Match | null {
  let best: Match | null = null;
  for (const command of commands) {
    const match = matchOne(command, words);
    if (match !== null && (best === null || match.score > best.score)) best = match;
  }
  return best;
}

function matchOne(command: Command, words: readonly string[]): Match | null {
  const tokens = parsePattern(command.pattern);
  const slots: Record<string, string | string[]> = {};
  let score = 0;
  let index = 0;

  for (const token of tokens) {
    if (token.kind === "literal") {
      if (words[index] !== token.word) return null;
      score += 1;
      index += 1;
      continue;
    }
    if (token.variadic) {
      const rest = words.slice(index);
      if (rest.length === 0 && !token.optional) return null;
      if (rest.length > 0) slots[token.name] = rest;
      index = words.length;
      continue;
    }
    if (index >= words.length) {
      if (!token.optional) return null;
      continue;
    }
    slots[token.name] = words[index]!;
    index += 1;
  }

  return index === words.length ? { command, slots, score } : null;
}
