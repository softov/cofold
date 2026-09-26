# @cofold/tools

The tools every agent on `@cofold/agents` gets, as capabilities: files, shell, web and memory.
Each capability is a `Capability` (its tools plus one instructions section), every tool is `createTool`, and nothing here is a second registry.
Zero dependencies beyond `node:fs`, `node:path` and `node:child_process`.

## Use

```ts
import { createAgent } from '@cofold/agents';
import { brave, files, shell, web } from '@cofold/tools';

const agent = createAgent({ id: 'cli', instructions, model, store, capabilities: [files(), shell(), web({ search: [brave({ apiKey })] })] });
```

## `files()`

Relative paths resolve against the run's workspace (`SessionRecord.workspace`; `process.cwd()` when the session has none).
Reads go anywhere; `write_file` and `edit_file` declare `effects.destructive`, so the default policy asks before them, and `resolveWithin(workspace, path).inside` is what a program's policy reads to ask only outside the workspace. `inside` compares real paths: a symlink in the workspace that points out of it is outside, and a path that does not exist yet is judged by its nearest existing ancestor.

| Tool | Input | Returns |
| --- | --- | --- |
| `read_file` | `path`, `offset?` (1-based), `limit?` | Numbered lines (`  12│text`), 2000 at a time; a trailer says how many are left. Binary files are refused, lines cut at 2000 characters. |
| `write_file` | `path`, `content` | `created` or `replaced`, with the byte count; folders are made. |
| `edit_file` | `path`, `old`, `new`, `all?` | Replaces `old`, which must occur exactly once unless `all`; zero or several occurrences are refused with the count. |
| `list_files` | `pattern`, `cwd?` | One entry per line, folders with a trailing `/`; `node_modules` and `.git` skipped unless the pattern names them; 1000 entries at most. |
| `search_files` | `pattern` (regex), `path?`, `glob?`, `ignoreCase?`, `limit?` | `file:line:text` rows, 200 by default; binary files and files over 2 MiB skipped. |

`files({ maxLines, maxMatches })` changes the two defaults.
Every result is the text the model reads; every refusal is a thrown `Error` with one sentence, which the harness turns into an `isError` result.
For `rules()` (`@cofold/agents`), `read_file`, `write_file` and `edit_file` name the resolved path as their subject: relative to the workspace with forward slashes when inside it (`src/a.ts`, whatever spelling the model used), absolute when outside, so a rule such as `{ tool: 'edit_file', match: 'src/*' }` cannot be slipped past with `./` or `..`; `list_files` and `search_files` name the `pattern`; the memory and web tools declare none and match by name only.

## `shell()`

`shell_exec({ command, cwd?, timeoutMs? })` runs one command through the platform's shell (`sh -c`; `powershell.exe -NoProfile -NonInteractive -Command` on Windows) in the workspace and returns `exit <code>`, stdout, then stderr under a `--- stderr ---` line.
It is one execution, not a session: nothing carries over between calls, and the instructions section tells the model so.
At the timeout (120 s by default, 600 s at most) or when the run is cancelled, the whole process tree is killed and the result says `killed: timed out after 30 s` or `killed: the run was cancelled`; each stream is cut at 64 Ki characters with `[output truncated]`.
`effects: { writes, destructive }`, so the default policy asks before every command; its subject for `rules()` is the `command` (`{ tool: 'shell_exec', match: 'rm *' }`).

`shell({ timeoutMs, maxTimeoutMs, maxOutputChars, shell: { command, args } })` changes the defaults or the shell (`{ command: 'pwsh', args: ['-NoProfile', '-Command'] }`, `{ command: 'bash', args: ['-c'] }`).
`execShell(args)` is the runner on its own, for a program that wants the `ShellResult` rather than the text.

## `web({ search? })`

`web_fetch({ url, maxBytes? })` GETs one http(s) URL, follows up to 10 redirects, and returns `<final url> (<status>, <type>)` then the body: HTML reduced to its text (`htmlToText`: title first, scripts and styles gone, block ends as line breaks, entities decoded), JSON and other text types verbatim, anything else refused.
The body is cut at 256 KiB (`[cut at N bytes]`), the request at 20 s; `web({ timeoutMs, maxBytes, fetch })` changes them, `fetch` being the function to use (a test injects one).
A host that is, or resolves to, a loopback, private or link-local address (IPv4-mapped IPv6 included) is refused before the request, and so is every redirect's `Location`; `web({ lookup })` replaces the resolver, `node:dns/promises` `lookup` with `all: true` by default. A name that answers differently at the connection than at the check (DNS rebinding) is not caught.

`web_search({ query, count? })` exists only when `search` names at least one `SearchProvider { id, search({ query, count, signal }) }`; providers are asked in order and the first that answers wins, so a rate-limited key falls through to the next.
Results are `1. title / url / snippet` rows.
Shipped providers: `brave({ apiKey })` (https://brave.com/search/api/), `tavily({ apiKey })` (https://tavily.com; its answer comes first), `duckduckgo()` (the HTML results page scraped, no key, breaks the day the page changes).
Both tools declare `effects.network` only.

## `memory({ dir })`

Files under `dir`, which the program chooses (papo: `<home>/memory/<workspace slug>`), readable and editable by hand.
`memory_read({ path? })` returns one file, `MEMORY.md` without a path; `memory_write({ path, content })` writes one, folders made.
Both refuse a path that leaves the folder.
The instructions section carries the first 200 lines of `MEMORY.md` every run (`indexLines` changes that) under the rule: write what will matter next session, one file per topic, indexed from `MEMORY.md`.
`memory_write` declares `effects.writes` only, so the default policy does not ask.
