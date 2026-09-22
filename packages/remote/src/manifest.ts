import type {
  CommandsFromOptions,
  HttpBinding,
  ManifestCommand,
  ManifestOption,
  ProgramManifest,
  Transport,
} from "./types/manifest.js";
import {
  compact,
  fieldNameOf,
  isFlag,
  optionsOf,
  parsePattern,
  surfaceEnabled,
  type Command,
  type CommandGroup,
  type JsonSchema,
  type OptionSpec,
  type Runner,
} from "@doopx/commands";

/**
 * A command, over the wire.
 *
 * If a command is data, a command can arrive from somewhere else - which is the
 * property nothing built on Commander can have. A server describes its own
 * surface once, and every client that speaks this manifest grows those commands
 * with working help, completion and `--json`, without anybody shipping a new
 * binary.
 *
 * The version is first and is checked before anything else is read. A client
 * that meets a manifest from the future must refuse it rather than guess: half
 * a command surface is worse than none.
 */

export const MANIFEST_VERSION = 1;

/** How one command becomes one request. Ordinary REST, described. */
declare module "@doopx/commands" {
  /**
   * HTTP as a surface an action declares, on the same footing as `cli` and
   * `mcp`. The key is owned here, so the core carries a binding it never reads.
   */
  interface Surfaces {
    http?: HttpBinding;
  }

  interface CommandMeta {
    /** How this command becomes one request. Read by `@doopx/remote` alone. */
    http?: HttpBinding;
    /** The program a command was built from, on the commands `commandsFrom` returns. */
    remote?: string;
  }
}

export class ManifestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * The server's half: describe what is registered.
 *
 * The HTTP binding is read from `command.meta.http`, so a command carries the
 * one extra fact a remote caller needs and the core stays ignorant of HTTP.
 * Commands without a binding are simply not published - a local `doctor`
 * command is nobody else's business.
 */
export function manifestFrom(
  registry: Runner,
  program: { name: string; version: string; description?: string },
): ProgramManifest {
  const commands: ManifestCommand[] = [];
  for (const command of registry.commands) {
    const http = command.meta?.http;
    if (http === undefined || !surfaceEnabled(command, "remote")) continue;
    commands.push({
      id: command.id,
      pattern: [...command.pattern],
      summary: command.summary,
      options: optionsOf(command).map(describeOption),
      http,
      ...compact({
        description: command.description,
        group: command.group,
        arguments: command.arguments === undefined
          ? undefined
          : Object.fromEntries(Object.entries(command.arguments).map(([name, spec]) => [name, {
            schema: spec.coerce?.schema ?? { type: "string" },
            ...compact({ description: spec.description }),
          }])),
      }),
    });
  }
  return {
    facio: MANIFEST_VERSION,
    program,
    commands,
    ...compact({ groups: registry.groups.length === 0 ? undefined : registry.groups }),
  };
}

function describeOption(option: OptionSpec): ManifestOption {
  return {
    name: option.name,
    description: option.description,
    schema: isFlag(option) ? { type: "boolean" } : option.coerce?.schema ?? { type: "string" },
    field: fieldNameOf(option),
    ...compact({
      short: option.short,
      value: option.value,
      repeatable: option.repeatable === true ? true : undefined,
      required: option.required === true ? true : undefined,
      env: option.env,
    }),
  };
}

export function parseManifest(value: unknown): ProgramManifest {
  if (typeof value !== "object" || value === null) throw new ManifestError("The manifest is not an object");
  const manifest = value as ProgramManifest;
  if (typeof manifest.facio !== "number") throw new ManifestError("The manifest has no version");
  if (manifest.facio > MANIFEST_VERSION) {
    throw new ManifestError(
      `This manifest is version ${manifest.facio} and this client understands ${MANIFEST_VERSION}. Upgrade the client.`,
    );
  }
  if (!Array.isArray(manifest.commands)) throw new ManifestError("The manifest lists no commands");
  return manifest;
}

/**
 * The client's half: turn a manifest into commands.
 *
 * The handler is the same three lines for every command, because the only thing
 * that varies is the binding - which is data. What the local program supplies is
 * the transport, as a capability: that is where the base URL, the credentials
 * and the retry policy live, and none of them is the server's to dictate.
 */
export function commandsFrom(manifest: ProgramManifest, options: CommandsFromOptions = {}): Command[] {
  const capability = options.capability ?? "transport";
  const prefix = options.prefix ?? [];

  return manifest.commands.map((descriptor): Command => {
    const optionSpecs: OptionSpec[] = (descriptor.options ?? []).map((option) => ({
      name: option.name,
      description: option.description,
      ...compact({
        short: option.short,
        value: option.value,
        repeatable: option.repeatable === true ? true : undefined,
        required: option.required === true ? true : undefined,
        env: option.env,
        default: option.schema.default,
        field: option.field,
        coerce: { schema: option.schema },
      }),
    }));

    const argumentSpecs = Object.fromEntries(
      Object.entries(descriptor.arguments ?? {}).map(([name, spec]) =>
        [name, compact({ description: spec.description, coerce: { schema: spec.schema } })]));

    return {
      id: descriptor.id,
      pattern: [...prefix, ...descriptor.pattern],
      summary: descriptor.summary,
      options: optionSpecs,
      needs: [capability],
      meta: { http: descriptor.http, remote: manifest.program.name },
      surfaces: { mcp: options.expose?.(descriptor) ?? false },
      ...compact({
        description: descriptor.description,
        group: descriptor.group,
        arguments: Object.keys(argumentSpecs).length === 0 ? undefined : argumentSpecs,
      }),
      run: async (context) => {
        const transport = (context as unknown as Record<string, Transport>)[capability]!;
        return { data: await transport.request(descriptor.http, context.input) };
      },
    };
  });
}

/** The fields a binding does not place in the path or the query. */
/**
 * Which canonical fields travel where, when the binding does not say.
 *
 * The declaration already names every option, so a binding that listed them
 * again was a second list to keep in step - and nothing checked that a name in
 * it was an option at all. So the split is derived: the path takes what it
 * names, and of what is left a method without a body sends it as query and a
 * method with one sends it as body. `query` and `body` remain for the requests
 * that are not shaped like that.
 *
 * One function, because the client builds the request from this answer and the
 * manifest is described from it - two readings that must not differ.
 */
export function placementOf(
  binding: HttpBinding,
  names: readonly string[],
): { query: readonly string[]; body: readonly string[] } {
  const inPath = [...binding.path.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]!);
  const left = names.filter((name) => !inPath.includes(name));
  const carries = binding.method !== "GET" && binding.method !== "DELETE";

  const query = binding.query ?? (carries ? [] : left);
  const explicit = (binding.body ?? []).filter((name) => name !== "*");
  const rest = binding.body === undefined ? carries : binding.body.includes("*");
  const body = carries
    ? left.filter((name) => !query.includes(name) && (rest || explicit.includes(name)))
    : [];
  return { query, body };
}

export function bodyFields(binding: HttpBinding, input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { body } = placementOf(binding, Object.keys(input));
  return Object.fromEntries(
    Object.entries(input).filter(([name, value]) => value !== undefined && body.includes(name)),
  );
}

export function expandPath(binding: HttpBinding, input: Readonly<Record<string, unknown>>): string {
  return binding.path.replaceAll(/\{([^}]+)\}/gu, (_match, name: string) => {
    const value = input[name];
    if (value === undefined) throw new Error(`${binding.path} needs ${name}`);
    return encodeURIComponent(String(value));
  });
}

export { parsePattern };
