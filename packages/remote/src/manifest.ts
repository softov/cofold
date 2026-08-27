import {
  compact,
  fieldNameOf,
  isFlag,
  optionsOf,
  parsePattern,
  surfaceEnabled,
  type Command,
  type CommandGroup,
  type OptionSpec,
  type Runner,
} from "@softcli/core";
import { boundsOf, coercerFor, typeOf } from "./shape.js";

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

export interface ManifestOption {
  name: string;
  short?: string;
  value?: string;
  description: string;
  type?: "string" | "integer" | "number" | "boolean";
  enum?: readonly string[];
  /** Bounds, so a remote command refuses `--age -3` as fast as a local one. */
  minimum?: number;
  maximum?: number;
  repeatable?: boolean;
  required?: boolean;
  env?: string;
  field?: string;
}

/** How one command becomes one request. Ordinary REST, described. */
export interface HttpBinding {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** `/cases/{id}` - each `{name}` is filled from the canonical input. */
  path: string;
  /** Canonical field names sent as the query string. */
  query?: readonly string[];
  /** Canonical field names sent as a JSON body. `"*"` sends everything left. */
  body?: readonly string[];
}

export interface ManifestCommand {
  id: string;
  pattern: readonly string[];
  summary: string;
  description?: string;
  group?: string;
  arguments?: Record<string, {
    description?: string;
    type?: string;
    enum?: readonly string[];
    minimum?: number;
    maximum?: number;
  }>;
  options?: readonly ManifestOption[];
  http: HttpBinding;
}

export interface Manifest {
  softcli: number;
  program: { name: string; version: string; description?: string };
  groups?: readonly CommandGroup[];
  commands: readonly ManifestCommand[];
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
export function describe(
  kernel: Runner,
  program: { name: string; version: string; description?: string },
): Manifest {
  const commands: ManifestCommand[] = [];
  for (const command of kernel.commands) {
    const http = command.meta?.["http"] as HttpBinding | undefined;
    if (http === undefined || !surfaceEnabled(command, "docs")) continue;
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
            type: typeOf(spec.coerce?.jsonSchema),
            ...boundsOf(spec.coerce?.jsonSchema),
            ...compact({ description: spec.description, enum: spec.coerce?.candidates }),
          }])),
      }),
    });
  }
  return {
    softcli: MANIFEST_VERSION,
    program,
    commands,
    ...compact({ groups: kernel.groups.length === 0 ? undefined : kernel.groups }),
  };
}

function describeOption(option: OptionSpec): ManifestOption {
  return {
    name: option.name,
    description: option.description,
    type: isFlag(option) ? "boolean" : typeOf(option.coerce?.jsonSchema),
    field: fieldNameOf(option),
    ...boundsOf(option.coerce?.jsonSchema),
    ...compact({
      short: option.short,
      value: option.value,
      enum: option.coerce?.candidates,
      repeatable: option.repeatable === true ? true : undefined,
      required: option.required === true ? true : undefined,
      env: option.env,
    }),
  };
}

export function parseManifest(value: unknown): Manifest {
  if (typeof value !== "object" || value === null) throw new ManifestError("The manifest is not an object");
  const manifest = value as Manifest;
  if (typeof manifest.softcli !== "number") throw new ManifestError("The manifest has no version");
  if (manifest.softcli > MANIFEST_VERSION) {
    throw new ManifestError(
      `This manifest is version ${manifest.softcli} and this client understands ${MANIFEST_VERSION}. Upgrade the client.`,
    );
  }
  if (!Array.isArray(manifest.commands)) throw new ManifestError("The manifest lists no commands");
  return manifest;
}

/** What a materialised command calls. Supplied by a capability, never imported. */
export interface Transport {
  request(binding: HttpBinding, input: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface MaterialiseOptions {
  /** The capability name a materialised command declares it needs. */
  capability?: string;
  /** Prefixed to every pattern, when a client namespaces a remote surface. */
  prefix?: readonly string[];
  /** Which commands become MCP tools. Off by default, as everywhere else. */
  expose?(command: ManifestCommand): boolean;
}

/**
 * The client's half: turn a manifest into commands.
 *
 * The handler is the same three lines for every command, because the only thing
 * that varies is the binding - which is data. What the local program supplies is
 * the transport, as a capability: that is where the base URL, the credentials
 * and the retry policy live, and none of them is the server's to dictate.
 */
export function materialise(manifest: Manifest, options: MaterialiseOptions = {}): Command[] {
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
        field: option.field,
        coerce: coercerFor(option),
      }),
    }));

    const argumentSpecs = Object.fromEntries(
      Object.entries(descriptor.arguments ?? {}).map(([name, spec]) =>
        [name, compact({ description: spec.description, coerce: coercerFor(spec) })]));

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
export function bodyFields(binding: HttpBinding, input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const inPath = [...binding.path.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]!);
  const declared = binding.body ?? [];
  const explicit = declared.filter((name) => name !== "*");
  const rest = declared.includes("*");
  const entries = Object.entries(input).filter(([name, value]) =>
    value !== undefined
    && !inPath.includes(name)
    && !(binding.query ?? []).includes(name)
    && (explicit.includes(name) || rest));
  return Object.fromEntries(entries);
}

export function expandPath(binding: HttpBinding, input: Readonly<Record<string, unknown>>): string {
  return binding.path.replaceAll(/\{([^}]+)\}/gu, (_match, name: string) => {
    const value = input[name];
    if (value === undefined) throw new Error(`${binding.path} needs ${name}`);
    return encodeURIComponent(String(value));
  });
}

export { parsePattern };
