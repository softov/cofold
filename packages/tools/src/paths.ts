import { realpathSync, readlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
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
 * `hops` is the budget of symlinks still to follow, shared by every link met on the way.
 */
function realPath(path: string, hops = { left: MAX_LINKS }): string {
  try { return realpathSync.native(path); } catch { /* missing, dangling or unreadable */ }
  if (hops.left > 0) {
    let target: string | undefined;
    try { target = readlinkSync(path); } catch { /* not a symlink */ }
    if (target !== undefined) {
      hops.left -= 1;
      return follow(realPath(dirname(path), hops), target, hops);
    }
  }
  const parent = dirname(path);
  return parent === path ? path : join(realPath(parent, hops), basename(path));
}

/**
 * Where a symlink's `target` lands, read from the real directory `from` one name at a time as the
 * kernel reads it: `..` is the real parent of what is resolved so far, each other name its real path.
 */
function follow(from: string, target: string, hops: { left: number }): string {
  let at = isAbsolute(target) ? parse(target).root : from;
  for (const name of target.split(sep === '/' ? '/' : /[\\/]/)) {
    if (name === '' || name === '.') continue;
    at = name === '..' ? dirname(at) : realPath(join(at, name), hops);
  }
  return at;
}

/** A path for the model: relative to `from` when under it, with forward slashes. */
export function displayPath(from: string, absolute: string): string {
  const rel = relative(from, absolute);
  const shown = rel === '' ? '.' : rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? absolute : rel;
  return shown.split(sep).join('/');
}
