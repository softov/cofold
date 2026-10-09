# @cofold/tools

[![npm](https://img.shields.io/npm/v/%40cofold%2Ftools)](https://www.npmjs.com/package/@cofold/tools)
[![CI](https://github.com/softov/cofold/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/cofold/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

The tools every agent on `@cofold/agents` gets, as capabilities: files, shell, web and memory.
Each capability is a `Capability` (its tools plus one instructions section), every tool is `createTool`, and nothing here is a second registry.
Zero dependencies beyond `node:fs`, `node:path` and `node:child_process`.

## Use

```ts
import { createAgent } from '@cofold/agents';
import { brave, files, shell, web } from '@cofold/tools';

const agent = createAgent({ id: 'cli', instructions, model, store, capabilities: [files(), shell(), web({ search: [brave({ apiKey })] })] });
```

## `standardCapabilities(config, { workspace, memoryDir? })`

A program that keeps its tools section in a file hands the object it read here and gets the capabilities back, in the order files, shell, web, memory.
`ToolsConfig` is the section's shape and `TOOLS_SCHEMA` its JSON Schema; the file, its path and its environment variables are the program's, and nothing here reads one.
An absent key is on, so `{}` is files, shell and web; `workspace` names the run's folder, which the file and shell capabilities read from the run itself when they execute, not from here.

| Key | What it builds |
| --- | --- |
| `files` | `files()`, on when absent; `{ requireRead: false }` turns the read-before-write refusal off |
| `shell` | `shell()`, on when absent |
| `web` | `web()` (`web_fetch` alone) when `true`, on when absent; `{ search }` adds `web_search` over those providers, asked in the key order the section writes them |
| `memory` | `memory({ dir: memoryDir })`, on when absent but only when a `memoryDir` is given; no folder, no memory |

```ts
import { standardCapabilities, TOOLS_SCHEMA } from '@cofold/tools';
import type { ToolsConfig } from '@cofold/tools';

// The program reads its own file: `tools` is checked against TOOLS_SCHEMA, in practice inside the program's own schema.
const read: { tools: ToolsConfig } = JSON.parse(text);

const capabilities = standardCapabilities(read.tools, {
  workspace,                                        // the run's folder, as the session records it
  memoryDir: join(home, 'memory', slug),            // the program's choice (papo: `<home>/memory/<workspace slug>`)
});
```

## `files()`

Relative paths resolve against the run's workspace (`SessionRecord.workspace`; `process.cwd()` when the session has none).
Reads go anywhere; `write_file` and `edit_file` declare `effects.destructive`, so the default policy asks before them, and `resolveWithin(workspace, path).inside` is what a program's policy reads to ask only outside the workspace. `inside` compares real paths: a symlink in the workspace that points out of it is outside, and a path that does not exist yet is judged by its nearest existing ancestor.

| Tool | Input | Returns | Subject, `writes` |
| --- | --- | --- | --- |
| `read_file` | `path`, `offset?` (1-based), `limit?` | Numbered lines (`  12│text`), 2000 at a time; a trailer says how many are left. Binary files are refused, lines cut at 2000 characters. | the resolved path |
| `write_file` | `path`, `content` | `created` or `replaced`, with the byte count; folders are made. | the resolved path; `writes` it too |
| `edit_file` | `path`, `old`, `new`, `all?` | Replaces `old`, which must occur exactly once unless `all`; zero or several occurrences are refused with the count. | the resolved path; `writes` it too |
| `list_files` | `pattern`, `cwd?` | One entry per line, folders with a trailing `/`; `node_modules` and `.git` skipped unless the pattern names them; 1000 entries at most. | the `pattern` |
| `search_files` | `pattern` (regex), `path?`, `glob?`, `ignoreCase?`, `limit?` | `file:line:text` rows, 200 by default; binary files and files over 2 MiB skipped. | the `pattern` |

`files({ maxLines, maxMatches, requireRead })` changes the two defaults and the read-before-write refusal.
Every result is the text the model reads; every refusal is a thrown `Error` with one sentence, which the harness turns into an `isError` result.
For `rules()` (`@cofold/agents`), a path tool names the resolved path as its subject: relative to the workspace with forward slashes when inside it (`src/a.ts`, whatever spelling the model used), absolute when outside, so a rule such as `{ tool: 'edit_file', match: 'src/*' }` cannot be slipped past with `./` or `..`.
`write_file` and `edit_file` also declare `writes(input)`, that same absolute path, which is how a host's `acceptEdits` tells an edit from a call that has to ask; the three read-only tools declare none.
The subject is the string `tool.proposed` carries, so a host draws the path of a call it is about to be asked about.

`write_file` and `edit_file` resolve the path again when they run and write through the descriptor they open: an existing file is refused unless the descriptor is the file at the real path `resolveWithin` returns (`real`), and a new file is opened exclusively, so a link put at the name in between fails the open instead of being followed.
A write or an edit to an existing file is refused unless the session read it with `read_file` and its `mtime` and size have not changed since; the tool's own write counts as a read. The record is per session id and lasts the process, so after a restart a file is read again before it is changed. A new file needs no read.
`requireRead: false` turns that refusal off, so a write replaces a file the session never read or one that changed under it; reads are still recorded, and the check that the descriptor opened is the file at the resolved path stays on either way.

## `shell()`

`shell_exec({ command, cwd?, timeoutMs? })` runs one command through the platform's shell (`sh -c`; `powershell.exe -NoProfile -NonInteractive -Command` on Windows) in the workspace and returns `exit <code>`, stdout, then stderr under a `--- stderr ---` line.
It is one execution, not a session: nothing carries over between calls, and the instructions section tells the model so.
At the timeout (120 s by default, 600 s at most) or when the run is cancelled, the whole process tree is killed and the result says `killed: timed out after 30 s` or `killed: the run was cancelled`; each stream is cut at 64 Ki characters with `[output truncated]`.
`effects: { writes, destructive }`, so the default policy asks before every command; its subject for `rules()` is the `command` (`{ tool: 'shell_exec', match: 'rm *' }`).
It declares no `writes`: a command writes no single named file, so `acceptEdits` falls back to its effects and asks.

`shell({ timeoutMs, maxTimeoutMs, maxOutputChars, shell: { command, args } })` changes the defaults or the shell (`{ command: 'pwsh', args: ['-NoProfile', '-Command'] }`, `{ command: 'bash', args: ['-c'] }`).
`execShell(args)` is the runner on its own, for a program that wants the `ShellResult` rather than the text.

## `web({ search? })`

`web_fetch({ url, maxBytes? })` GETs one http(s) URL, follows up to 10 redirects, and returns `<final url> (<status>, <type>)` then the body: HTML reduced to its text (`htmlToText`: title first, scripts and styles gone, block ends as line breaks, entities decoded), JSON and other text types verbatim, anything else refused.
The body is cut at 256 KiB (`[cut at N bytes]`), the request at 20 s; `web({ timeoutMs, maxBytes, fetch })` changes them, `fetch` being the function to use (a test injects one).
A host that is, or resolves to, a loopback, private or link-local address (IPv4-mapped IPv6 included) is refused before the request, and so is every redirect's `Location`; `web({ lookup })` replaces the resolver, `node:dns/promises` `lookup` with `all: true` by default. A name that answers differently at the connection than at the check (DNS rebinding) is not caught.

`web_search({ query, count? })` exists only when `search` names at least one `SearchProvider { id, search({ query, count, signal }) }`; providers are asked in order and the first that answers wins, so a rate-limited key falls through to the next.
Results are `1. title / url / snippet` rows.
Shipped providers: `brave({ apiKey })` (https://brave.com/search/api/), `tavily({ apiKey })` (https://tavily.com; its answer comes first), `duckduckgo()` (the HTML results page scraped, no key, breaks the day the page changes).
Both tools declare `effects.network` only and no `writes`, and each names its subject for `rules()`: `web_fetch` the URL as it was asked for, before it is parsed, and `web_search` the query, so `{ tool: 'web_fetch', match: 'https://docs.example/*' }` denies one host and lets another through.

## `memory({ dir })`

Files under `dir`, which the program chooses (papo: `<home>/memory/<workspace slug>`), readable and editable by hand.
`memory_read({ path? })` returns one file, `MEMORY.md` without a path; `memory_write({ path, content })` writes one, folders made.
Both refuse a path that leaves the folder.
The instructions section carries the first 200 lines of `MEMORY.md` every run (`indexLines` changes that) under the rule: write what will matter next session, one file per topic, indexed from `MEMORY.md`.
Both name their subject for `rules()`: the file relative to the memory folder with forward slashes (`MEMORY.md` when `memory_read` names none), absolute when the path leaves the folder, as a path tool's does.
`memory_write` declares `writes` with that absolute path as well; `memory_read` writes none.
`memory_write` declares `effects.writes` only, so the harness's own default decision (`DEFAULT_DECIDE`, which asks about destructive tools) does not ask; a mode that asks before a write does, and under `acceptEdits` the memory folder is outside the workspace, so its `writes` cannot let the call through.
