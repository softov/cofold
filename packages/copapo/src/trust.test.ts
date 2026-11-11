import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gatedFiles, loadsProject, saveTrust, trustOf } from './trust.js';

let root: string;
let env: NodeJS.ProcessEnv;
const write = async (path: string, text = '{}\n'): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
};
const userFile = (): string => join(root, 'xdg', 'copapo', 'config.json');

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'copapo-trust-')));
  env = { XDG_CONFIG_HOME: join(root, 'xdg') };
  await mkdir(join(root, 'repo', '.git'), { recursive: true });
  await mkdir(join(root, 'repo', 'pkg'), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('trust', () => {
  it('trusts a folder with nothing gated, and leaves one with a .copapo.json above it unasked', async () => {
    expect(trustOf({ workspace: join(root, 'repo', 'pkg'), backend: 'cofold', env }).state).toBe('trusted');
    await write(join(root, 'repo', '.copapo.json'));
    const trust = trustOf({ workspace: join(root, 'repo', 'pkg'), backend: 'cofold', env });
    expect(trust).toMatchObject({ state: 'unasked', gated: [join(root, 'repo', '.copapo.json')], projectTrust: 'ask' });
    expect(loadsProject(trust)).toBe(false);
  });

  it('gates .agents/skills up to the repository root, .mcp.json, and the CLI files for claude only', async () => {
    await mkdir(join(root, 'repo', '.agents', 'skills'), { recursive: true });
    await mkdir(join(root, '.agents', 'skills'), { recursive: true });
    await write(join(root, 'repo', 'pkg', '.mcp.json'));
    await write(join(root, 'repo', 'pkg', '.claude', 'settings.json'));
    expect(gatedFiles(join(root, 'repo', 'pkg'), 'cofold')).toEqual([join(root, 'repo', '.agents', 'skills'), join(root, 'repo', 'pkg', '.mcp.json')]);
    expect(gatedFiles(join(root, 'repo', 'pkg'), 'claude')).toEqual([join(root, 'repo', '.agents', 'skills'), join(root, 'repo', 'pkg', '.claude', 'settings.json'), join(root, 'repo', 'pkg', '.mcp.json')]);
  });

  it('never gates the home folder\'s .agents/skills, even when home is a repository', async () => {
    const home = join(root, 'home');
    await mkdir(join(home, '.git'), { recursive: true });
    await mkdir(join(home, '.agents', 'skills'), { recursive: true });
    await mkdir(join(home, 'project'), { recursive: true });
    vi.stubEnv('HOME', home);
    try {
      expect(gatedFiles(join(home, 'project'), 'cofold')).toEqual([]);
      expect(trustOf({ workspace: join(home, 'project'), backend: 'cofold', env }).state).toBe('trusted');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('saves yes and no in the user file, and the closest answer decides', async () => {
    await write(join(root, 'repo', '.copapo.json'));
    await write(userFile(), '{\n    "model": "x/y"\n}\n');
    await saveTrust({ workspace: join(root, 'repo'), trusted: true, env });
    expect(trustOf({ workspace: join(root, 'repo', 'pkg'), backend: 'cofold', env })).toMatchObject({ state: 'trusted', answeredAt: join(root, 'repo') });
    await saveTrust({ workspace: join(root, 'repo', 'pkg'), trusted: false, env });
    expect(trustOf({ workspace: join(root, 'repo', 'pkg'), backend: 'cofold', env }).state).toBe('untrusted');
    expect(trustOf({ workspace: join(root, 'repo'), backend: 'cofold', env }).state).toBe('trusted');
    const saved = JSON.parse(await readFile(userFile(), 'utf8')) as Record<string, unknown>;
    expect(saved).toEqual({ model: 'x/y', trusted: { [join(root, 'repo')]: true, [join(root, 'repo', 'pkg')]: false } });
    expect(await readFile(userFile(), 'utf8')).toContain('\n    "model"');
  });

  it('never takes an answer from the project file', async () => {
    await write(join(root, 'repo', '.copapo.json'), JSON.stringify({ trusted: { [join(root, 'repo')]: true }, projectTrust: 'always' }));
    const trust = trustOf({ workspace: join(root, 'repo'), backend: 'cofold', env });
    expect(trust).toMatchObject({ state: 'unasked', projectTrust: 'ask' });
  });

  it('loads an unasked folder when the user file says projectTrust always', async () => {
    await write(join(root, 'repo', '.copapo.json'));
    await write(userFile(), JSON.stringify({ projectTrust: 'always' }));
    expect(loadsProject(trustOf({ workspace: join(root, 'repo'), backend: 'cofold', env }))).toBe(true);
  });
});
