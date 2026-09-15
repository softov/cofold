import type { Command, Surface } from "./command.js";
import type { CommandContext, Io, Output, RequestContext } from "./context.js";

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
