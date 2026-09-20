import { describe, expect, it } from 'vitest';
import type { RunInfo } from '../types/hooks.js';
import type { PermissionMode, PermissionModeRules } from '../types/policy.js';
import { createMemoryStore } from '../store/memory.js';
import { createTool } from '../tool/create-tool.js';
import { policyOf } from './modes.js';

/*
 * A permission mode as the decision a run takes when no rule matches.
 *
 * The host supplies the two facts a mode cannot know: what an edit is and where the workspace
 * ends. These cases inject both, the way papo does with `write_file`/`edit_file` and
 * `resolveWithin`, and the way a host over a tool registry does with `effects.writes`.
 */

const input = { type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'] };
const read = createTool<{ path: string }>({ name: 'read_file', description: 'd', input, effects: { reads: true }, execute: () => '' });
const write = createTool<{ path: string }>({ name: 'write_file', description: 'd', input, effects: { writes: true }, execute: () => '' });
const web = createTool<{ path: string }>({ name: 'fetch', description: 'd', input, effects: { network: true }, execute: () => '' });
const destroy = createTool<{ path: string }>({ name: 'rm', description: 'd', input, effects: { destructive: true }, execute: () => '' });

const store = createMemoryStore();
const run: RunInfo = { runId: 'r', sessionId: 's', agentId: 'a', step: 1, kv: { agent: store.kv({ kind: 'agent', agentId: 'a' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) } };

/** What papo passes: its own two file tools, and the workspace as the CLI knows it. */
const rules: PermissionModeRules = {
  inside: (path) => path.startsWith('/work'),
  isEdit: (tool) => tool.name === 'write_file' || tool.name === 'edit_file',
};

const decide = async (mode: PermissionMode, tool: typeof read, path = '/work/a.txt'): Promise<string> =>
  (await policyOf(mode, rules)({ tool, input: { path }, run })).behavior;

describe('policyOf', () => {
  it('asks on writes, destruction and the network, and allows a read', async () => {
    expect(await decide('default', read)).toBe('allow');
    expect(await decide('default', write)).toBe('ask');
    expect(await decide('default', web)).toBe('ask');
    expect(await decide('default', destroy)).toBe('ask');
  });

  it('acceptEdits lets an edit inside the workspace through and asks for one outside it', async () => {
    expect(await decide('acceptEdits', write, '/work/a.txt')).toBe('allow');
    expect(await decide('acceptEdits', write, '/elsewhere/a.txt')).toBe('ask');
    // A tool the host does not call an edit is decided by its effects as before.
    expect(await decide('acceptEdits', web)).toBe('ask');
    expect(await decide('acceptEdits', read)).toBe('allow');
  });

  it('plan refuses a change and lets a read through', async () => {
    expect(await decide('plan', read)).toBe('allow');
    expect(await decide('plan', write)).toBe('deny');
    expect(await decide('plan', destroy)).toBe('deny');
  });

  it('auto asks only about a destructive tool, which is the harness default', async () => {
    expect(await decide('auto', read)).toBe('allow');
    expect(await decide('auto', write)).toBe('allow');
    expect(await decide('auto', web)).toBe('allow');
    expect(await decide('auto', destroy)).toBe('ask');
  });

  it('bypassPermissions allows everything and dontAsk refuses what would have asked', async () => {
    expect(await decide('bypassPermissions', read)).toBe('allow');
    expect(await decide('bypassPermissions', write)).toBe('allow');
    expect(await decide('bypassPermissions', destroy)).toBe('allow');
    expect(await decide('dontAsk', read)).toBe('allow');
    expect(await decide('dontAsk', write)).toBe('deny');
    expect(await decide('dontAsk', destroy)).toBe('deny');
  });

  it('names the tool and the mode in a plan or dontAsk refusal', async () => {
    expect(await policyOf('plan', rules)({ tool: write, input: { path: '/work/a.txt' }, run }))
      .toEqual({ behavior: 'deny', reason: 'write_file would change something and the mode is plan' });
    expect(await policyOf('dontAsk', rules)({ tool: write, input: { path: '/work/a.txt' }, run }))
      .toEqual({ behavior: 'deny', reason: 'write_file would need approval and the mode is dontAsk' });
  });
});
