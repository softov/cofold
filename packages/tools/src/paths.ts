import { realpathSync, readlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ResolvedPath } from './types/files.js';

/** Symlinks followed by hand for a path `realpath` refuses, as the kernel's own limit. */
const MAX_LINKS = 40;

/**
 * Resolves `path` against `workspace` (relative ones) and says whether the result stays inside it.
 * `absolute` is lexical; `inside` compares real paths, so a symlink out of the workspace is outside.
 */
export function resolveWithin(workspace: string, path: string): ResolvedPath {
  const root = resolve(workspace);
  const absolute = resolve(root, path);
  const rel = relative(realPath(root), realPath(absolute));
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  return { absolute, inside };
}

/**
 * Where `path` lands on disk: its `realpath` when it exists, the target of a dangling symlink,
 * or the real path of its nearest existing ancestor with the rest appended.
 */
function realPath(path: string, links = 0): string {
  try { return realpathSync.native(path); } catch { /* missing, dangling or unreadable */ }
  if (links < MAX_LINKS) {
    let target: string | undefined;
    try { target = readlinkSync(path); } catch { /* not a symlink */ }
    if (target !== undefined) return realPath(resolve(dirname(path), target), links + 1);
  }
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent, links), basename(path));
}

/** A path for the model: relative to `from` when under it, with forward slashes. */
export function displayPath(from: string, absolute: string): string {
  const rel = relative(from, absolute);
  const shown = rel === '' ? '.' : rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? absolute : rel;
  return shown.split(sep).join('/');
}
