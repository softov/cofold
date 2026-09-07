import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ConfigurationError, type CommandContext, type OptionSpec } from "../index.js";

/**
 * softcli/config - finding the configuration, not parsing it.
 *
 * The boring resolution order everybody implements slightly differently and
 * slightly wrong: an explicit path over an environment variable over a project
 * file over the user's own, each layer *merging* rather than replacing, and
 * able to say which file a value came from. That last part is what makes a
 * support ticket answerable: "it is reading staging" is a guess until something
 * can print the file.
 *
 * Reading a file is not parsing one. `parse` is injected and defaults to JSON,
 * which every runtime already has, so this package stays at zero dependencies
 * and a program that wants YAML or TOML brings its own reader. That is the same
 * seam `softcli/remote` uses for a manifest: the shape is ours, the syntax is
 * somebody else's problem.
 */

/** Why a layer was consulted. The order they are applied in, and the order they win in. */
export type ConfigLayerKind = "base" | "user" | "project" | "environment" | "explicit";

export interface ConfigLayer {
  kind: ConfigLayerKind;
  /** The file it came from, or a bracketed word for the layer that is not a file. */
  path: string;
  values: Readonly<Record<string, unknown>>;
}

export interface ConfigOptions {
  /**
   * The program's name.
   *
   * The directory under the user's configuration home, the stem of the project
   * file, and the stem of the environment variable: `depot` looks in
   * `~/.config/depot/`, at `./.depot.json`, and at `$DEPOT_CONFIG`.
   */
  name: string;
  /**
   * How a file's text becomes data. JSON unless a program says otherwise.
   *
   * A parse failure should throw; the path is passed so the message can name
   * the file rather than the line alone.
   */
  parse?(text: string, path: string): Record<string, unknown>;
  /** Which extensions to look for, in order. A program that brings a parser widens this. */
  extensions?: readonly string[];
  /** Under everything found on disk: a program's own defaults, or a document's own block. */
  base?: Readonly<Record<string, unknown>>;
  /** An explicit file, usually what `--config` was given. Wins over everything, and must exist. */
  path?: string;
  /** Where the walk towards the root starts, looking for a project file. */
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  /** Injectable, so a test resolves a whole layer stack without touching a disk. */
  readFile?(path: string): string | undefined;
}

export interface ResolvedConfig {
  /** Every layer merged, later winning, leaf by leaf. */
  values: Readonly<Record<string, unknown>>;
  /** What contributed, in the order it was applied. */
  layers: readonly ConfigLayer[];
  /** A dotted path, as the value it resolved to. */
  get<T = unknown>(path: string): T | undefined;
  /** Which file last set a dotted path. What `doctor --json` puts in the ticket. */
  sourceOf(path: string): string | undefined;
}

/** The global a program declares so `--config` reaches the resolver. */
export const configGlobal: OptionSpec = {
  name: "--config",
  value: "PATH",
  description: "Read this configuration file instead of the ones found",
};

const DEFAULT_EXTENSIONS = [".json"] as const;

function readOrNothing(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT" || (error as { code?: string }).code === "EISDIR") {
      return undefined;
    }
    throw new ConfigurationError(`${path} could not be read: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

function parseJson(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new ConfigurationError(`${path} is not valid JSON: ${error instanceof Error ? error.message : "unknown"}`);
  }
  if (!isPlain(value)) throw new ConfigurationError(`${path} is not an object, so it is not a configuration file`);
  return value;
}

/** `depot` -> `DEPOT_CONFIG`. Anything a variable name cannot hold becomes an underscore. */
export function environmentNameOf(name: string): string {
  return `${name.replace(/[^A-Za-z0-9]/gu, "_").toUpperCase()}_CONFIG`;
}

/**
 * The configuration, and where every part of it came from.
 *
 * Layers are applied in the order they are declared below, each merging into
 * what is already there, so a project file states the two values it disagrees
 * with rather than restating the whole file.
 */
export function resolveConfig(options: ConfigOptions): ResolvedConfig {
  const read = options.readFile ?? readOrNothing;
  const parse = options.parse ?? parseJson;
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();

  const layers: ConfigLayer[] = [];
  const sources = new Map<string, string>();
  let values: Record<string, unknown> = {};

  const apply = (kind: ConfigLayerKind, path: string, held: Readonly<Record<string, unknown>>): void => {
    layers.push({ kind, path, values: held });
    values = mergeInto(values, held);
    record(held, "", sources, path);
  };

  /** A file that was looked for. Absent is an answer; unreadable is not. */
  const optional = (kind: ConfigLayerKind, path: string): boolean => {
    const text = read(path);
    if (text === undefined) return false;
    apply(kind, path, parse(text, path));
    return true;
  };

  /** A file that was named. Absent is a fault: somebody asked for this one. */
  const named = (kind: ConfigLayerKind, path: string): void => {
    const text = read(path);
    if (text === undefined) throw new ConfigurationError(`${path} was asked for and is not there`);
    apply(kind, path, parse(text, path));
  };

  if (options.base !== undefined) apply("base", "(defaults)", options.base);

  const userHome = env["XDG_CONFIG_HOME"] ?? join(home, ".config");
  for (const extension of extensions) {
    if (optional("user", join(userHome, options.name, `config${extension}`))) break;
  }

  const project = findUp(cwd, options.name, extensions, read);
  if (project !== undefined) optional("project", project);

  const fromEnvironment = env[environmentNameOf(options.name)];
  if (fromEnvironment !== undefined && fromEnvironment !== "") {
    named("environment", resolve(cwd, fromEnvironment));
  }

  if (options.path !== undefined && options.path !== "") {
    named("explicit", isAbsolute(options.path) ? options.path : resolve(cwd, options.path));
  }

  return {
    values,
    layers,
    get: <T,>(path: string): T | undefined => walk(values, path) as T | undefined,
    sourceOf: (path: string): string | undefined => sources.get(path),
  };
}

/**
 * The nearest `.<name><ext>` at or above the working directory.
 *
 * Upwards, the way a repository is found, because a command run three
 * directories into a project is still run inside that project.
 */
function findUp(
  from: string,
  name: string,
  extensions: readonly string[],
  read: (path: string) => string | undefined,
): string | undefined {
  let directory = resolve(from);
  for (;;) {
    for (const extension of extensions) {
      const candidate = join(directory, `.${name}${extension}`);
      if (read(candidate) !== undefined) return candidate;
    }
    const up = dirname(directory);
    if (up === directory) return undefined;
    directory = up;
  }
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Later wins, leaf by leaf.
 *
 * Objects merge and everything else replaces, arrays included: a list that
 * merged element by element is a list nobody can predict, and a project file
 * that wants to *add* to one can restate it.
 */
function mergeInto(
  base: Readonly<Record<string, unknown>>,
  over: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const existing = out[key];
    out[key] = isPlain(existing) && isPlain(value) ? mergeInto(existing, value) : value;
  }
  return out;
}

/** Every path a layer touched, so the last one to set it can be named later. */
function record(
  values: Readonly<Record<string, unknown>>,
  prefix: string,
  into: Map<string, string>,
  source: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    into.set(path, source);
    if (isPlain(value)) record(value, path, into, source);
  }
}

function walk(values: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = values;
  for (const segment of path.split(".")) {
    if (!isPlain(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export interface ConfigProviderOptions extends Omit<ConfigOptions, "path"> {
  /** The global option the explicit path is read from. `config`, for `--config`. */
  global?: string;
}

/**
 * The resolver as a capability, so a command declares `needs: ["config"]`.
 *
 * A provider rather than a function a handler calls, because the explicit path
 * arrives as a program-wide option and the whole point of `globals` is that a
 * capability reads them and a command does not: an MCP call has no `--config`,
 * and a handler that reached for one would be a handler that only works at a
 * terminal.
 */
export function configProvider(options: ConfigProviderOptions = { name: "app" }): {
  description: string;
  resolve(deps: object, context: CommandContext): ResolvedConfig;
} {
  const global = options.global ?? "config";
  return {
    description: `Configuration for ${options.name}`,
    resolve: (_deps, context): ResolvedConfig => {
      const given = context.globals[global];
      return resolveConfig({
        ...options,
        ...(typeof given === "string" && given !== "" ? { path: given } : {}),
      });
    },
  };
}
