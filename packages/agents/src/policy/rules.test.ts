import type { RunInfo } from '../types/hooks.js';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from '../store/memory.js';
import { createTool } from '../tool/create-tool.js';
import { matchGlob, rules } from './rules.js';

const input = { type: 'object' as const, properties: { command: { type: 'string' as const } }, required: ['command'] };
const shell = createTool<{ command: string }>({ name: 'shell_exec', description: 'd', input, effects: { destructive: true }, subject: (i) => i.command, execute: () => '' });
const echo = createTool<{ command: string }>({ name: 'echo', description: 'd', input, execute: () => '' });
const rm = createTool({ name: 'rm', description: 'd', input: { type: 'object' }, effects: { destructive: true }, execute: () => '' });
const store = createMemoryStore();
const run: RunInfo = { runId: 'r', sessionId: 's', agentId: 'a', step: 1, kv: { agent: store.kv({ kind: 'agent', agentId: 'a' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) } };

describe('matchGlob', () => {
  it('* matches any run of characters, anchored to the whole subject', () => {
    expect(matchGlob('rm *', 'rm -rf /')).toBe(true);
    expect(matchGlob('rm *', 'ls')).toBe(false);
    expect(matchGlob('rm *', 'sudo rm -rf /')).toBe(false);
    expect(matchGlob('*', '')).toBe(true);
    expect(matchGlob('*.ts', 'src/a.ts')).toBe(true);
    expect(matchGlob('*.ts', 'src/a.tsx')).toBe(false);
  });

  it('? matches exactly one character', () => {
    expect(matchGlob('a?c', 'abc')).toBe(true);
    expect(matchGlob('a?c', 'ac')).toBe(false);
    expect(matchGlob('a?c', 'abbc')).toBe(false);
  });

  it('treats regex metacharacters in the pattern literally', () => {
    expect(matchGlob('src/(a|b).ts', 'src/(a|b).ts')).toBe(true);
    expect(matchGlob('src/(a|b).ts', 'src/a.ts')).toBe(false);
    expect(matchGlob('a.b', 'axb')).toBe(false);
    expect(matchGlob('[x]', '[x]')).toBe(true);
    expect(matchGlob('c:\dir\*', 'c:\dir\file')).toBe(true);
    expect(matchGlob('$HOME/*', '$HOME/x')).toBe(true);
  });

  it('an empty pattern matches only the empty subject; * spans newlines', () => {
    expect(matchGlob('', '')).toBe(true);
    expect(matchGlob('', 'x')).toBe(false);
    expect(matchGlob('echo *', 'echo a\nb')).toBe(true);
  });
});

describe('rules', () => {
  it('deny beats ask beats allow, whatever the list order', async () => {
    const policy = rules({
      allow: [{ tool: 'shell_exec' }],
      ask: [{ tool: 'shell_exec', match: 'git *' }],
      deny: [{ tool: 'shell_exec', match: 'rm *' }],
    });
    expect(await policy.decide({ tool: shell, input: { command: 'rm -rf /' }, run })).toEqual({ behavior: 'deny', reason: 'Denied by rule: shell_exec(rm *)' });
    expect(await policy.decide({ tool: shell, input: { command: 'git push' }, run })).toEqual({ behavior: 'ask' });
    expect(await policy.decide({ tool: shell, input: { command: 'ls' }, run })).toEqual({ behavior: 'allow' });
  });

  it('a rule without match refuses by name, and * names every tool', async () => {
    const byName = rules({ deny: [{ tool: 'shell_exec' }] });
    expect(await byName.decide({ tool: shell, input: { command: 'ls' }, run })).toEqual({ behavior: 'deny', reason: 'Denied by rule: shell_exec' });
    expect(await byName.decide({ tool: echo, input: { command: 'ls' }, run })).toEqual({ behavior: 'allow' });
    const every = rules({ ask: [{ tool: '*' }] });
    expect(await every.decide({ tool: echo, input: { command: 'ls' }, run })).toEqual({ behavior: 'ask' });
    expect(await every.decide({ tool: shell, input: { command: 'ls' }, run })).toEqual({ behavior: 'ask' });
  });

  it('a rule with match never matches a tool without a subject', async () => {
    const policy = rules({ deny: [{ tool: '*', match: '*' }, { tool: 'echo', match: 'ls' }] });
    expect(await policy.decide({ tool: echo, input: { command: 'ls' }, run })).toEqual({ behavior: 'allow' });
    expect(await policy.decide({ tool: shell, input: { command: 'ls' }, run })).toEqual({ behavior: 'deny', reason: 'Denied by rule: shell_exec(*)' });
  });

  it('calls otherwise with the same args when nothing matches', async () => {
    const otherwise = vi.fn(() => ({ behavior: 'deny' as const, reason: 'fallback' }));
    const policy = rules({ allow: [{ tool: 'shell_exec', match: 'ls' }], otherwise });
    const args = { tool: shell, input: { command: 'pwd' }, run };
    expect(await policy.decide(args)).toEqual({ behavior: 'deny', reason: 'fallback' });
    expect(otherwise).toHaveBeenCalledWith(args);
    expect(await policy.decide({ tool: shell, input: { command: 'ls' }, run })).toEqual({ behavior: 'allow' });
    expect(otherwise).toHaveBeenCalledTimes(1);
  });

  it('the default otherwise asks for a destructive tool and allows the rest', async () => {
    const policy = rules({});
    expect(await policy.decide({ tool: rm, input: {}, run })).toEqual({ behavior: 'ask' });
    expect(await policy.decide({ tool: echo, input: { command: 'ls' }, run })).toEqual({ behavior: 'allow' });
  });

  it('createTool keeps subject on the frozen tool', () => {
    expect(shell.subject?.({ command: 'ls -la' })).toBe('ls -la');
    expect(echo.subject).toBeUndefined();
  });
});
