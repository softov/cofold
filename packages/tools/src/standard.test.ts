import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Capability, CapabilityArgs, Tool, ToolContext } from '@cofold/agents';
import { createMemoryStore } from '@cofold/agents';
import type { SchemaResult } from '@cofold/sdk';
import { validateSchema } from '@cofold/sdk';
import { TOOLS_SCHEMA, standardCapabilities } from './standard.js';

const store = createMemoryStore();
const kv = { agent: store.kv({ kind: 'agent', agentId: 't' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) };
const signal = new AbortController().signal;
const args: CapabilityArgs = { agentId: 't', sessionId: 's', runId: 'r', workspace: '/work', kv, signal };
const ctx: ToolContext = { agentId: 't', sessionId: 's', runId: 'r', callId: 'c', invocationId: 'i', signal, kv, resources: {} };

const WORKSPACE = '/work';
const MEMORY = '/home/papo/memory/ws';
const ids = (config: Parameters<typeof standardCapabilities>[0], placed: { workspace: string; memoryDir?: string }): string[] =>
  standardCapabilities(config, placed).map((capability) => capability.id);

/** The tools one capability contributes, by name, for a run placed at `placed`. */
async function toolsOf(capabilities: Capability[], id: string, placed: CapabilityArgs = args): Promise<Map<string, Tool<any, any>>> {
  const capability = capabilities.find((candidate) => candidate.id === id);
  if (capability === undefined) throw new Error(`no ${id} capability`);
  return new Map((await capability.tools!(placed)).map((tool) => [tool.name, tool]));
}

describe('standardCapabilities', () => {
  it('gives files, shell, web and memory, in that order, for a configuration that says nothing', () => {
    expect(ids({}, { workspace: WORKSPACE, memoryDir: MEMORY })).toEqual(['files', 'shell', 'web', 'memory']);
    // No folder for the memory files, no memory capability, whether the key says so or not.
    expect(ids({}, { workspace: WORKSPACE })).toEqual(['files', 'shell', 'web']);
    expect(ids({ memory: true }, { workspace: WORKSPACE })).toEqual(['files', 'shell', 'web']);
  });

  it('leaves out what a key turns off', () => {
    expect(ids({ shell: false, web: false }, { workspace: WORKSPACE, memoryDir: MEMORY })).toEqual(['files', 'memory']);
    expect(ids({ files: false, memory: false }, { workspace: WORKSPACE, memoryDir: MEMORY })).toEqual(['shell', 'web']);
  });

  it('asks the search providers in the configuration key order', async () => {
    const duckFirst = standardCapabilities({ web: { search: { duckduckgo: true, brave: { apiKey: 'k' } } } }, { workspace: WORKSPACE });
    expect((await toolsOf(duckFirst, 'web')).get('web_search')!.description).toContain('(duckduckgo, then brave)');
    const tavilyFirst = standardCapabilities({ web: { search: { tavily: { apiKey: 'k' }, duckduckgo: true } } }, { workspace: WORKSPACE });
    expect((await toolsOf(tavilyFirst, 'web')).get('web_search')!.description).toContain('(tavily, then duckduckgo)');
    // Written but off: a provider that is not one, so no `web_search` at all.
    const none = standardCapabilities({ web: { search: { duckduckgo: false } } }, { workspace: WORKSPACE });
    expect([...(await toolsOf(none, 'web')).keys()]).toEqual(['web_fetch']);
  });

  it('has web_fetch alone for `web: true`, and the same files and shell either way', async () => {
    const capabilities = standardCapabilities({ web: true }, { workspace: WORKSPACE });
    expect([...(await toolsOf(capabilities, 'web')).keys()]).toEqual(['web_fetch']);
    expect([...(await toolsOf(capabilities, 'files')).keys()]).toEqual(['read_file', 'write_file', 'edit_file', 'list_files', 'search_files']);
    expect([...(await toolsOf(capabilities, 'shell')).keys()]).toEqual(['shell_exec']);
  });

  it('passes `files: { requireRead: false }` to files(), so an unread file can be written', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cofold-standard-'));
    try {
      const placed: CapabilityArgs = { ...args, workspace: folder };
      await writeFile(join(folder, 'unread.txt'), 'kept');
      const write = async (config: Parameters<typeof standardCapabilities>[0]) =>
        (await toolsOf(standardCapabilities(config, { workspace: folder }), 'files', placed)).get('write_file')!;
      expect(await (await write({ files: { requireRead: false } })).execute({ path: 'unread.txt', content: 'x' }, ctx)).toBe('replaced unread.txt (1 bytes)');
      expect(await readFile(join(folder, 'unread.txt'), 'utf8')).toBe('x');
      await writeFile(join(folder, 'unread-again.txt'), 'kept');
      await expect((await write({ files: true })).execute({ path: 'unread-again.txt', content: 'x' }, ctx)).rejects.toThrow('unread-again.txt was not read in this session');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('puts the memory files in the folder it is given', async () => {
    const write = (await toolsOf(standardCapabilities({}, { workspace: WORKSPACE, memoryDir: MEMORY }), 'memory')).get('memory_write')!;
    expect(write.writes!({ path: 'topics/a.md', content: '' })).toBe(`${MEMORY}/topics/a.md`);
    // The subject is relative to that folder, which is what a permission rule matches (decision CLI-04.6).
    expect(write.subject!({ path: 'topics/a.md', content: '' })).toBe('topics/a.md');
  });
});

describe('TOOLS_SCHEMA', () => {
  const valid = (value: unknown): SchemaResult => validateSchema({ schema: TOOLS_SCHEMA, value });

  it('takes the shapes a configuration file writes', () => {
    expect(valid({}).ok).toBe(true);
    expect(valid({ files: false, shell: true, memory: false }).ok).toBe(true);
    expect(valid({ files: true }).ok).toBe(true);
    expect(valid({ files: {} }).ok).toBe(true);
    expect(valid({ files: { requireRead: false } }).ok).toBe(true);
    expect(valid({ web: true }).ok).toBe(true);
    expect(valid({ web: false }).ok).toBe(true);
    expect(valid({ web: {} }).ok).toBe(true);
    expect(valid({ web: { search: { duckduckgo: true } } }).ok).toBe(true);
    expect(valid({ web: { search: { brave: { apiKey: 'k' }, tavily: { apiKey: 'k' }, duckduckgo: false } } }).ok).toBe(true);
  });

  it('refuses a search backend with no key, an unknown key, and a key of the wrong type', () => {
    // The refusal names the key the file wrote; `web` is checked whole, so an entry inside it reports at `$.web`.
    const noKey = valid({ web: { search: { brave: {} } } });
    expect(noKey.ok === false && noKey.issues).toEqual([{ path: '$.web', message: 'matches none of anyOf' }]);
    expect(valid({ web: { search: { brave: { apiKey: '' } } } }).ok).toBe(false);
    expect(valid({ web: { search: { google: true } } }).ok).toBe(false);
    expect(valid({ web: { search: { duckduckgo: 'yes' } } }).ok).toBe(false);
    expect(valid({ web: 'yes' }).ok).toBe(false);
    expect(valid({ files: 'yes' }).ok).toBe(false);
    expect(valid({ files: { requireRead: 1 } }).ok).toBe(false);
    expect(valid({ files: { other: true } }).ok).toBe(false);
    expect(valid({ memory: 'yes' }).ok).toBe(false);
    expect(valid({ unknown: true }).ok).toBe(false);
  });
});
