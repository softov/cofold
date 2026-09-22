import type { Coercer } from "./types/coerce.js";
import type { ActionDefinition, Command, CommandMeta, PatternToken, Surface, Surfaces } from "./types/command.js";
import type { ArgumentSpec, Field, OptionNote, OptionSpec } from "./types/field.js";
import type { JsonSchema } from "@cofold/sdk";


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

/**
 * A schema as the coercer every surface reads.
 *
 * An `enum` is the set, so it is also the completion candidates and the values
 * help prints. Leaving it as the schema alone would mean an action declaring
 * `enum: ["open", "done"]` completed nothing, while the same set written as
 * `coerce.oneOf` completed both.
 */
function coercerFor(schema: JsonSchema): Coercer<unknown> {
  return {
    schema,
    ...(schema.enum === undefined ? {} : { candidates: schema.enum.map(String) }),
  };
}

/** `dryRun` -> `--dry-run`, so a flag is never spelled twice. */
const flagFor = (name: string): string => `--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;

/**
 * One action, as the command every surface reads.
 *
 * The pattern decides which fields are positional; the rest become options,
 * spelled from `cli` where it says so and from the field's own name where it
 * does not. Everything else is carried across untouched.
 */
export function commandFor(definition: ActionDefinition<never, never, Record<string, Field>, readonly string[]>): Command {
  const input = definition.input ?? {};
  const cli = definition.surfaces.cli;
  const required = definition.required ?? [];
  const slotWords = (cli?.pattern ?? []).filter((word) => word.startsWith(":"));
  const slots = slotWords.map((word) => word.replace(/^:|\.{3}$|\?$/gu, ""));
  const variadic = new Set(slotWords.filter((word) => word.endsWith("...")).map((word) => word.replace(/^:|\.{3}$|\?$/gu, "")));

  for (const name of slots) {
    if (input[name] === undefined) {
      throw new Error(`${definition.id}: the pattern names :${name}, which is not an input field`);
    }
    if (variadic.has(name) && input[name]!.type !== "array") {
      throw new Error(`${definition.id}: :${name}... takes several words, so the field must be an array`);
    }
  }

  const { cli: _cli, mcp: _mcp, docs: _docs, ...rest } = definition.surfaces;
  const surfaceMeta = Object.keys(rest).length === 0 ? undefined : rest as CommandMeta;

  const args: Record<string, ArgumentSpec> = {};
  for (const name of slots) {
    const { cli: spelling, env: _env, ...schema } = input[name] as Field;
    // A variadic slot arrives one word at a time; each word is one item of the array.
    const each = variadic.has(name) ? schema.items ?? { type: "string" as const } : schema;
    args[name] = {
      ...(schema.description === undefined ? {} : { description: schema.description }),
      ...(spelling?.complete === undefined ? {} : { complete: spelling.complete }),
      coerce: coercerFor(each),
    };
  }

  const options: OptionSpec[] = Object.entries(input)
    .filter(([name]) => !slots.includes(name))
    .map(([name, field]) => {
      const { cli: spelling, env, ...schema } = field;
      const list = schema.type === "array";
      const each = list ? schema.items ?? { type: "string" as const } : schema;
      return {
        name: spelling?.flag ?? flagFor(name),
        description: schema.description ?? "",
        field: name,
        coerce: coercerFor(each),
        ...(spelling?.short === undefined ? {} : { short: spelling.short }),
        ...(each.type === "boolean" && spelling?.value === undefined
          ? {}
          : { value: spelling?.value ?? "VALUE" }),
        ...(list ? { repeatable: true } : {}),
        ...(schema.default === undefined ? {} : { default: schema.default }),
        ...(required.includes(name) ? { required: true } : {}),
        ...(env === undefined ? {} : { env }),
        ...(spelling?.hidden === true ? { hidden: true } : {}),
        ...(spelling?.complete === undefined ? {} : { complete: spelling.complete }),
      };
    });

  return {
    id: definition.id,
    // An action with no command line still needs an id-shaped pattern: nothing
    // will match it, because `cli` is off and no parser is offered the words.
    pattern: cli?.pattern ?? definition.id.split("."),
    summary: definition.summary,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.group === undefined ? {} : { group: definition.group }),
    ...(Object.keys(args).length === 0 ? {} : { arguments: args }),
    ...(options.length === 0 ? {} : { options }),
    ...(definition.needs === undefined ? {} : { needs: definition.needs }),
    ...(definition.scopes === undefined ? {} : { scopes: definition.scopes }),
    ...(definition.refine === undefined ? {} : { refine: definition.refine }),
    ...(cli?.stdin === undefined ? {} : { stdin: cli.stdin }),
    ...(definition.examples === undefined ? {} : { examples: definition.examples }),
    ...(definition.hidden === undefined ? {} : { hidden: definition.hidden }),
    /*
     * A surface's own configuration, kept where that surface already reads it.
     * `Surfaces` is widened by the adapter that owns the key, so the binding is
     * typed at the declaration and the core still knows no protocol.
     */
    ...(definition.meta === undefined && surfaceMeta === undefined
      ? {}
      : { meta: { ...definition.meta, ...surfaceMeta } }),
    surfaces: {
      cli: cli !== undefined,
      mcp: definition.surfaces.mcp === true,
      docs: definition.surfaces.docs ?? cli !== undefined,
    },
    run: definition.run,
  } as Command;
}

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
  if (surface === "remote") return flags.remote !== false;
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
