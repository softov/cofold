import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CapabilityArgs, Tool, ToolContext } from '@facio/agents';
import { createMemoryStore } from '@facio/agents';
import { DEFAULT_SHELL, execShell, shell } from './shell.js';

const WINDOWS = process.platform === 'win32';
const sleep = (s: number) => WINDOWS ? `Start-Sleep -Seconds ${s}` : `sleep ${s}`;
const store = createMemoryStore();
const kv = { agent: store.kv({ kind: 'agent', agentId: 't' }), shared: store.kv({ kind: 'shared', namespace: 'default' }) };
let workspace: string;
let tool: Tool<any, any>;
const ctxWith = (signal: AbortSignal): ToolContext => ({ agentId: 't', sessionId: 's', runId: 'r', callId: 'c', invocationId: 'i', signal, kv, resources: {} });
const argsFor = (workspace: string): CapabilityArgs => ({ agentId: 't', sessionId: 's', runId: 'r', workspace, kv, signal: new AbortController().signal });
const call = (input: unknown, signal = new AbortController().signal) => Promise.resolve(tool.execute(input, ctxWith(signal)));
const slashes = (path: string) => path.toLowerCase().replaceAll('\\', '/');

beforeAll(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'facio-shell-')));
  [tool] = await shell({ timeoutMs: 1500, maxOutputChars: 400 }).tools!(argsFor(workspace)) as [Tool<any, any>];
});
afterAll(() => rm(workspace, { recursive: true, force: true }));

describe('shell()', () => {
  it('names the shell in the description and the rules', async () => {
    const name = WINDOWS ? 'powershell' : 'sh';
    expect(tool.description).toContain(`one ${name} command`);
    expect(tool.description).toContain('1.5 s');
    expect(await shell().instructions!(argsFor(workspace))).toContain(`through ${name}`);
    expect(tool.effects).toEqual({ writes: true, destructive: true });
  });

  it('names the command as its subject for permission rules', () => {
    expect(tool.subject!({ command: 'rm -rf build', timeoutMs: 100 })).toBe('rm -rf build');
  });

  it('runs a command in the workspace and returns the exit code with stdout and stderr', async () => {
    expect(await call({ command: 'echo hello' })).toBe('exit 0\nhello');
    const pwd = await call({ command: WINDOWS ? 'Write-Output (Get-Location).Path' : 'pwd' }) as string;
    expect(slashes(pwd)).toContain(slashes(workspace));
    const failing = await call({ command: WINDOWS ? '[Console]::Error.WriteLine("bad"); exit 3' : 'echo bad >&2; exit 3' }) as string;
    expect(failing).toBe('exit 3\n--- stderr ---\nbad');
  });

  it('caps each stream with a marker', async () => {
    const result = await execShell({ shell: DEFAULT_SHELL, command: WINDOWS ? '"x" * 100' : 'printf "%0100d" 0', cwd: workspace, timeoutMs: 5000, maxOutputChars: 40 });
    expect(result.truncated).toBe(true);
    expect(result.stdout).toHaveLength(40 + '\n[output truncated]'.length);
    expect(result.stdout.endsWith('[output truncated]')).toBe(true);
  });

  it('kills at the timeout and says so', async () => {
    const started = Date.now();
    const result = await execShell({ shell: DEFAULT_SHELL, command: `echo before; ${sleep(20)}; echo after`, cwd: workspace, timeoutMs: 800, maxOutputChars: 1000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.stdout.trim()).toBe('before');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await call({ command: sleep(20), timeoutMs: 300 })).toBe('killed: timed out after 0.3 s');
  }, 15_000);

  it('kills when the run is cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    expect(await call({ command: sleep(20) }, controller.signal)).toBe('killed: the run was cancelled');
  }, 15_000);
});
