import type { Coercer } from "./coerce.js";
import type { Command } from "./command.js";
import type { JsonSchema } from "@doopx/sdk";

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
  /** Consulted before the default. `FACIO_URL`, and so on. */
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

/** One input field: what the value may be, and how a surface spells it. */
export type Field = JsonSchema & {
  cli?: CliField;
  /** Consulted before the default, on any surface that has an environment. */
  env?: string;
};

/**
 * How one field is typed at a terminal. Spelling, never shape.
 *
 * `flag` only where it is not the field's own name, and `value` only where the
 * placeholder should read as something other than the type. Absence of `value`
 * is what makes a field a flag, because arity is not derivable from a type:
 * `--color` and `--color=true` are both spellings of one boolean.
 */
export interface CliField {
  flag?: string;
  short?: string;
  value?: string;
  complete?: CompletionSource;
  hidden?: boolean;
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

/** Every field the command can produce, for docs, MCP schemas and validation. */
export interface FieldDescriptor {
  name: string;
  source: "argument" | "option";
  label: string;
  description: string;
  required: boolean;
  repeated: boolean;
  coerce: Coercer<unknown>;
  option?: OptionSpec;
}
