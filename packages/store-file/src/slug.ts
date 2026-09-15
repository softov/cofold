import { resolve } from 'node:path';

/** One folder name per workspace path: absolute, drive letter lower-cased on Windows, every other byte kept safe. */
export function workspaceSlug(args: { workspace: string }): string {
  let p = resolve(args.workspace);
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(p)) p = p[0]!.toLowerCase() + p.slice(1);
  return p.replace(/[^A-Za-z0-9._-]/g, '-');
}
