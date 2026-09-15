import {
  ArgumentError,
  didYouMean,
  literalPrefix,
  matchCommand,
  optionsOf,
  optionTable,
  tokenize,
  type Command,
  type OptionSpec,
} from "../index.js";

/**
 * One command line, in two passes.
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
 *
 * The grammar both passes run on is `facio`'s, not this package's: the words
 * and flags of a command line mean the same thing whoever typed them. What is
 * here is the policy on top - the standard globals, which are parsed even when
 * no command matched, and a required option that was never given.
 */

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
