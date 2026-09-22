import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CapabilityArgs, Tool, ToolContext } from '@doopx/agents';
import { createMemoryStore } from '@doopx/agents';
import { memory } from './memory.js';

const store = createMemoryStore();
const kv = { agent: store.kv({ kind: 'agent', agentId: 't' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) };
const signal = new AbortController().signal;
const ctx: ToolContext = { agentId: 't', sessionId: 's', runId: 'r', callId: 'c', invocationId: 'i', signal, kv, resources: {} };
const args: CapabilityArgs = { agentId: 't', sessionId: 's', runId: 'r', kv, signal };
let dir: string;
let tools: Map<string, Tool<any, any>>;
const call = (name: string, input: unknown) => Promise.resolve(tools.get(name)!.execute(input, ctx));

beforeAll(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'doopx-memory-')), 'memory', 'ws');
  tools = new Map((await memory({ dir, indexLines: 2 }).tools!(args)).map((t) => [t.name, t]));
});
afterAll(() => rm(join(dir, '..', '..'), { recursive: true, force: true }));

describe('memory()', () => {
  it('contributes the rule alone while the memory is empty, and both tools', async () => {
    expect(await memory({ dir }).instructions!(args)).toMatch(/^You have a memory[\s\S]*MEMORY\.md is empty\.$/);
    expect([...tools.keys()]).toEqual(['memory_read', 'memory_write']);
    expect(tools.get('memory_read')!.effects).toEqual({ reads: true });
    expect(tools.get('memory_write')!.effects).toEqual({ writes: true });
    expect(await call('memory_read', {})).toBe('memory is empty');
    expect(await call('memory_read', { path: 'topics/x.md' })).toBe('no memory file topics/x.md');
  });

  it('write then read round-trips, makes folders, and the index head appears in the section', async () => {
    expect(await call('memory_write', { path: 'topics/build.md', content: 'pnpm check runs everything\n' })).toBe('wrote topics/build.md (27 bytes)');
    expect(await call('memory_read', { path: 'topics/build.md' })).toBe('pnpm check runs everything\n');
    await call('memory_write', { path: 'MEMORY.md', content: '# Memory\n- [build](topics/build.md) - how to check\n- third line\n' });
    expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toContain('[build]');
    const section = await memory({ dir, indexLines: 2 }).instructions!(args);
    expect(section).toContain('# Memory\n- [build](topics/build.md) - how to check\n[1 more lines; memory_read() has them all]');
    expect(await memory({ dir }).instructions!(args)).not.toContain('more lines');
  });

  it('refuses a path outside the memory folder', async () => {
    await writeFile(join(dir, '..', 'secret.md'), 'no');
    await expect(call('memory_read', { path: '../secret.md' })).rejects.toThrow('../secret.md is outside the memory folder');
    await expect(call('memory_write', { path: join(dir, '..', 'other.md'), content: 'x' })).rejects.toThrow('is outside the memory folder');
  });
});
