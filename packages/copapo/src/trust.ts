import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { ConfigurationError } from '@cofold/commands';
import { resolveConfig } from '@cofold/config';
import { indentOf, userConfigPath } from './config.js';
import type { Backend, ProjectTrust } from './types/config.js';

/** Whether a folder's own files load: by a saved answer, or `unasked` when it holds gated files and has none. */
export type TrustState = 'trusted' | 'untrusted' | 'unasked';

export interface Trust {
  state: TrustState;
  /** The workspace, by its real path: the folder an answer is saved for. */
  folder: string;
  /** The gated files the workspace holds, found from it upward; empty when nothing is gated. */
  gated: string[];
  /** The folder whose saved answer decided, the workspace or one above it. */
  answeredAt?: string;
  /** What a run that cannot ask does with `unasked`. */
  projectTrust: ProjectTrust;
}

/**
 * The files a project gives that trust gates: `.copapo.json` up the tree, `.agents/skills` up to the repository
 * root but not the home folder's, `.mcp.json` in the workspace, and for the claude backend the CLI's own project settings.
 */
export function gatedFiles(workspace: string, backend: Backend): string[] {
  const found: string[] = [];
  const common = join(homedir(), '.agents', 'skills');
  const top = repositoryRoot(workspace);
  for (let at = workspace, inRepo = true; ; at = dirname(at)) {
    const config = join(at, '.copapo.json');
    if (existsSync(config)) found.push(config);
    const skills = join(at, '.agents', 'skills');
    // The home folder's is the common folder, shared by every project, even when home is a repository.
    if (inRepo && (top !== undefined || at === workspace) && skills !== common && existsSync(skills)) found.push(skills);
    if (at === top) inRepo = false;
    if (dirname(at) === at) break;
  }
  const files = backend === 'claude' ? [join('.claude', 'settings.json'), join('.claude', 'settings.local.json'), '.mcp.json'] : ['.mcp.json'];
  for (const file of files) {
    if (existsSync(join(workspace, file))) found.push(join(workspace, file));
  }
  return found;
}

/** The first folder from `workspace` up that holds `.git`; none when there is no repository. */
function repositoryRoot(workspace: string): string | undefined {
  for (let at = workspace; ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return at;
    if (dirname(at) === at) return undefined;
  }
}

/**
 * The workspace's trust. The answers and `projectTrust` are read from the user file alone, so no project file can
 * trust itself. The closest saved answer, for the workspace or a folder above it, decides; with none, a folder
 * that holds no gated file is trusted, because there is nothing to gate, and one that holds any is `unasked`.
 */
export function trustOf(args: { workspace: string; backend: Backend; env?: NodeJS.ProcessEnv }): Trust {
  const env = args.env ?? process.env;
  const folder = realPath(args.workspace);
  const user = resolveConfig({ name: 'copapo', cwd: folder, env, environment: false });
  const answers = user.get<Record<string, unknown>>('trusted') ?? {};
  const projectTrust = projectTrustOf(user.get<unknown>('projectTrust'));
  let best: { at: string; trusted: boolean } | undefined;
  for (const [path, value] of Object.entries(answers)) {
    if (typeof value !== 'boolean') continue;
    const at = realPath(path);
    if (!covers(at, folder)) continue;
    if (best === undefined || at.length > best.at.length) best = { at, trusted: value };
  }
  const gated = gatedFiles(folder, args.backend);
  if (best !== undefined) return { state: best.trusted ? 'trusted' : 'untrusted', folder, gated, answeredAt: best.at, projectTrust };
  return { state: gated.length === 0 ? 'trusted' : 'unasked', folder, gated, projectTrust };
}

/** Whether the project's own files load for this run: a saved answer, else `projectTrust` for one that cannot ask. */
export function loadsProject(trust: Trust): boolean {
  if (trust.state !== 'unasked') return trust.state === 'trusted';
  return trust.projectTrust === 'always';
}

/** Saves the answer for `workspace` in the user file, and resolves to that file. */
export async function saveTrust(args: { workspace: string; trusted: boolean; env?: NodeJS.ProcessEnv }): Promise<string> {
  const env = args.env ?? process.env;
  const target = userConfigPath(env);
  let text: string | undefined;
  try {
    text = await readFile(target, 'utf8');
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    await mkdir(dirname(target), { recursive: true });
  }
  let json: Record<string, unknown> = {};
  if (text !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new ConfigurationError(`${target} is not valid JSON: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ConfigurationError(`${target} is not an object, so it is not a configuration file`);
    json = parsed as Record<string, unknown>;
  }
  const held = json['trusted'];
  const trusted = typeof held === 'object' && held !== null && !Array.isArray(held) ? { ...(held as Record<string, unknown>) } : {};
  trusted[realPath(args.workspace)] = args.trusted;
  json['trusted'] = trusted;
  await writeFile(target, JSON.stringify(json, null, text === undefined ? '  ' : indentOf(text)) + (text === undefined || text.endsWith('\n') ? '\n' : ''), 'utf8');
  return target;
}

function projectTrustOf(value: unknown): ProjectTrust {
  return value === 'always' || value === 'never' ? value : 'ask';
}

/** The folder by its real path when it exists, so a link and its target are one folder. */
function realPath(path: string): string {
  try { return realpathSync.native(resolve(path)); } catch { return resolve(path); }
}

/** Whether an answer saved for `at` covers `folder`: the folder itself or one under it; without case on Windows. */
function covers(at: string, folder: string): boolean {
  const [a, f] = process.platform === 'win32' ? [at.toLowerCase(), folder.toLowerCase()] : [at, folder];
  return f === a || f.startsWith(a.endsWith(sep) ? a : a + sep);
}
