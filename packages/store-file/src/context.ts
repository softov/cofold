import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** One context file, with the files its `@path` lines import appended to its text. */
export interface ContextFile {
  path: string;
  text: string;
}

/** How many levels of `@path` imports are followed below a context file. */
const MAX_IMPORT_DEPTH = 4;

/** The file each folder gives, by precedence: `CLAUDE.md` only where there is no `AGENTS.md`. */
const NAMES = ['AGENTS.md', 'CLAUDE.md'];

/**
 * The context files for a workspace, in the order the model reads them: the `common` files as given, then one
 * file per folder from the filesystem root down to the workspace. A folder's file is its `AGENTS.md`, or its
 * `CLAUDE.md` when it has none. A missing or empty file gives nothing, and no path is read twice.
 *
 * A word `@<path>` outside fenced and inline code imports that file when it exists: relative to the file that
 * names it, `~/` from the home folder, `\ ` for a space. Imported text follows the importing file's text, up to
 * four levels down, each file once.
 */
export async function readContextFiles(args: { workspace: string; common?: readonly string[] }): Promise<ContextFile[]> {
  const seen = new Set<string>();
  const files: ContextFile[] = [];
  const take = async (path: string, text: string): Promise<void> => {
    seen.add(path);
    const expanded = await expand(text, path, 0, seen);
    if (expanded.trim() !== '') files.push({ path, text: expanded.trim() });
  };
  for (const common of args.common ?? []) {
    const path = resolve(common);
    if (seen.has(path)) continue;
    const text = await readText(path);
    if (text !== undefined) await take(path, text);
  }
  for (const folder of foldersDown(resolve(args.workspace))) {
    for (const name of NAMES) {
      const path = join(folder, name);
      const text = await readText(path);
      if (text === undefined || text.trim() === '') continue;
      if (!seen.has(path)) await take(path, text);
      break;
    }
  }
  return files;
}

/** The folders from the filesystem root down to `folder`, both included. */
function foldersDown(folder: string): string[] {
  const up: string[] = [];
  for (let at = folder; ; at = dirname(at)) {
    up.push(at);
    if (dirname(at) === at) break;
  }
  return up.reverse();
}

/** `text` with each import's text appended, each file once, `depth` levels below the context file. */
async function expand(text: string, file: string, depth: number, seen: Set<string>): Promise<string> {
  if (depth >= MAX_IMPORT_DEPTH) return text;
  const parts = [text.trimEnd()];
  for (const name of importsOf(text)) {
    const found = await importable(name, dirname(file), seen);
    if (found === undefined) continue;
    seen.add(found.path);
    const inner = await expand(found.text, found.path, depth + 1, seen);
    if (inner.trim() !== '') parts.push(inner.trim());
  }
  return parts.join('\n\n');
}

/** The file a name imports, with its text: the name as written, else without trailing punctuation. */
async function importable(name: string, folder: string, seen: Set<string>): Promise<{ path: string; text: string } | undefined> {
  const trimmed = name.replace(/[.,;:!?)\]]+$/, '');
  for (const candidate of trimmed === name ? [name] : [name, trimmed]) {
    const path = candidate.startsWith('~/') ? join(homedir(), candidate.slice(2)) : isAbsolute(candidate) ? candidate : resolve(folder, candidate);
    if (seen.has(path)) return undefined;
    const text = await readText(path);
    if (text !== undefined) return { path, text };
  }
  return undefined;
}

/** The `@path` words of a text, outside fenced code blocks and inline code spans, in order. */
export function importsOf(text: string): string[] {
  const names: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const prose = line.replace(/`[^`]*`/g, ' ');
    for (const match of prose.matchAll(/(?:^|\s)@((?:\\ |[^\s@])+)/g)) names.push(match[1]!.replace(/\\ /g, ' '));
  }
  return names;
}

async function readText(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR' || code === 'EACCES') return undefined;
    throw e;
  }
}
