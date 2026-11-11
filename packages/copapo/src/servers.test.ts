import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeServersOf, serversFor } from './servers.js';
import { testConfig } from './testing.js';

let workspace: string;
beforeEach(async () => { workspace = await mkdtemp(join(tmpdir(), 'copapo-servers-')); });
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

describe('serversFor', () => {
  it('reads .mcp.json only in a trusted folder, its entry replacing a configured one of the same name', async () => {
    await writeFile(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'http://project' }, extra: { command: 'p' } } }));
    const config = testConfig({ mcpServers: { docs: { type: 'http', url: 'http://user' }, files: { command: 'f' } } });
    const warned: string[] = [];
    const warn = (message: string): void => { warned.push(message); };
    expect(serversFor({ config, workspace, trusted: false, warn })).toEqual({ docs: { type: 'http', url: 'http://user' }, files: { command: 'f' } });
    expect(serversFor({ config, workspace, trusted: true, warn })).toEqual({ docs: { type: 'http', url: 'http://project' }, files: { command: 'f' }, extra: { command: 'p' } });
    expect(warned).toEqual([]);
  });

  it('leaves out a wrong entry and says why', () => {
    const warned: string[] = [];
    expect(serversFor({ config: testConfig({ mcpServers: { bad: { url: 'http://x' } } }), workspace, trusted: true, warn: (message) => warned.push(message) })).toEqual({});
    expect(warned).toEqual(['mcp server "bad" in the configuration is left out: a url needs "type": "http"']);
  });
});

describe('claudeServersOf', () => {
  it('gives the SDK its shape, without copapo\'s own keys or a disabled server', () => {
    expect(claudeServersOf({
      files: { command: 'f', args: ['a'], env: { K: 'v' }, cwd: '/x', toolTimeoutSec: 5 },
      docs: { type: 'http', url: 'http://h', headers: { a: 'b' }, startupTimeoutSec: 3 },
      off: { command: 'o', enabled: false },
    })).toEqual({
      files: { type: 'stdio', command: 'f', args: ['a'], env: { K: 'v' } },
      docs: { type: 'http', url: 'http://h', headers: { a: 'b' } },
    });
  });
});
