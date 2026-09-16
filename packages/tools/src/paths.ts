import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ResolvedPath } from './types/files.js';

/** Resolves `path` against `workspace` (relative ones) and says whether the result stays inside it. */
export function resolveWithin(workspace: string, path: string): ResolvedPath {
  const root = resolve(workspace);
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  return { absolute, inside };
}

/** A path for the model: relative to `from` when under it, with forward slashes. */
export function displayPath(from: string, absolute: string): string {
  const rel = relative(from, absolute);
  const shown = rel === '' ? '.' : rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? absolute : rel;
  return shown.split(sep).join('/');
}
