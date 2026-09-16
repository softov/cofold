export interface ShellOptions {
  /** Milliseconds a command may run when the call gives no `timeoutMs`; default 120 000, never above `maxTimeoutMs`. */
  timeoutMs?: number;
  /** The ceiling for any call's `timeoutMs`; default 600 000. */
  maxTimeoutMs?: number;
  /** Characters kept of each stream before `[output truncated]`; default 65 536. */
  maxOutputChars?: number;
  /** The shell to run commands through; default `sh -c` on POSIX and `powershell.exe -NoProfile -NonInteractive -Command` on Windows. */
  shell?: ShellSpec;
}

/** A shell as a program plus the arguments that precede the command text. */
export interface ShellSpec {
  command: string;
  args: string[];
}

export interface ShellExecInput {
  command: string;
  /** Working directory, absolute or relative to the workspace; default the workspace. */
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellExecArgs {
  shell: ShellSpec;
  command: string;
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
  signal?: AbortSignal;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  /** null when the process was killed (timeout, abort). */
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}
