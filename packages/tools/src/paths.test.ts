import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWithin } from './paths.js';

describe('resolveWithin, a dangling link', () => {
  it('puts a `..` after a symlinked directory in its target where the kernel does', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cofold-paths-'));
    try {
      const ws = join(base, 'ws');
      const away = join(base, 'away');
      await mkdir(ws);
      await mkdir(join(away, 'sub'), { recursive: true });
      await symlink(join(away, 'sub'), join(ws, 'sublink'), 'dir');
      await symlink('sublink/../esc2.txt', join(ws, 'trick'));
      await symlink('sublink/in.txt', join(ws, 'through'));
      await symlink('../ws/kept.txt', join(ws, 'back'));
      expect(resolveWithin(ws, 'trick').inside).toBe(false);
      expect(resolveWithin(ws, 'through').inside).toBe(false);
      expect(resolveWithin(ws, 'back').inside).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('follows a chain of dangling links and stops at the hop limit', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cofold-paths-'));
    try {
      const ws = join(base, 'ws');
      await mkdir(ws);
      await mkdir(join(base, 'away'));
      await symlink('second', join(ws, 'first'));
      await symlink('../away/x.txt', join(ws, 'second'));
      await symlink('loop', join(ws, 'loop'));
      expect(resolveWithin(ws, 'first').inside).toBe(false);
      expect(resolveWithin(ws, 'loop').inside).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
