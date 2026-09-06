import {
  ArgumentError,
  isFlag,
  literalPrefix,
  optionsOf,
  parsePattern,
  type Command,
  type OptionSpec,
} from "../index.js";
import { didYouMean } from "./suggest.js";

/**
 * Words and flags, in two passes.
 *
 * The first pass is permissive and only needs to find the *words*, because
 * until the words are known there is no command, and until there is a command
 * there is no correct option table. The second pass is strict against that
 * command's own table.
 *
 * That is the fix for a wart in every registry-based parser I have written
 * before: one flat table across all commands, so two commands could not declare
 * the same option name with different shapes, and the collision was silent -
 * whichever registered last won for everybody.
 */

interface TableEntry {
  spec: OptionSpec;
  negated: boolean;
}

function addToTable(table: Map<string, TableEntry>, option: OptionSpec, permissive: boolean): void {
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

export function optionTable(options: readonly OptionSpec[], permissive = false): Map<string, TableEntry> {
  const table = new Map<string, TableEntry>();
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
function valueLooksLikeOption(value: string, table: Map<string, TableEntry>): boolean {
  return table.has(value.split("=", 1)[0]!);
}

export function tokenize(
  table: Map<string, TableEntry>,
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
  table: Map<string, TableEntry>,
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

export interface Invocation {
  command: Command | null;
  slots: Record<string, string | string[]>;
  options: Record<string, string | string[] | boolean>;
  /** The words typed, for help on a command that is only half written. */
  words: string[];
  passthrough: string[];
}

export function parse(
  commands: readonly Command[],
  globals: readonly OptionSpec[],
  argv: readonly string[],
): Invocation {
  const union = optionTable([...globals, ...commands.flatMap(optionsOf)], true);
  const scouted = tokenize(union, argv, { permissive: true });
  const match = matchCommand(commands, scouted.words);

  if (match === null) {
    const [first] = scouted.unknown;
    if (first !== undefined) {
      const known = [...union.keys()].filter((name) => name.startsWith("--"));
      throw new ArgumentError(`Unknown option ${first}.${didYouMean(first, known)}`);
    }
    // Still tokenised against the globals, so `--help` and `--version` work on a
    // command line that is only half written.
    const strictGlobals = tokenize(optionTable(globals), argv, { permissive: true });
    return {
      command: null,
      slots: {},
      options: strictGlobals.options,
      words: scouted.words,
      passthrough: scouted.passthrough,
    };
  }

  const table = optionTable([...globals, ...optionsOf(match.command)]);
  const strict = tokenize(table, argv, { permissive: false });
  const rematch = matchCommand([match.command], strict.words) ?? match;

  for (const option of optionsOf(match.command)) {
    if (option.required === true && strict.options[option.name] === undefined && option.env === undefined) {
      throw new ArgumentError(`${option.name} is required for ${literalPrefix(match.command).join(" ")}`);
    }
  }

  return {
    command: match.command,
    slots: rematch.slots,
    options: strict.options,
    words: strict.words,
    passthrough: strict.passthrough,
  };
}
