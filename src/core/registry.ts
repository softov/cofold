import {
  literalPrefix,
  parsePattern,
  type ActionDefinition,
  type Field,
  commandFor,
  type Command,
  type CommandDefinition,
  type Surface,
} from "./command.js";
import { assertSupported } from "./coerce.js";
import { compact } from "./compact.js";
import {
  BaseContext,
  RESERVED_CONTEXT_KEYS,
  silentIo,
  type CommandContext,
  type Io,
  type Output,
  type RequestContext,
} from "./context.js";
import { ArgumentError, AuthorizationError, FacioError } from "./errors.js";

/**
 * Capabilities, and the registry that resolves them.
 *
 * This is the generalisation of the `needs: "nothing" | "config" | "server"`
 * that every hand-written CLI grows. There, the list is closed and the
 * resolution is an `if` ladder in the runner; here a capability is registered
 * with the thing that produces it, capabilities may depend on each other, and
 * what a command declares it needs is what its handler is typed to have.
 *
 * The property that matters: a handler is entered only once everything it
 * declared has already been resolved. So a command that needs a server fails on
 * a missing configuration *before* it starts, rather than halfway through its
 * own work, and a handler is short enough to read because none of that is in it.
 */

export interface ProviderDefinition<Deps extends object, Value> {
  /** Shown by `doctor`-style commands that report what an installation resolves. */
  description?: string;
  deps?: readonly string[];
  /** Refused before the resolve runs, when the registry knows the caller's scopes. */
  scopes?: readonly string[];
  resolve(deps: Deps, context: CommandContext): Value | Promise<Value>;
  /** Run in reverse resolution order after the handler, whether it threw or not. */
  dispose?(value: Value): void | Promise<void>;
}

interface StoredProvider {
  name: string;
  description: string | undefined;
  deps: readonly string[];
  scopes: readonly string[];
  resolve(deps: Record<string, unknown>, context: CommandContext): unknown;
  dispose?(value: unknown): void | Promise<void>;
}

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

/**
 * Commands under their declared groups, empty groups dropped.
 *
 * A program with no groups is one section called Commands rather than a special
 * case at each call site - which is what it had been in both of them, spelled
 * differently.
 */
export function sectionsOf(
  groups: readonly CommandGroup[],
  commands: readonly Command[],
): CommandSection[] {
  if (groups.length === 0) {
    return commands.length === 0 ? [] : [{ name: undefined, title: "Commands", commands }];
  }
  return groups
    .map((group) => ({
      name: group.name,
      title: group.title,
      commands: commands.filter((command) => command.group === group.name),
    }))
    .filter((section) => section.commands.length > 0);
}

export interface AuthorizeRequest {
  command: Command;
  context: CommandContext;
  /** @deprecated Authorization runs before resolution; this object is always empty. Use context.request. */
  capabilities: Readonly<Record<string, unknown>>;
  /** Everything the command or its capabilities asked for. */
  scopes: readonly string[];
}

export interface RegistryOptions {
  /**
   * The declared sections of the surface.
   *
   * Given, `group` becomes mandatory and is checked at registration: a command
   * added without one would otherwise be quietly absent from generated docs,
   * which is the failure nobody notices until an agent cannot find the command.
   */
  groups?: readonly CommandGroup[];
  authorize?(request: AuthorizeRequest): void | Promise<void>;
}

export interface ExecuteOptions {
  surface: Surface;
  input: Record<string, unknown>;
  /** Program-wide options, for the capability providers that read them. */
  globals?: Record<string, unknown>;
  io?: Io;
  signal?: AbortSignal;
  request?: Readonly<RequestContext>;
  /** Observe disposal failures after a successful handler without inviting mutation retries. */
  onCleanupError?: (error: unknown) => void;
  readStdin?: () => Promise<string>;
}

export interface Resolution {
  capabilities: Record<string, unknown>;
  dispose(): Promise<void>;
}

export class Registry<Ctx extends object = object> {
  readonly #providers = new Map<string, StoredProvider>();
  readonly #commands: Command[] = [];
  readonly #options: RegistryOptions;

  public constructor(options: RegistryOptions = {}) {
    this.#options = options;
  }

  /** Register a capability. Returns the same registry, typed with what it now has. */
  public provide<Name extends string, Value, const Deps extends readonly (keyof Ctx & string)[] = []>(
    name: Name,
    definition: {
      description?: string;
      deps?: Deps;
      scopes?: readonly string[];
      resolve(deps: Pick<Ctx, Deps[number]>, context: CommandContext): Value | Promise<Value>;
      dispose?(value: Awaited<Value>): void | Promise<void>;
    },
  ): Registry<Ctx & { [Key in Name]: Awaited<Value> }> {
    if (RESERVED_CONTEXT_KEYS.includes(name)) {
      throw new Error(`A capability cannot be called ${name}: the context already has it`);
    }
    if (this.#providers.has(name)) {
      throw new Error(`Two capabilities are registered as ${name}`);
    }
    const stored: StoredProvider = {
      name,
      description: definition.description,
      deps: definition.deps ?? [],
      scopes: definition.scopes ?? [],
      resolve: (deps, context) => definition.resolve(deps as Pick<Ctx, Deps[number]>, context),
      ...(definition.dispose === undefined
        ? {}
        : { dispose: (value: unknown) => definition.dispose!(value as Awaited<Value>) }),
    };
    this.#providers.set(name, stored);
    return this as unknown as Registry<Ctx & { [Key in Name]: Awaited<Value> }>;
  }

  /**
   * Declare a command against this registry.
   *
   * An identity function that exists for its types: `needs` is checked against
   * the capabilities registered above it, and the handler's context is typed to
   * exactly those. Asking for `ctx.database` in a command that declared
   * `["config"]` is a compile error rather than an undefined at three in the
   * morning.
   */
  public command<const Needs extends readonly (keyof Ctx & string)[] = []>(
    definition: CommandDefinition<Pick<Ctx, Needs[number]>, Needs>,
  ): Command {
    return definition as unknown as Command;
  }

  /**
   * Declare one action, and register it.
   *
   * The authored form, and the one to reach for: the input is stated once and
   * `commandFor` spells it for each surface. `command` is the derived form
   * underneath, kept for the places that build one by hand - a manifest arriving
   * from a service, the help and version commands a program adds to itself.
   */
  public action<
    const Needs extends readonly (keyof Ctx & string)[] = [],
    const I extends Record<string, Field> = Record<string, never>,
    const R extends readonly (keyof I & string)[] = [],
  >(
    definition: ActionDefinition<Pick<Ctx, Needs[number]>, Needs, I, R>,
  ): Command {
    const made = commandFor(definition as unknown as ActionDefinition<never, never, Record<string, Field>, readonly string[]>);
    this.register(made);
    return made;
  }

  public register(...commands: readonly Command[]): this {
    for (const command of commands) {
      if (this.#commands.some((existing) => existing.id === command.id)) {
        throw new Error(`Two commands are registered as ${command.id}`);
      }
      validateCommand(command, this.#options.groups);
      this.#commands.push(command);
    }
    return this;
  }

  public get commands(): readonly Command[] {
    return this.#commands;
  }

  public get groups(): readonly CommandGroup[] {
    return this.#options.groups ?? [];
  }

  public get providers(): readonly { name: string; description: string | undefined; deps: readonly string[] }[] {
    return [...this.#providers.values()].map(({ name, description, deps }) => ({ name, description, deps }));
  }

  public find(id: string): Command | undefined {
    return this.#commands.find((command) => command.id === id);
  }

  /**
   * Everything checkable about the registry, checked at once.
   *
   * Called by a program at startup rather than per command, so a typo in a
   * capability name is a crash on the first run of the binary and not a
   * surprise on the one command nobody tested.
   */
  public verify(): void {
    for (const command of this.#commands) {
      for (const need of command.needs ?? []) {
        if (!this.#providers.has(need)) {
          throw new Error(`${command.id} needs the capability ${need}, which is not registered`);
        }
      }
    }
    for (const provider of this.#providers.values()) {
      for (const dep of provider.deps) {
        if (!this.#providers.has(dep)) {
          throw new Error(`The capability ${provider.name} depends on ${dep}, which is not registered`);
        }
      }
    }
    for (const provider of this.#providers.values()) this.#order(provider.name, []);
  }

  /** Depth-first, so a cycle is named by the path that closed it. */
  #order(name: string, seen: readonly string[]): string[] {
    if (seen.includes(name)) {
      throw new Error(`The capabilities ${[...seen, name].join(" -> ")} depend on each other`);
    }
    const provider = this.#providers.get(name);
    if (provider === undefined) throw new Error(`The capability ${name} is not registered`);
    const ordered: string[] = [];
    for (const dep of provider.deps) {
      for (const one of this.#order(dep, [...seen, name])) {
        if (!ordered.includes(one)) ordered.push(one);
      }
    }
    if (!ordered.includes(name)) ordered.push(name);
    return ordered;
  }

  /** Includes scopes on every transitive capability, without resolving any. */
  public scopesFor(command: Command): readonly string[] {
    const scopes = new Set(command.scopes ?? []);
    for (const need of command.needs ?? []) {
      for (const name of this.#order(need, [])) {
        for (const scope of this.#providers.get(name)!.scopes) scopes.add(scope);
      }
    }
    return [...scopes];
  }

  public async resolveNeeds(command: Command, context: CommandContext): Promise<Resolution> {
    const wanted: string[] = [];
    for (const need of command.needs ?? []) {
      for (const one of this.#order(need, [])) if (!wanted.includes(one)) wanted.push(one);
    }

    const capabilities: Record<string, unknown> = {};
    const opened: StoredProvider[] = [];
    const dispose = async (): Promise<void> => {
      const errors: unknown[] = [];
      for (const provider of [...opened].reverse()) {
        try { await provider.dispose?.(capabilities[provider.name]); } catch (error: unknown) { errors.push(error); }
      }
      if (errors.length > 0) throw new AggregateError(errors, "Capability disposal failed");
    };

    try {
      for (const name of wanted) {
        context.signal?.throwIfAborted();
        const provider = this.#providers.get(name)!;
        const deps: Record<string, unknown> = {};
        for (const dep of provider.deps) deps[dep] = capabilities[dep];
        capabilities[name] = await provider.resolve(deps, context);
        opened.push(provider);
      }
    } catch (error: unknown) {
      await dispose();
      throw error;
    }

    return { capabilities, dispose };
  }

  /**
   * Run a command, on whichever surface asked.
   *
   * Shared rather than written once per surface, because everything here is
   * true of a command no matter who invoked it: authorise, resolve, run,
   * dispose. The CLI adds argv and printing on top of this; the MCP adapter
   * adds a JSON envelope. Neither adds semantics.
   */
  public async execute(command: Command, options: ExecuteOptions): Promise<Output | null> {
    const context = new BaseContext({
      command,
      commands: this.#commands,
      surface: options.surface,
      input: options.input,
      io: options.io ?? silentIo,
      ...compact({
        globals: options.globals,
        signal: options.signal,
        request: options.request,
        readStdin: options.readStdin,
      }),
    });

    options.signal?.throwIfAborted();
    const scopes = this.scopesFor(command);
    if (this.#options.authorize !== undefined) {
      await this.#options.authorize({ command, context, capabilities: {}, scopes });
    } else if (scopes.length > 0) {
      throw new AuthorizationError(
        `${command.id} requires ${scopes.join(", ")}, and nothing in this program checks scopes`, scopes,
      );
    }
    options.signal?.throwIfAborted();
    const { capabilities, dispose } = await this.resolveNeeds(command, context);
    let succeeded = false;
    try {
      options.signal?.throwIfAborted();
      const answer = await command.run(withCapabilities(context, capabilities));
      succeeded = true;
      return answer ?? context.collected;
    } finally {
      try { await dispose(); } catch (error: unknown) {
        if (succeeded && options.onCleanupError !== undefined) options.onCleanupError(error);
        else throw error;
      }
    }
  }
}

/**
 * What a surface needs from a registry, and nothing more.
 *
 * The CLI, the MCP adapter and the reference generator all take one of these
 * rather than `Registry<Ctx>`: the capability types are the *command author's*
 * business, and a surface that was generic over them would force every program
 * to thread its context type through code that never touches it.
 */
export interface Runner {
  readonly commands: readonly Command[];
  readonly groups: readonly CommandGroup[];
  verify(): void;
  find(id: string): Command | undefined;
  execute(command: Command, options: ExecuteOptions): Promise<Output | null>;
  scopesFor?(command: Command): readonly string[];
}

export function createRegistry(options: RegistryOptions = {}): Registry<object> {
  return new Registry<object>(options);
}

/**
 * The context a handler sees: its own, plus what it asked for.
 *
 * A proxy rather than a merged object, because the context is a class with
 * private state - copying its properties would leave the methods reading fields
 * that are no longer there. Functions come back bound to the real instance for
 * the same reason.
 */
function withCapabilities(context: BaseContext, capabilities: Record<string, unknown>): CommandContext {
  return new Proxy(context, {
    get(target, property, receiver) {
      if (typeof property === "string" && property in capabilities) return capabilities[property];
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    has(target, property) {
      return (typeof property === "string" && property in capabilities) || Reflect.has(target, property);
    },
  }) as unknown as CommandContext;
}

/** Everything about one command that can be wrong before anybody types it. */
export function validateCommand(command: Command, groups?: readonly CommandGroup[]): void {
  if (command.pattern.length === 0) {
    throw new Error(`${command.id} has an empty pattern`);
  }
  if (literalPrefix(command).length === 0) {
    throw new Error(`${command.id} starts with a slot: a command has to begin with a word`);
  }
  const tokens = parsePattern(command.pattern);
  let loose = false;
  for (const token of tokens) {
    if (token.kind !== "slot") continue;
    if (loose) throw new Error(`${command.id} has a required slot after an optional or variadic one`);
    if (token.optional || token.variadic) loose = true;
    if (token.variadic && token !== tokens[tokens.length - 1]) {
      throw new Error(`${command.id} has a variadic slot that is not last`);
    }
  }
  for (const [name, spec] of Object.entries(command.arguments ?? {})) {
    if (spec.coerce !== undefined) assertSupported(spec.coerce.schema, `${command.id} :${name}`);
  }
  const names = new Set<string>();
  for (const option of command.options ?? []) {
    if (option.coerce !== undefined) assertSupported(option.coerce.schema, `${command.id} ${option.name}`);
    if (!option.name.startsWith("--")) {
      throw new Error(`${command.id} declares ${option.name}, which is not a long option`);
    }
    if (names.has(option.name)) throw new Error(`${command.id} declares ${option.name} twice`);
    names.add(option.name);
    if (option.short !== undefined && !/^-[A-Za-z0-9]$/u.test(option.short)) {
      throw new Error(`${command.id} declares ${option.short}, which is not a short option`);
    }
  }
  if (groups !== undefined && groups.length > 0) {
    if (command.group === undefined) {
      throw new Error(`${command.id} has no group, and this program renders its surface by group`);
    }
    if (!groups.some((group) => group.name === command.group)) {
      throw new Error(`${command.id} is in the group ${command.group}, which is not declared`);
    }
  }
}

export { ArgumentError, FacioError };
