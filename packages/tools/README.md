# @facio/tools

The tools every agent on `@facio/agents` gets, as capabilities: files and shell today; web and memory follow (TOOLS-01).
Each capability is a `Capability` (its tools plus one instructions section), every tool is `createTool`, and nothing here is a second registry.
Zero dependencies beyond `node:fs`, `node:path` and `node:child_process`.

## Use

```ts
import { createAgent } from '@facio/agents';
import { files, shell } from '@facio/tools';

const agent = createAgent({ id: 'cli', instructions, model, store, capabilities: [files(), shell()] });
```

## `files()`

Relative paths resolve against the run's workspace (`SessionRecord.workspace`; `process.cwd()` when the session has none).
Reads go anywhere; `write_file` and `edit_file` declare `effects.destructive`, so the default policy asks before them, and `resolveWithin(workspace, path).inside` is what a program's policy reads to ask only outside the workspace.

| Tool | Input | Returns |
| --- | --- | --- |
| `read_file` | `path`, `offset?` (1-based), `limit?` | Numbered lines (`  12│text`), 2000 at a time; a trailer says how many are left. Binary files are refused, lines cut at 2000 characters. |
| `write_file` | `path`, `content` | `created` or `replaced`, with the byte count; folders are made. |
| `edit_file` | `path`, `old`, `new`, `all?` | Replaces `old`, which must occur exactly once unless `all`; zero or several occurrences are refused with the count. |
| `list_files` | `pattern`, `cwd?` | One entry per line, folders with a trailing `/`; `node_modules` and `.git` skipped unless the pattern names them; 1000 entries at most. |
| `search_files` | `pattern` (regex), `path?`, `glob?`, `ignoreCase?`, `limit?` | `file:line:text` rows, 200 by default; binary files and files over 2 MiB skipped. |

`files({ maxLines, maxMatches })` changes the two defaults.
Every result is the text the model reads; every refusal is a thrown `Error` with one sentence, which the harness turns into an `isError` result.

## `shell()`

`shell_exec({ command, cwd?, timeoutMs? })` runs one command through the platform's shell (`sh -c`; `powershell.exe -NoProfile -NonInteractive -Command` on Windows) in the workspace and returns `exit <code>`, stdout, then stderr under a `--- stderr ---` line.
It is one execution, not a session: nothing carries over between calls, and the instructions section tells the model so.
At the timeout (120 s by default, 600 s at most) or when the run is cancelled, the whole process tree is killed and the result says `killed: timed out after 30 s` or `killed: the run was cancelled`; each stream is cut at 64 Ki characters with `[output truncated]`.
`effects: { writes, destructive }`, so the default policy asks before every command.

`shell({ timeoutMs, maxTimeoutMs, maxOutputChars, shell: { command, args } })` changes the defaults or the shell (`{ command: 'pwsh', args: ['-NoProfile', '-Command'] }`, `{ command: 'bash', args: ['-c'] }`).
`execShell(args)` is the runner on its own, for a program that wants the `ShellResult` rather than the text.
