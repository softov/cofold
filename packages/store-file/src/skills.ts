import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { AgentError } from '@cofold/agents';
import type { SkillIndexEntry, SkillSource } from '@cofold/agents';

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Skills on disk (decision 85): `<root>/skills/<name>/SKILL.md` for every session, plus the project's
 * `.agents/skills/<name>/SKILL.md` when the session has a workspace. A project skill shadows a global one of the
 * same name, and a nearer folder a farther one. `ref` is the absolute skill folder.
 *
 * `project` (default `true`) says whether the project's folders are read; a function is asked on every listing,
 * so a host can gate them on trust. `walk` (default `false`) reads `.agents/skills` in the workspace and each folder
 * above it, up to the first one that holds `.git`; with no `.git` above, the workspace folder alone.
 */
export function fileSkillSource(args: { root: string; project?: boolean | (() => boolean); walk?: boolean }): SkillSource {
  const globalDir = join(resolve(args.root), 'skills');
  const project = typeof args.project === 'function' ? args.project : () => args.project !== false;
  return {
    async list({ workspace }) {
      const projectDirs = workspace !== undefined && project() ? await projectSkillDirs(resolve(workspace), args.walk === true) : [];
      const dirs = [...projectDirs, globalDir];
      const seen = new Map<string, SkillIndexEntry>();
      for (const base of dirs) {
        for (const folder of await listDirs(base)) {
          const dir = join(base, folder);
          const text = await readText(join(dir, 'SKILL.md'));
          if (text === undefined) continue;
          const meta = parseFrontmatter(text).meta;
          const name = meta.name ?? folder;
          if (!NAME_PATTERN.test(name) || seen.has(name)) continue;
          seen.set(name, { name, description: meta.description ?? '', ref: dir });
        }
      }
      return [...seen.values()];
    },
    async read({ ref, path }) {
      const dir = resolve(ref);
      const file = resolve(dir, path ?? 'SKILL.md');
      const rel = relative(dir, file);
      if (rel === '' || rel.startsWith('..') || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) {
        throw new AgentError({ code: 'invalid_options', message: `path "${path}" leaves the skill folder` });
      }
      const text = await readText(file);
      if (text === undefined) throw new AgentError({ code: 'not_found', message: path ? `${path} in skill ${ref}` : `skill ${ref}` });
      return path ? text : parseFrontmatter(text).body;
    },
  };
}

/** `key: value` lines between two `---` fences at the top of the file; nothing else is interpreted. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '---') return { meta, body: lines.slice(i + 1).join('\n').replace(/^\n+/, '') };
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    meta[key] = value;
  }
  return { meta: {}, body: text };
}

/**
 * `.agents/skills` in the workspace, then in each folder above it up to the repository root, nearest first. The home
 * folder's `.agents/skills` is the common folder every project shares, never a project's, even when home is a repository.
 */
async function projectSkillDirs(workspace: string, walk: boolean): Promise<string[]> {
  const common = join(homedir(), '.agents', 'skills');
  const own = join(workspace, '.agents', 'skills');
  if (!walk) return own === common ? [] : [own];
  const dirs: string[] = [];
  for (let at = workspace; ; at = dirname(at)) {
    const dir = join(at, '.agents', 'skills');
    if (dir !== common) dirs.push(dir);
    if (await exists(join(at, '.git'))) return dirs;
    if (dirname(at) === at) return own === common ? [] : [own];
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch { return false; }
}

async function listDirs(base: string): Promise<string[]> {
  try { return (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function readText(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return undefined;
    throw e;
  }
}
