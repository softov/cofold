import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { ConfigurationError } from "softcli";
import { parseYaml } from "./yaml.js";

/**
 * A document from disk: read it, compose it, and load what it says about the environment.
 *
 * Everything filesystem-shaped lives here so `document.ts` takes data and
 * nothing else - which is what makes the reader testable without a temporary
 * directory, and what makes the YAML parser replaceable in one place.
 */

/** A file a document names: a path, or a path that may not be there. */
export type FileEntry = string | { path: string; optional?: boolean };

export interface LoadOptions {
  /** Injectable, so a test composes documents without touching a disk. */
  readFile?(path: string): string;
  /** The environment the loaded files are layered onto. */
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface LoadedDocument {
  /** The composed document: every import merged in, with `imports` and `env` resolved away. */
  document: Record<string, unknown>;
  /** Where a relative `exec` command is taken from: the root document's own directory. */
  directory: string;
  environment: Record<string, string | undefined>;
  /** Every document file that was read, in the order they were applied. */
  files: string[];
  envFiles: string[];
}

export function loadDocument(path: string, options: LoadOptions = {}): LoadedDocument {
  const read = options.readFile ?? ((one: string) => readFileSync(one, "utf8"));
  const root = isAbsolute(path) ? path : resolve(process.cwd(), path);

  const files: string[] = [];
  const envFiles: { path: string; optional: boolean }[] = [];
  const document = compose(root, read, files, envFiles, []);

  const environment: Record<string, string | undefined> = { ...(options.environment ?? process.env) };
  for (const file of envFiles) {
    const text = readOptional(file.path, file.optional, read);
    if (text === undefined) continue;
    Object.assign(environment, parseEnvFile(text, file.path));
  }

  delete document["imports"];
  delete document["env"];

  return { document, directory: dirname(root), environment, files, envFiles: envFiles.map((one) => one.path) };
}

/**
 * One document with its imports folded in.
 *
 * Later wins, and the importing document is last: a file that imports another
 * is stating what it wants *instead*, and having to reorder the list to say so
 * would be a rule nobody remembers.
 */
function compose(
  path: string,
  read: (path: string) => string,
  files: string[],
  envFiles: { path: string; optional: boolean }[],
  seen: readonly string[],
): Record<string, unknown> {
  if (seen.includes(path)) {
    throw new ConfigurationError(`${[...seen, path].join(" -> ")} import each other`);
  }

  const own = parseDocument(read(path), path);
  const directory = dirname(path);
  let merged: Record<string, unknown> = {};

  for (const entry of entriesOf(own["imports"], `${path}: imports`)) {
    const imported = resolve(directory, entry.path);
    const text = readOptional(imported, entry.optional, read);
    if (text === undefined) continue;
    merged = merge(merged, compose(imported, read, files, envFiles, [...seen, path]));
  }

  for (const entry of entriesOf(own["env"], `${path}: env`)) {
    envFiles.push({ path: resolve(directory, entry.path), optional: entry.optional });
  }

  files.push(path);
  return merge(merged, own);
}

function readOptional(
  path: string,
  optional: boolean,
  read: (path: string) => string,
): string | undefined {
  try {
    return read(path);
  } catch (error: unknown) {
    if (optional && (error as { code?: string }).code === "ENOENT") return undefined;
    throw new ConfigurationError(`${path} could not be read: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

/** `.json` is JSON, anything else is the YAML subset. The two produce the same data. */
export function parseDocument(text: string, path: string): Record<string, unknown> {
  const value = path.endsWith(".json") ? JSON.parse(text) as unknown : parseYaml(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigurationError(`${path} is not a mapping, so it is not a command document`);
  }
  return value as Record<string, unknown>;
}

function entriesOf(raw: unknown, where: string): { path: string; optional: boolean }[] {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((one, at) => {
    if (typeof one === "string") return { path: one, optional: false };
    if (typeof one !== "object" || one === null || Array.isArray(one)) {
      throw new ConfigurationError(`${where}[${at}] is a path, or a mapping of path and optional`);
    }
    const held = one as Record<string, unknown>;
    for (const key of Object.keys(held)) {
      if (key !== "path" && key !== "optional") throw new ConfigurationError(`${where}[${at}] has no ${key}`);
    }
    if (typeof held["path"] !== "string") throw new ConfigurationError(`${where}[${at}] needs a path`);
    if (held["optional"] !== undefined && typeof held["optional"] !== "boolean") {
      throw new ConfigurationError(`${where}[${at}]: optional is true or false`);
    }
    return { path: held["path"], optional: held["optional"] === true };
  });
}

/**
 * Two documents, later winning.
 *
 * `config` is merged leaf by leaf, because that is what a shared file of
 * defaults is for. A command is replaced whole: half of one document's command
 * and half of another's is a command nobody wrote.
 */
function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (key === "imports" || key === "env") continue;
    out[key] = key === "config" || key === "commands"
      ? mergeMaps(base[key], value, key === "config")
      : value;
  }
  return out;
}

function mergeMaps(base: unknown, over: unknown, deep: boolean): unknown {
  if (!isPlain(base) || !isPlain(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = deep ? mergeMaps(base[key], value, true) : value;
  }
  return out;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A `KEY=VALUE` file.
 *
 * The small, boring subset: comments, blank lines, an optional `export`, and
 * quotes where a value has spaces. Nothing is expanded, because a value that
 * refers to another value is a shell feature and this is not a shell.
 */
export function parseEnvFile(text: string, path = "the environment file"): Record<string, string> {
  const values: Record<string, string> = {};

  text.split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;

    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const at = body.indexOf("=");
    if (at <= 0) throw new ConfigurationError(`${path} line ${index + 1} is not KEY=VALUE`);

    const name = body.slice(0, at).trim();
    const rest = body.slice(at + 1).trim();
    values[name] = rest.startsWith('"') && rest.endsWith('"') && rest.length > 1
      ? rest.slice(1, -1).replaceAll("\\n", "\n").replaceAll('\\"', '"')
      : rest.startsWith("'") && rest.endsWith("'") && rest.length > 1
        ? rest.slice(1, -1)
        : rest.replace(/\s+#.*$/u, "").trim();
  });

  return values;
}
