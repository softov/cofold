import { glob, mkdir, open, readFile, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { BigIntStats, Dirent } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Capability, Tool } from '@cofold/agents';
import { createTool } from '@cofold/agents';
import type { EditFileInput, FilesOptions, ListFilesInput, ReadFileInput, ResolvedPath, SearchFilesInput, WriteFileInput } from './types/files.js';
import { displayPath, resolveWithin } from './paths.js';

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_MATCHES = 200;
/** Characters kept of one line, in `read_file` and in a `search_files` row. */
const MAX_LINE = 2000;
const MAX_ROW = 200;
/** Files `search_files` does not open. */
const MAX_SEARCHED_BYTES = 2 * 1024 * 1024;
/** Entries `list_files` returns before it stops. */
const MAX_ENTRIES = 1000;
const SKIPPED = new Set(['node_modules', '.git']);

/**
 * What each session last saw of a file, by session id and then real path: the `mtime` in nanoseconds and the size
 * that `read_file`, or the session's own write, left. It lasts the process; a session the map does not hold has read
 * nothing.
 */
const seen = new Map<string, Map<string, Seen>>();

/** A file as a session last saw it. */
interface Seen {
  mtimeNs: bigint;
  size: bigint;
}

const rules = (workspace: string) => [
  `Relative paths resolve against the workspace, ${workspace}. Reads may go anywhere; writes outside the workspace ask first.`,
  'Use search_files to find where something is and list_files to see what exists, then read_file the files that matter; do not read a whole tree.',
  'To change an existing file, read it and use edit_file with an exact, unique old text; write_file replaces a whole file or creates one.',
].join('\n');

/**
 * The files capability: `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, and the
 * rules the model follows with them. Paths resolve against the run's workspace (`process.cwd()` when
 * the session has none); the workspace boundary is a fact the program's policy reads (`resolveWithin`).
 */
export function files(options: FilesOptions = {}): Capability {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  return {
    id: 'files',
    instructions: (args) => rules(args.workspace ?? process.cwd()),
    tools: (args) => fileTools({ workspace: args.workspace ?? process.cwd(), sessionId: args.sessionId, maxLines, maxMatches }),
  };
}

function fileTools(args: { workspace: string; sessionId: string; maxLines: number; maxMatches: number }): Tool<any, any>[] {
  const { workspace, sessionId, maxLines, maxMatches } = args;
  const at = (path: string) => resolveWithin(workspace, path).absolute;
  const shown = (absolute: string) => displayPath(workspace, absolute);
  /**
   * What a permission rule's `match` sees for a path tool (decision CLI-04.6): the path resolved, relative with
   * forward slashes when it is inside the workspace (`src/a.ts`), absolute when it is not; never the raw input, whose
   * `..` and mixed spellings a glob cannot tell inside from outside by.
   */
  const subject = (path: string) => shown(at(path));

  const readFileTool = createTool<ReadFileInput>({
    name: 'read_file',
    description: `Read a text file: numbered lines, ${maxLines} at a time from offset (1-based). Binary files are refused; long lines are cut at ${MAX_LINE} characters.`,
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute, or relative to the workspace' },
        offset: { type: 'integer', minimum: 1, description: 'First line to return; default 1' },
        limit: { type: 'integer', minimum: 1, description: `Lines to return; default ${maxLines}` },
      },
      required: ['path'],
      additionalProperties: false,
    },
    effects: { reads: true },
    subject: (input) => subject(input.path),
    execute: async (input) => {
      const resolved = resolveWithin(workspace, input.path);
      const absolute = resolved.absolute;
      const text = await readText(resolved, shown(absolute), sessionId);
      if (text === '') return `${shown(absolute)} is empty`;
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const from = (input.offset ?? 1) - 1;
      const limit = input.limit ?? maxLines;
      if (from >= lines.length) throw new Error(`${shown(absolute)} has ${lines.length} lines; offset ${input.offset} is past the end`);
      const width = String(Math.min(lines.length, from + limit)).length;
      const rows = lines.slice(from, from + limit).map((line, i) => `${String(from + i + 1).padStart(width)}│${cut(line, MAX_LINE)}`);
      const left = lines.length - (from + rows.length);
      return left > 0 ? `${rows.join('\n')}\n[${left} more lines; read from offset ${from + rows.length + 1}]` : rows.join('\n');
    },
  });

  const writeFileTool = createTool<WriteFileInput>({
    name: 'write_file',
    description: 'Write a whole text file, creating it and its folders or replacing what was there. Prefer edit_file to change part of an existing file.',
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute, or relative to the workspace' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    effects: { writes: true, destructive: true },
    subject: (input) => subject(input.path),
    writes: (input) => at(input.path),
    execute: async (input) => {
      const resolved = resolveWithin(workspace, input.path);
      const opened = await openChecked(resolved, shown(resolved.absolute), true);
      try {
        if (!opened.created) assertCurrent(sessionId, resolved.real, opened.stats, shown(resolved.absolute));
        await writeThrough(opened.handle, input.content);
        remember(sessionId, resolved.real, await opened.handle.stat({ bigint: true }));
      } finally {
        await opened.handle.close();
      }
      return `${opened.created ? 'created' : 'replaced'} ${shown(resolved.absolute)} (${Buffer.byteLength(input.content)} bytes)`;
    },
  });

  const editFileTool = createTool<EditFileInput>({
    name: 'edit_file',
    description: 'Replace text in a file. `old` must occur exactly once (give more surrounding lines to make it unique), or pass all: true to replace every occurrence. Read the file first.',
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute, or relative to the workspace' },
        old: { type: 'string', minLength: 1, description: 'The exact text to replace, whitespace included' },
        new: { type: 'string' },
        all: { type: 'boolean', description: 'Replace every occurrence; default false' },
      },
      required: ['path', 'old', 'new'],
      additionalProperties: false,
    },
    effects: { writes: true, destructive: true },
    subject: (input) => subject(input.path),
    writes: (input) => at(input.path),
    execute: async (input) => {
      const resolved = resolveWithin(workspace, input.path);
      const absolute = resolved.absolute;
      const opened = await openChecked(resolved, shown(absolute), false);
      try {
        assertCurrent(sessionId, resolved.real, opened.stats, shown(absolute));
        const text = textOfBuffer(await opened.handle.readFile(), shown(absolute));
        const count = text.split(input.old).length - 1;
        if (count === 0) throw new Error(`old text not found in ${shown(absolute)}`);
        if (count > 1 && !input.all) throw new Error(`old text occurs ${count} times in ${shown(absolute)}; add context to make it unique, or pass all: true`);
        const next = input.all ? text.replaceAll(input.old, input.new) : text.replace(input.old, () => input.new);
        await writeThrough(opened.handle, next);
        remember(sessionId, resolved.real, await opened.handle.stat({ bigint: true }));
        return `edited ${shown(absolute)}: ${count} replacement${count === 1 ? '' : 's'}`;
      } finally {
        await opened.handle.close();
      }
    },
  });

  const listFilesTool = createTool<ListFilesInput>({
    name: 'list_files',
    description: 'List files and folders matching a glob (`src/**/*.ts`, `*.md`), folders with a trailing slash. node_modules and .git are skipped unless the pattern names them.',
    input: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'A glob; ** crosses folders' },
        cwd: { type: 'string', description: 'Where the pattern applies; default the workspace' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    effects: { reads: true },
    subject: (input) => input.pattern,
    execute: async (input) => {
      const cwd = at(input.cwd ?? '.');
      const rows: string[] = [];
      for await (const entry of walk(cwd, input.pattern)) {
        const absolute = join(entry.parentPath, entry.name);
        rows.push(displayPath(cwd, absolute) + (entry.isDirectory() ? '/' : ''));
        if (rows.length === MAX_ENTRIES) break;
      }
      rows.sort();
      if (rows.length === 0) return `no files match ${input.pattern} under ${shown(cwd)}`;
      return rows.length === MAX_ENTRIES ? `${rows.join('\n')}\n[${MAX_ENTRIES} entries; narrow the pattern]` : rows.join('\n');
    },
  });

  const searchFilesTool = createTool<SearchFilesInput>({
    name: 'search_files',
    description: `Search file contents with a regular expression, line by line; rows are file:line:text, ${maxMatches} at most. Binary files, node_modules and .git are skipped.`,
    input: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'A JavaScript regular expression' },
        path: { type: 'string', description: 'A file or folder to search; default the workspace' },
        glob: { type: 'string', description: 'Only files matching this glob under path, such as **/*.ts' },
        ignoreCase: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, description: `Rows to return; default ${maxMatches}` },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    effects: { reads: true },
    subject: (input) => input.pattern,
    execute: async (input, ctx) => {
      const regex = compile(input.pattern, input.ignoreCase === true);
      const root = at(input.path ?? '.');
      const limit = input.limit ?? maxMatches;
      const rows: string[] = [];
      let hitLimit = false;
      for await (const absolute of filesUnder(root, input.glob)) {
        if (ctx.signal.aborted) break;
        const text = await textOf(absolute);
        if (text === undefined) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!regex.test(lines[i]!)) continue;
          rows.push(`${displayPath(workspace, absolute)}:${i + 1}:${cut(lines[i]!.trimEnd(), MAX_ROW)}`);
          if (rows.length === limit) { hitLimit = true; break; }
        }
        if (hitLimit) break;
      }
      if (rows.length === 0) return `no matches for /${input.pattern}/ under ${shown(root)}`;
      return hitLimit ? `${rows.join('\n')}\n[${limit} rows; narrow with path or glob]` : rows.join('\n');
    },
  });

  return [readFileTool, writeFileTool, editFileTool, listFilesTool, searchFilesTool];
}

/** Every entry the glob matches under `cwd`, skipping `node_modules` and `.git` unless the pattern names them. */
function walk(cwd: string, pattern: string) {
  const named = [...SKIPPED].filter((name) => pattern.includes(name));
  return glob(pattern, {
    cwd,
    withFileTypes: true,
    exclude: (entry: Dirent) => SKIPPED.has(entry.name) && !named.includes(entry.name),
  });
}

/** Absolute paths of the files under `root` (or `root` itself when it is a file). */
async function* filesUnder(root: string, pattern: string | undefined): AsyncGenerator<string> {
  const info = await stat(root).catch(() => undefined);
  if (info === undefined) throw new Error(`nothing at ${root}`);
  if (info.isFile()) { yield root; return; }
  for await (const entry of walk(root, pattern ?? '**/*')) {
    if (entry.isFile()) yield join(entry.parentPath, entry.name);
  }
}

/** The text of the file at `resolved`, recorded as what `sessionId` last saw of it. */
async function readText(resolved: ResolvedPath, shown: string, sessionId: string): Promise<string> {
  const refused = (e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') throw new Error(`no file at ${shown}`);
    if (e.code === 'EISDIR') throw new Error(`${shown} is a folder; use list_files`);
    throw e;
  };
  const handle = await open(resolved.absolute, 'r').catch(refused);
  try {
    const stats = await handle.stat({ bigint: true });
    const text = textOfBuffer(await handle.readFile().catch(refused), shown);
    remember(sessionId, resolved.real, stats);
    return text;
  } finally {
    await handle.close();
  }
}

/** Refuses a write to a file `sessionId` never read, or whose `mtime` or size moved since it last saw it. */
function assertCurrent(sessionId: string, real: string, stats: BigIntStats, shown: string): void {
  const last = seen.get(sessionId)?.get(real);
  if (last === undefined) throw new Error(`${shown} was not read in this session; read it with read_file first`);
  if (last.mtimeNs !== stats.mtimeNs || last.size !== stats.size) throw new Error(`${shown} changed since it was read; read it again with read_file first`);
}

/** Records `stats` as what `sessionId` last saw of the file at `real`. */
function remember(sessionId: string, real: string, { mtimeNs, size }: BigIntStats): void {
  let files = seen.get(sessionId);
  if (files === undefined) seen.set(sessionId, files = new Map());
  files.set(real, { mtimeNs, size });
}

/** A file's bytes as the text the tools work on: refused when binary, line ends as `\n`. */
function textOfBuffer(buffer: Buffer, shown: string): string {
  if (isBinary(buffer)) throw new Error(`${shown} is binary`);
  return buffer.toString('utf8').replaceAll('\r\n', '\n');
}

/** A file opened for a write, with what its descriptor says it is. */
interface Opened {
  handle: FileHandle;
  /** The open made the file. */
  created: boolean;
  stats: BigIntStats;
}

/**
 * Opens the file at `resolved` for a write, as the file `resolved.real` names when the call starts. An existing file
 * opens `r+` and is refused unless the descriptor's device and inode are those of `resolved.real`; a missing one opens
 * `wx`, so a file or link put at the name first fails the open instead of being followed. `create` false refuses a
 * missing file.
 */
async function openChecked(resolved: ResolvedPath, shown: string, create: boolean): Promise<Opened> {
  const checked = await stat(resolved.real, { bigint: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  });
  if (checked === undefined) {
    if (!create) throw new Error(`no file at ${shown}`);
    await mkdir(dirname(resolved.absolute), { recursive: true });
    const handle = await open(resolved.absolute, 'wx').catch((e: NodeJS.ErrnoException) => {
      throw e.code === 'EEXIST' ? changed(shown) : e;
    });
    return { handle, created: true, stats: await statOrClose(handle) };
  }
  if (checked.isDirectory()) throw new Error(`${shown} is a folder; use list_files`);
  const handle = await open(resolved.absolute, 'r+').catch((e: NodeJS.ErrnoException) => {
    throw e.code === 'ENOENT' ? changed(shown) : e;
  });
  const stats = await statOrClose(handle);
  if (stats.dev !== checked.dev || stats.ino !== checked.ino) {
    await handle.close();
    throw changed(shown);
  }
  return { handle, created: false, stats };
}

async function statOrClose(handle: FileHandle): Promise<BigIntStats> {
  try { return await handle.stat({ bigint: true }); }
  catch (e) { await handle.close(); throw e; }
}

function changed(shown: string): Error {
  return new Error(`${shown} changed after it was checked; nothing was written`);
}

/** Replaces the whole content of the file open at `handle` with `text`. */
async function writeThrough(handle: FileHandle, text: string): Promise<void> {
  const bytes = Buffer.from(text, 'utf8');
  let done = 0;
  while (done < bytes.length) done += (await handle.write(bytes, done, bytes.length - done, done)).bytesWritten;
  await handle.truncate(bytes.length);
}

/** The text of a searchable file; undefined when it is binary or too large. */
async function textOf(absolute: string): Promise<string | undefined> {
  const info = await stat(absolute).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size > MAX_SEARCHED_BYTES) return undefined;
  const buffer = await readFile(absolute);
  return isBinary(buffer) ? undefined : buffer.toString('utf8');
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8192).includes(0);
}

function compile(pattern: string, ignoreCase: boolean): RegExp {
  try { return new RegExp(pattern, ignoreCase ? 'i' : ''); }
  catch (e) { throw new Error(`invalid regular expression /${pattern}/: ${(e as Error).message}`); }
}

function cut(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max)} [line cut at ${max} characters]` : line;
}
