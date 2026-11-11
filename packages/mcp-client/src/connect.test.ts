import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { connectMcp } from './connect.js';
import { launchOf } from './stdio.js';

const fixture = (name: string): string => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));
const clientInfo = { name: 'test', version: '1' };
const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('connectMcp over stdio', () => {
  it('speaks to @cofold/mcp\'s own server: lists, calls, and reads a refusal as isError', async () => {
    const connection = await connectMcp({ name: 'cofold', server: { command: process.execPath, args: [fixture('cofold-server.mjs')] }, clientInfo, timeoutMs: 10_000 });
    try {
      expect(connection.serverInfo).toEqual({ name: 'cofold-fixture', version: '1' });
      expect(connection.tools().map((tool) => tool.name).sort()).toEqual(['echo', 'fail']);
      expect(connection.tools().find((tool) => tool.name === 'echo')?.annotations).toMatchObject({ readOnlyHint: true });
      const echoed = await connection.call('echo', { text: 'hi' });
      expect(echoed.isError).not.toBe(true);
      expect(JSON.stringify(echoed)).toContain('hi');
      const failed = await connection.call('fail', {});
      expect(failed.isError).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('lists every page, answers a ping, follows list_changed, and cancels an aborted call', async () => {
    const connection = await connectMcp({ name: 'raw', server: { command: process.execPath, args: [fixture('raw-server.mjs')] }, clientInfo, timeoutMs: 10_000 });
    try {
      expect(connection.instructions).toBe('Raw rules.');
      expect(connection.tools().map((tool) => tool.name)).toEqual(['add', 'wait', 'grow']);
      expect((await connection.call('add', { a: 2, b: 3 })).content).toEqual([{ type: 'text', text: '5' }]);

      await connection.call('grow', {});
      for (let waited = 0; !connection.tools().some((tool) => tool.name === 'grown'); waited += 10) {
        if (waited > 2000) throw new Error('the list never changed');
        await tick(10);
      }

      const abort = new AbortController();
      const waiting = connection.call('wait', {}, { signal: abort.signal });
      await tick();
      abort.abort();
      await expect(waiting).rejects.toThrow();
      await expect(connection.call('wait', {}, { timeoutMs: 50 })).rejects.toThrow('took longer');
      const state = (await connection.call('state', {})).structuredContent as { cancelled: unknown[]; pong: boolean };
      expect(state.pong).toBe(true);
      expect(state.cancelled).toHaveLength(2);
    } finally {
      await connection.close();
    }
  });

  it('refuses a protocol version it does not speak, and quotes the server\'s stderr', async () => {
    await expect(connectMcp({ name: 'old', server: { command: process.execPath, args: [fixture('raw-server.mjs')], env: { RAW_VERSION: '1999-01-01' } }, clientInfo, timeoutMs: 10_000 }))
      .rejects.toThrow(/1999-01-01.*raw server starting/);
  });

  it('says why when the server exits', async () => {
    const connection = await connectMcp({ name: 'raw', server: { command: process.execPath, args: [fixture('raw-server.mjs')] }, clientInfo, timeoutMs: 10_000 });
    await expect(connection.call('exit', {})).rejects.toThrow('exited with 3');
    expect(connection.closed).toMatch(/exited with 3/);
  });

  it('fails a command that does not exist, naming it', async () => {
    await expect(connectMcp({ name: 'none', server: { command: 'cofold-no-such-command' }, clientInfo, timeoutMs: 2000 })).rejects.toThrow(/ENOENT|not found/);
  });
});

describe('launchOf', () => {
  it('finds npx.cmd through PATH and PATHEXT on Windows, and runs it through the shell with each argument quoted', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mcp-pathext-'));
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'npx.CMD'), '@echo off\n');
      const launch = launchOf('npx', ['-y', 'some server'], { PATH: folder, PATHEXT: '.EXE;.CMD' }, 'win32');
      expect(launch).toEqual({ command: join(folder, 'npx.CMD'), args: ['-y', '"some server"'], shell: true });
      expect(launchOf('node', ['a'], { PATH: folder }, 'linux')).toEqual({ command: 'node', args: ['a'], shell: false });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
