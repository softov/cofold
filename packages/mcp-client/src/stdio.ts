import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { JsonRpcMessage, McpStdioServer, Transport } from './types.js';

/** How many of the server's last stderr lines a failure quotes. */
const STDERR_KEPT = 20;

/**
 * A server as a child process: one JSON-RPC message per line on its stdin and stdout. Its stderr is the server's
 * log; the last lines are kept and quoted when it fails, rather than shown as they come.
 */
export function createStdioTransport(server: McpStdioServer, options: { warn?(message: string): void } = {}): Transport & { stderr(): string } {
  let child: ChildProcess | undefined;
  const stderr: string[] = [];
  let ended = false;
  return {
    stderr: () => stderr.join('\n'),
    async start(handlers) {
      const env = { ...process.env, ...server.env };
      const { command, args, shell } = launchOf(server.command, server.args ?? [], env);
      const started = spawn(command, args, { env, ...(server.cwd !== undefined ? { cwd: server.cwd } : {}), stdio: ['pipe', 'pipe', 'pipe'], shell, windowsHide: true });
      child = started;
      const closed = (reason: string): void => {
        if (ended) return;
        ended = true;
        const tail = stderr.slice(-3).join(' / ');
        handlers.closed(tail !== '' ? `${reason}: ${tail}` : reason);
      };
      await new Promise<void>((resolve, reject) => {
        started.once('spawn', () => resolve());
        started.once('error', (error) => { reject(error); closed(error.message); });
      });
      started.on('error', (error) => closed(error.message));
      started.on('exit', (code, signal) => closed(signal !== null ? `exited on ${signal}` : `exited with ${code ?? 0}`));
      lines(started.stdout!, (line) => {
        if (line.trim() === '') return;
        let message: JsonRpcMessage;
        try { message = JSON.parse(line) as JsonRpcMessage; } catch { options.warn?.(`not a message on stdout: ${line.slice(0, 120)}`); return; }
        handlers.message(message);
      });
      lines(started.stderr!, (line) => {
        stderr.push(line);
        if (stderr.length > STDERR_KEPT) stderr.shift();
      });
      started.stdin!.on('error', () => {});
    },
    send(message) {
      const stdin = child?.stdin;
      if (stdin === undefined || stdin === null || ended) return Promise.reject(new Error('the server is not running'));
      return new Promise<void>((resolve, reject) => {
        stdin.write(`${JSON.stringify(message)}\n`, (error) => (error ? reject(error) : resolve()));
      });
    },
    async close() {
      const running = child;
      if (running === undefined || running.exitCode !== null || running.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => running.once('exit', () => resolve()));
      running.stdin?.end();
      const timer = setTimeout(() => running.kill(), 2000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Calls `each` with every whole line of a stream, decoded as UTF-8. */
function lines(stream: NodeJS.ReadableStream, each: (line: string) => void): void {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  stream.on('data', (chunk: Buffer) => {
    pending += decoder.write(chunk);
    for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
      each(pending.slice(0, at).replace(/\r$/, ''));
      pending = pending.slice(at + 1);
    }
  });
  stream.on('end', () => { if (pending !== '') each(pending); });
}

/**
 * What to spawn. On Windows a bare `npx` is `npx.cmd`, found through `PATH` and `PATHEXT`; a `.cmd` or `.bat` runs
 * through the shell, which Node requires, with each argument quoted.
 */
export function launchOf(command: string, args: string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
  if (platform !== 'win32') return { command, args, shell: false };
  const found = extname(command) === '' ? findOnPath(command, env) : command;
  const resolved = found ?? command;
  if (!/\.(cmd|bat)$/i.test(resolved)) return { command: resolved, args, shell: false };
  return { command: quoted(resolved), args: args.map(quoted), shell: true };
}

/** `command` with the first `PATHEXT` extension that names a file in a `PATH` folder; Windows separates folders with `;`. */
function findOnPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const extensions = (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((one) => one !== '');
  const folders = isAbsolute(command) ? [''] : (env['PATH'] ?? env['Path'] ?? '').split(';').filter((one) => one !== '');
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = folder === '' ? `${command}${extension}` : join(folder, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function quoted(text: string): string {
  return /[\s"&|<>^]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
