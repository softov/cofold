import { spawn, type ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import type { Capability, Tool } from '@doopx/agents';
import { createTool } from '@doopx/agents';
import type { ShellExecArgs, ShellExecInput, ShellOptions, ShellResult, ShellSpec } from './types/shell.js';
import { resolveWithin } from './paths.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT = 65_536;
const TRUNCATED = '\n[output truncated]';
const WINDOWS = process.platform === 'win32';

/** The shell of the platform (decision 4). */
export const DEFAULT_SHELL: ShellSpec = WINDOWS
  ? { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'] }
  : { command: 'sh', args: ['-c'] };

const rules = (shell: string) => [
  `shell_exec runs one command through ${shell} and returns when it ends; it is not a terminal session, so nothing (a cd, a variable) carries over to the next call. Chain what belongs together in one command.`,
  'Long-running or interactive commands hang until the timeout; pass flags that make them finish. Do not start servers or watchers.',
].join('\n');

/** The shell capability: `shell_exec`, one command at a time, killed at the timeout or when the run is cancelled. */
export function shell(options: ShellOptions = {}): Capability {
  const spec = options.shell ?? DEFAULT_SHELL;
  const maxTimeoutMs = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxTimeoutMs);
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
  const name = basename(spec.command).replace(/\.exe$/i, '');
  return {
    id: 'shell',
    instructions: () => rules(name),
    tools: (args) => [shellTool({ workspace: args.workspace ?? process.cwd(), spec, name, timeoutMs, maxTimeoutMs, maxOutputChars })],
  };
}

function shellTool(args: { workspace: string; spec: ShellSpec; name: string; timeoutMs: number; maxTimeoutMs: number; maxOutputChars: number }): Tool<any, any> {
  return createTool<ShellExecInput>({
    name: 'shell_exec',
    description: `Run one ${args.name} command in the workspace and get its exit code, stdout and stderr. Times out after ${args.timeoutMs / 1000} s unless told otherwise (${args.maxTimeoutMs / 1000} s at most).`,
    input: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1, description: `${args.name} syntax` },
        cwd: { type: 'string', description: 'Working directory, absolute or relative to the workspace; default the workspace' },
        timeoutMs: { type: 'integer', minimum: 1, maximum: args.maxTimeoutMs },
      },
      required: ['command'],
      additionalProperties: false,
    },
    effects: { writes: true, destructive: true },
    subject: (input) => input.command,
    execute: async (input, ctx) => {
      const timeoutMs = Math.min(input.timeoutMs ?? args.timeoutMs, args.maxTimeoutMs);
      const result = await execShell({
        shell: args.spec,
        command: input.command,
        cwd: resolveWithin(args.workspace, input.cwd ?? '.').absolute,
        timeoutMs,
        maxOutputChars: args.maxOutputChars,
        signal: ctx.signal,
      });
      return render(result, timeoutMs);
    },
  });
}

/** Runs one command and collects what it wrote; the process tree is killed at the timeout or on `signal`. */
export function execShell(args: ShellExecArgs): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.shell.command, [...args.shell.args, args.command], {
      cwd: args.cwd,
      windowsHide: true,
      // Its own process group on POSIX, so the kill reaches what the command started too.
      detached: !WINDOWS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let truncated = false;
    const append = (existing: string, chunk: Buffer) => {
      if (existing.endsWith(TRUNCATED)) return existing;
      const combined = existing + chunk.toString('utf8');
      if (combined.length <= args.maxOutputChars) return combined;
      truncated = true;
      return combined.slice(0, args.maxOutputChars) + TRUNCATED;
    };
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, args.timeoutMs);
    const onAbort = () => { aborted = true; killTree(child); };
    args.signal?.addEventListener('abort', onAbort, { once: true });
    if (args.signal?.aborted) onAbort();
    child.stdout!.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => { clearTimeout(timer); args.signal?.removeEventListener('abort', onAbort); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      args.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: timedOut || aborted ? null : code, timedOut, aborted, truncated });
    });
  });
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (WINDOWS) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

function render(result: ShellResult, timeoutMs: number): string {
  const head = result.aborted ? 'killed: the run was cancelled'
    : result.timedOut ? `killed: timed out after ${timeoutMs / 1000} s`
    : `exit ${result.exitCode}`;
  const out = result.stdout.trimEnd();
  const err = result.stderr.trimEnd();
  return [head, ...(out ? [out] : []), ...(err ? ['--- stderr ---', err] : [])].join('\n');
}
