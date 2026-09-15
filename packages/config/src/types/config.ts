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

export interface ConfigProviderOptions extends Omit<ConfigOptions, "path"> {
  /** The global option the explicit path is read from. `config`, for `--config`. */
  global?: string;
}
