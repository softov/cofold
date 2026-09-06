import type { Coercer } from "./coerce.js";
import type { StandardSchemaV1 } from "./schema.js";

/**
 * What a command is.
 *
 * A plain object, and that is the entire thesis of this library. Commander
 * hides a command inside a closure, so the declaration is consumed once - by
 * the help printer - and is then unreachable. Here the declaration outlives the
 * call: the parser reads it, `--help` reads it, the shell completion reads it,
 * the markdown reference reads it, and the MCP adapter reads it. A command
 * therefore cannot be documented one way and behave another, because there is
 * only one statement and everything else is a rendering of it.
 */

/** Which rendering of the registry is running the command. */
export type Surface = "cli" | "mcp" | "remote" | (string & {});

export interface CompletionContext {
  /** The words already typed, for a source that narrows on them. */
  readonly words: readonly string[];
  /** What is being completed, possibly a partial word. */
  readonly current: string;
  readonly command: Command | null;
}

/**
 * Where the shell gets its candidates.
 *
 * A function, not only a list, because the interesting values are never static:
 * the ids on this server, the profiles in this configuration. Completion that
 * only knows the words the author typed is completion nobody uses twice.
 */
export type CompletionSource =
  | readonly string[]
  | ((context: CompletionContext) => readonly string[] | Promise<readonly string[]>);

export interface OptionSpec<T = unknown> {
  /** The long form, with its dashes: `--limit`. */
  name: string;
  /** The short form, with its dash: `-l`. Optional, and usually a mistake to invent. */
  short?: string;
  /**
   * The placeholder shown in help - `N`, `PATH`, `KEY=VALUE`.
   *
   * Its absence is what makes an option a flag. One field decides both the help
   * text and the parse, so a flag cannot be documented as taking a value.
   */
  value?: string;
  description: string;
  /** Giving it twice collects both rather than the last one winning. */
  repeatable?: boolean;
  required?: boolean;
  /** Applied when the option is absent and no environment variable answers. */
  default?: T;
  /** Consulted before the default. `SOFTCLI_URL`, and so on. */
  env?: string;
  /** How the word becomes a value, and what shape that value has. */
  coerce?: Coercer<T>;
  /** `--color` also accepting `--no-color`. */
  negatable?: boolean;
  /** Parsed and usable, but absent from help and completion. */
  hidden?: boolean;
  complete?: CompletionSource;
  /** The canonical input key. Derived from the name when omitted: `--dry-run` -> `dryRun`. */
  field?: string;
}

/** Extra about a `:slot` of the pattern; the slot itself declares the name. */
export interface ArgumentSpec<T = unknown> {
  description?: string;
  coerce?: Coercer<T>;
  complete?: CompletionSource;
  field?: string;
}

export interface CommandExample {
  command: string;
  description?: string;
}

/**
 * Which surfaces render this command.
 *
 * `mcp` is off unless a command says otherwise, and that default is a
 * deliberate refusal: registering a package of commands must never quietly hand
 * an agent a set of arbitrary mutation tools. `cli` and `docs` are on, because
 * a command nobody can run or read about is not a command.
 */
export interface SurfaceFlags {
  cli?: boolean;
  mcp?: boolean;
  docs?: boolean;
}

export interface CommandDefinition<Deps extends object = object, Needs extends readonly string[] = readonly string[]> {
  /** Stable, dotted, and never rendered to a person: `case.show`. */
  id: string;
  /**
   * The words, with `:name` for a slot.
   *
   * `:name?` is optional and `:name...` takes the rest. Both must come after
   * every required slot, which is checked when the command is registered rather
   * than discovered when somebody types it.
   */
  pattern: readonly string[];
  summary: string;
  /** The paragraph under the usage line. Markdown, for the generated reference. */
  description?: string;
  /**
   * Which part of the surface this belongs to.
   *
   * Optional here and required by convention in a program that generates docs
   * grouped by it - see `Registry`'s `groups` option, which turns the omission
   * into an error at registration.
   */
  group?: string;
  options?: readonly OptionSpec[];
  arguments?: Readonly<Record<string, ArgumentSpec>>;
  /** Capability names resolved before the handler runs, and typed into its context. */
  needs?: Needs;
  /** Checked against whatever the registry's `authorize` hook knows. */
  scopes?: readonly string[];
  /**
   * A schema over the whole canonical input, after coercion.
   *
   * For what per-option coercers cannot say: "either --since or --until",
   * "--limit only with --sort". Any Standard Schema library will do.
   */
  input?: StandardSchemaV1;
  /** The canonical field piped stdin fills, when nothing was given for it. */
  stdin?: string;
  surfaces?: SurfaceFlags;
  /**
   * Whatever an adapter needs and the framework does not understand.
   *
   * The HTTP binding a remote command was built from lives here, and so does
   * anything a program invents. Deliberately untyped and deliberately ignored
   * by everything in this package: an extension point that the core has an
   * opinion about is not an extension point.
   */
  meta?: Readonly<Record<string, unknown>>;
  examples?: readonly CommandExample[];
  hidden?: boolean;
  run(context: Deps & import("./context.js").CommandContext):
    | import("./context.js").Output
    | void
    | Promise<import("./context.js").Output | void>;
}

export type Command = CommandDefinition<object, readonly string[]>;

/** The parsed form of one pattern word. */
export type PatternToken =
  | { kind: "literal"; word: string }
  | { kind: "slot"; name: string; optional: boolean; variadic: boolean };

export function parsePattern(pattern: readonly string[]): PatternToken[] {
  return pattern.map((word) => {
    if (!word.startsWith(":")) return { kind: "literal", word };
    const variadic = word.endsWith("...");
    const body = variadic ? word.slice(1, -3) : word.slice(1);
    const optional = body.endsWith("?");
    // A variadic slot still wants at least one word. `:ids?...` is how you say
    // that none is acceptable - the question mark means the same thing in both
    // positions, which is one rule instead of two.
    return { kind: "slot", name: optional ? body.slice(0, -1) : body, optional, variadic };
  });
}

/** The literal words at the front: what help-by-prefix and completion walk. */
export function literalPrefix(command: Command): string[] {
  const words: string[] = [];
  for (const token of parsePattern(command.pattern)) {
    if (token.kind !== "literal") break;
    words.push(token.word);
  }
  return words;
}

/** The usage line without the program name: `case show <id> [--json]`. */
export function commandPattern(command: Command): string {
  return parsePattern(command.pattern)
    .map((token) => {
      if (token.kind === "literal") return token.word;
      if (token.variadic) return token.optional ? `[${token.name}...]` : `<${token.name}...>`;
      return token.optional ? `[${token.name}]` : `<${token.name}>`;
    })
    .join(" ");
}

export function surfaceEnabled(command: Command, surface: Surface): boolean {
  const flags = command.surfaces ?? {};
  if (surface === "mcp") return flags.mcp === true;
  if (surface === "docs") return flags.docs !== false;
  if (surface === "cli") return flags.cli !== false;
  return true;
}

/** `--dry-run` -> `dryRun`, so a canonical input is an ordinary object. */
export function fieldNameOf(option: OptionSpec): string {
  if (option.field !== undefined) return option.field;
  return option.name
    .replace(/^--/u, "")
    .replace(/-([a-z0-9])/gu, (_match, letter: string) => letter.toUpperCase());
}

export function optionsOf(command: Command): readonly OptionSpec[] {
  return command.options ?? [];
}

export function isFlag(option: OptionSpec): boolean {
  return option.value === undefined;
}

/**
 * Everything not marked `hidden`.
 *
 * One predicate over both commands and options, because it is the same
 * predicate: nine call sites spelled `x.hidden !== true` were nine chances for
 * one surface to start showing what the others hide.
 */
export function visible<T extends { hidden?: boolean }>(items: readonly T[]): T[] {
  return items.filter((item) => item.hidden !== true);
}

/**
 * The words typed so far are a prefix of this command's literal words.
 *
 * What `--help` and the next-word completion ask: "of everything registered,
 * which could these words still turn into".
 */
export function underPrefix(command: Command, words: readonly string[]): boolean {
  const literals = literalPrefix(command);
  return words.every((word, index) => literals[index] === word);
}

/**
 * Every literal word of this command has been typed.
 *
 * The other direction, and the one that is easy to write by mistake: this asks
 * "has the command been named yet", which is what decides whose options are in
 * scope for completion.
 */
export function fullyNamed(command: Command, words: readonly string[]): boolean {
  return literalPrefix(command).every((word, index) => words[index] === word);
}

/**
 * What help and the generated reference say about an option beyond its
 * description, as data rather than as a sentence.
 *
 * The list is the shared part - miss `repeatable` here and one surface silently
 * stops mentioning it - and the wording is not: a terminal writes `env URL` and
 * markdown writes ``env `URL` ``. So this returns the notes and each surface
 * spells them.
 */
export type OptionNote =
  | { kind: "required" }
  | { kind: "repeatable" }
  | { kind: "env"; name: string }
  | { kind: "default"; value: unknown }
  | { kind: "candidates"; values: readonly string[] };

export function optionNotes(option: OptionSpec): OptionNote[] {
  const notes: OptionNote[] = [];
  if (option.required === true) notes.push({ kind: "required" });
  if (option.repeatable === true) notes.push({ kind: "repeatable" });
  if (option.env !== undefined) notes.push({ kind: "env", name: option.env });
  if (option.default !== undefined) notes.push({ kind: "default", value: option.default });
  if (option.coerce?.candidates !== undefined) {
    notes.push({ kind: "candidates", values: option.coerce.candidates });
  }
  return notes;
}
