import type { CommandContext, Output } from "./context.js";
import type { ArgumentSpec, Field, OptionSpec } from "./field.js";
import type { StandardSchema } from "@doopx/sdk";

/** Which rendering of the registry is running the command. */
export type Surface = "cli" | "mcp" | "remote" | (string & {});

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
  /**
   * Whether a command with a binding is published to a remote surface.
   *
   * On when there is a binding to publish, because writing one is already the
   * opt-in - unlike `mcp`, which is a bare flag and so has to default off.
   * This exists so a command can be an endpoint's business and not the
   * documentation's, or the other way round; publishing used to be decided by
   * `docs`, which meant hiding a command from the reference also withdrew it
   * from the network.
   */
  remote?: boolean;
}

/**
 * What an adapter attaches to a command that the core does not read.
 *
 * Empty here on purpose, and widened by whichever surface owns the key -
 * `@doopx/remote` adds `http`. So the binding is checked at the declaration
 * without the core learning a protocol, and a program that never imports a
 * surface is never offered its key.
 */
export interface CommandMeta {}

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
   * For what a field's own schema cannot say: "either --since or --until",
   * "--limit only with --sort". Any Standard Schema library will do. Named for
   * what it adds rather than what it covers, because `input` is the fields.
   */
  refine?: StandardSchema;
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
  meta?: CommandMeta;
  examples?: readonly CommandExample[];
  hidden?: boolean;
  run(context: Deps & CommandContext):
    | Output
    | void
    | Promise<Output | void>;
}

export type Command = CommandDefinition<object, readonly string[]>;

/**
 * Which surfaces render an action, and what each needs to do it.
 *
 * Presence is the switch: an action with no `cli` has no command line and needs
 * no pattern, which is what an MCP-only tool wants and could not say while
 * `pattern` was required of everything.
 *
 * Widened by whichever surface owns the key - `@doopx/remote` adds `http` -
 * so a protocol is declared where it is written without the core learning one.
 */
export interface Surfaces {
  cli?: { pattern: readonly string[]; stdin?: string };
  mcp?: boolean;
  docs?: boolean;
}

/** The TypeScript type a field's schema describes. */
export type ValueOf<S> =
  S extends { enum: readonly (infer E)[] } ? E
    : S extends { const: infer C } ? C
      : S extends { type: "string" } ? string
        : S extends { type: "integer" | "number" } ? number
          : S extends { type: "boolean" } ? boolean
            : S extends { type: "array"; items: infer Item } ? ValueOf<Item>[]
              : unknown;

/** Whether a field is always there: named in `required`, or carrying a default. */
type Always<I, R extends readonly string[], K extends keyof I> =
  K extends R[number] ? true : I[K] extends { default: unknown } ? true : false;

/**
 * The object a handler is given, typed from the schemas that declared it.
 *
 * What the schemas buy beyond validation: `input.breed` is the union its `enum`
 * named and `input.age` is a number that may be absent, without a cast and
 * without a second statement of the type for the compiler to disagree with.
 */
export type InputOf<I, R extends readonly string[]> =
  { [K in keyof I as Always<I, R, K> extends true ? K : never]: ValueOf<I[K]> }
  & { [K in keyof I as Always<I, R, K> extends true ? never : K]?: ValueOf<I[K]> };

/**
 * An action: one thing a program does, before any surface has spelled it.
 *
 * The input is declared once, as JSON Schema, and every surface is fed from it.
 * `registry.action` turns this into the `Command` the surfaces read, which is
 * where a pattern becomes positional slots and everything else becomes options.
 */
export interface ActionDefinition<
  Deps extends object = object,
  Needs extends readonly string[] = readonly string[],
  I extends Record<string, Field> = Record<string, Field>,
  R extends readonly string[] = readonly string[],
> {
  id: string;
  summary: string;
  description?: string;
  group?: string;
  input?: I;
  /** Field names that must be given. JSON Schema's own shape, and its place. */
  required?: R;
  surfaces: Surfaces;
  needs?: Needs;
  scopes?: readonly string[];
  refine?: StandardSchema;
  meta?: CommandMeta;
  examples?: readonly CommandExample[];
  hidden?: boolean;
  run(context: Deps & Omit<CommandContext, "input"> & { input: InputOf<I, R> }):
    | Output
    | void
    | Promise<Output | void>;
}

/** The parsed form of one pattern word. */
export type PatternToken =
  | { kind: "literal"; word: string }
  | { kind: "slot"; name: string; optional: boolean; variadic: boolean };

export interface CommandGroup {
  name: string;
  title: string;
  /**
   * Whether generated agent documentation lists the group at all.
   *
   * An agent does not rotate tokens or edit the configuration; printing those
   * to something that cannot usefully act on them is an invitation rather than
   * a reference. `--help` still shows everything - a person typing it asked.
   */
  agent?: boolean;
}

/** A titled run of commands, as help and the reference both lay them out. */
export interface CommandSection {
  /** The group's name, or undefined for the single section of an ungrouped program. */
  name: string | undefined;
  title: string;
  commands: readonly Command[];
}
