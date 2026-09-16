export interface FilesOptions {
  /** Lines `read_file` returns when `limit` is absent; default 2000. */
  maxLines?: number;
  /** Rows `search_files` returns when `limit` is absent; default 200. */
  maxMatches?: number;
}

export interface ReadFileInput {
  path: string;
  /** First line to return, 1-based; default 1. */
  offset?: number;
  /** Lines to return; default `FilesOptions.maxLines`. */
  limit?: number;
}

export interface WriteFileInput {
  path: string;
  content: string;
}

export interface EditFileInput {
  path: string;
  /** Must occur exactly once in the file, unless `all`. */
  old: string;
  new: string;
  /** Replace every occurrence. */
  all?: boolean;
}

export interface ListFilesInput {
  /** A glob, `**` included; `node_modules` and `.git` are skipped unless the pattern names them. */
  pattern: string;
  /** Where the pattern is applied; default the workspace. */
  cwd?: string;
}

export interface SearchFilesInput {
  /** A JavaScript regular expression, tested per line. */
  pattern: string;
  /** File or directory to search; default the workspace. */
  path?: string;
  /** Which files under `path`; default every file. */
  glob?: string;
  ignoreCase?: boolean;
  /** Rows to return; default `FilesOptions.maxMatches`. */
  limit?: number;
}

/** What `resolveWithin` says about a path. */
export interface ResolvedPath {
  /** Absolute and normalized. */
  absolute: string;
  /** The workspace itself, or under it. */
  inside: boolean;
}
