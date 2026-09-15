<!--
Domain: tools
Status: Not started
Priority: High
Created: 2026-09-16
Revalidated: 2026-09-16
Dependencies: ../agent/01-harness-core.md (p3 shipped: createTool, capabilities, kv); ../cli/01-papo.md (Built: the program that turns them on)
Reference: none yet (this plan is the domain's first)
-->

# TOOLS-01 - `@facio/tools`: the tools every agent gets

_Status: Not started · Priority: High · Created: 2026-09-16_

## Goal

An agent on `@facio/agents` can read and change files, run a command, fetch and search the web, and keep notes across sessions, out of the box.
papo turns all of it on; the permission mode already decides what stops to ask.
Nothing here is a second registry or a second tool contract: every tool is `createTool`, every group is a `Capability`, and a search backend is a provider handed to the web capability.

## Reconnaissance

### Files read

- `packages/agents/src/types/tool.ts`, `capability.ts` - `createTool({ name, description, input, effects, execute(input, ctx) })`, `ToolContext { workspace? via kv, signal, resources }`, `Capability { id, tools?(args), instructions?(args) }` with `CapabilityArgs { workspace?, kv: { agent, shared, workspace? }, signal }`.
- `packages/agents/src/capabilities/skills.ts` - the shape to copy: an index in the instructions plus one tool; `read_skill` is the precedent for names (snake_case).
- `packages/papo/src/agent.ts` - `buildAgent` adds `createAskUserTool()` and the `skills` capability; the new capabilities go beside them, from `config.tools`.
- `F:\github\opendoop\plugins\windows-shell\windows-shell-connector.ts:86-128` - the one-shot runner to copy: `spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true })`, a timeout that kills, stdout/stderr appended under a byte cap with a `[output truncated]` marker, `{ stdout, stderr, exitCode, timedOut, truncated }`.
- `F:\github\opendoop\plugins\web-search\providers\{brave,tavily,duckduckgo}.ts` - three pure `fetch` functions returning `{ title, url, snippet }[]`; copied as the shipped search providers (facio takes no dependency on opendoop).
- `F:\github\opendoop\packages\sdk\src\provider\web-search.ts` - `WebSearchProvider { name, search(query, { maxResults }) }`: the same contract, renamed to facio's words.
- `pood/src/engine/terminals/*` - terminal *sessions* (pty, attach, wait modes); not this plan, which runs one command and returns.

### How the others name these tools (the model has seen all of them)

| | read | write | edit | list | search text | shell | fetch | search web | memory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `Read` | `Write` | `Edit` | `Glob` | `Grep` | `Bash` | `WebFetch` | `WebSearch` | (files under `~/.claude`, no tool) |
| Gemini CLI | `read_file` | `write_file` | `replace` | `glob`, `list_directory` | `search_file_content` | `run_shell_command` | `web_fetch` | `google_web_search` | `save_memory` |
| Codex / OpenAI | (patch) | `apply_patch` | `apply_patch` | | | `shell` | | `web_search` | |
| OpenCode | `read` | `write` | `edit` | `glob`, `list` | `grep` | `bash` | `webfetch` | | |
| Cline | `read_file` | `write_to_file` | `replace_in_file` | `list_files` | `search_files` | `execute_command` | | | |

Two families: PascalCase (Claude Code alone) and snake_case (everyone else, and the harness's own `ask_user`, `read_skill`). Both APIs accept `^[a-zA-Z0-9_-]{1,64}$`.

### Gaps

- `Not found: any file, shell, web or memory tool under packages/` - only `ask_user` and `read_skill` exist.
- `Not found: a search provider contract in facio` - written here.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Package `@facio/tools` in `packages/tools/`, zero runtime dependencies, depends on `@facio/agents` (and `@facio/sdk` for `JsonSchema`). Four capabilities: `files()`, `shell()`, `web()`, `memory()`; each contributes its tools and one instruction section | Capabilities are the harness's unit of "a group of tools plus what to tell the model about them" |
| 2 | Names, snake_case, verb_object: `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `shell_exec`, `web_fetch`, `web_search`, `memory_read`, `memory_write`. No `list_tools` (the model holds every definition in every request) and no `list_skills` (the skills index is in the instructions) | User (2026-09-16): `shell_exec` because it executes once, it is not a session; the rest follow the family the model sees most |
| 3 | Paths: any path, relative ones against the workspace; reads anywhere; writes inside the workspace follow the mode; a write or edit whose resolved path is outside the workspace asks unless the mode is `auto`. Done with `Tool.effects` (write/edit are `destructive`) plus a `Policy.requireApproval` papo installs that returns true for a write outside the workspace in `ask` and `destructive` | User: "there is a folder instruction, but you can mostly write everywhere" - Claude Code reads anywhere, edits in the cwd freely under its mode, asks outside it |
| 4 | `shell_exec({ command, cwd?, timeoutMs? })`: one command through `sh -c` on POSIX and `powershell.exe -NoProfile -NonInteractive -Command` on Windows, `cwd` defaulting to the workspace, timeout 120 s (max 600), stdout and stderr each capped at 64 KiB with a `[output truncated]` marker, result `exit <code>` header then the streams. Killed on the run's `signal`. The description names the shell so the model writes the right dialect. `effects.destructive` | The opendoop windows-shell runner, generalised |
| 5 | `read_file({ path, offset?, limit? })` returns numbered lines (`   12│text`), 2000 lines by default, refuses binary (NUL in the first 8 KiB); `write_file({ path, content })` creates parents; `edit_file({ path, old, new, all? })` requires `old` to occur exactly once unless `all`; `list_files({ pattern, cwd? })` is a glob over the workspace (`node:fs` `glob`, Node 22), `node_modules` and `.git` skipped unless named; `search_files({ pattern, path?, glob?, limit? })` is a regex over files with `file:line:text` rows, 200 rows by default | What the terminal agents converge on |
| 6 | `web_fetch({ url, maxBytes? })`: GET with a 20 s timeout, redirects followed, `text/html` reduced to text (tags stripped, scripts and styles dropped, whitespace folded), other text types verbatim, 256 KiB cap, `effects.network` | Zero deps: no readability library; good enough for docs pages |
| 7 | `web({ search? })`: `web_search({ query, count? })` exists only when at least one `SearchProvider { id, search({ query, count, signal }) }` is registered; the first answers, the next on a network error. Shipped providers: `brave({ apiKey })`, `tavily({ apiKey })`, `duckduckgo()` (HTML, no key, may break). papo's config `tools.web.search: { brave?: { apiKey }, tavily?: { apiKey }, duckduckgo?: true }` registers them in that order | User: "for a provider, something registrable that registers tools"; a tool the model cannot use must not be offered |
| 8 | `memory({ root })`: files under `<home>/memory/<workspace-slug>/`; `memory_read({ path? })` (no path: `MEMORY.md`), `memory_write({ path, content })`; the instructions section carries the first 200 lines of `MEMORY.md` every run, with the rule "write what will matter next session: decisions, preferences, facts about this project; one file per topic, indexed from MEMORY.md" | User: (a), the files; readable and editable by hand |
| 9 | papo: `config.tools { files: true, shell: true, web: { search?: ... }, memory: true }`, all on by default; `buildAgent` adds the capabilities that are on; the workspace-boundary policy of decision 3 is papo's `Policy` | The program decides what an agent gets; the harness stays silent |
| 10 | Every tool's output is a string the model reads; errors are thrown as plain `Error` with a sentence (the harness turns them into `isError` results) | Harness rule: a tool result is what the model sees |

## Proposed architecture

```
packages/tools/
  package.json  tsconfig.json  tsconfig.test.json  README.md
  src/
    index.ts                 files, shell, web, memory, brave, tavily, duckduckgo
    types/files.ts           FilesOptions
    types/shell.ts           ShellOptions, ShellResult
    types/web.ts             WebOptions, SearchProvider, SearchResult
    types/memory.ts          MemoryOptions
    paths.ts                 resolveWithin(workspace, path) -> { absolute, inside }
    files.ts                 files(): read_file, write_file, edit_file, list_files, search_files
    shell.ts                 shell(): shell_exec
    web.ts                   web(): web_fetch, web_search; html-to-text
    search/{brave,tavily,duckduckgo}.ts
    memory.ts                memory(): memory_read, memory_write, the index section
    *.test.ts                each tool against a temp dir; web against an injected fetch
packages/papo/src/types/config.ts   UPDATE: tools block
packages/papo/src/agent.ts          UPDATE: capabilities from config.tools; the workspace policy
packages/papo/src/config.ts         UPDATE: schema for tools
```

- **Import rules.** `@facio/tools` imports `@facio/agents` only; papo imports `@facio/tools`.
- **Effects.** `read_file`, `list_files`, `search_files`, `memory_read`: `{ reads }`; `write_file`, `edit_file`, `shell_exec`: `{ writes, destructive }`; `memory_write`: `{ writes }`; `web_*`: `{ network }`.

## Phases

### Task 1 - paths, files

- **Files:** `CREATE: packages/tools/{package.json,tsconfig.json,tsconfig.test.json,README.md}`, `src/types/files.ts`, `src/paths.ts`, `src/files.ts`, `src/files.test.ts`, `UPDATE: vitest.workspace.ts`.
- **Validation:** read with offset/limit and numbering; binary refused; write creates parents; edit refuses zero and two matches, replaces one, `all` replaces every; glob skips `node_modules`; search returns `file:line:text` and respects `limit`; a `../` path resolves outside and says so in `resolveWithin`.

### Task 2 - shell

- **Files:** `CREATE: src/types/shell.ts`, `src/shell.ts`, `src/shell.test.ts`.
- **Validation:** `echo` on both shells; exit code carried; timeout kills and reports `timedOut`; output capped with the marker; the run's abort signal kills the child.

### Task 3 - web

- **Files:** `CREATE: src/types/web.ts`, `src/web.ts`, `src/search/{brave,tavily,duckduckgo}.ts`, `src/web.test.ts` (injected `fetch`).
- **Validation:** HTML reduced to text; size cap; `web_search` absent with no provider, present with one; provider failover; each provider's response parsed from a fixture.

### Task 4 - memory

- **Files:** `CREATE: src/types/memory.ts`, `src/memory.ts`, `src/memory.test.ts`.
- **Validation:** empty memory contributes the rule only; `MEMORY.md` lines appear in the section; write then read round-trips; a path outside the memory root is refused.

### Task 5 - papo

- **Files:** `UPDATE: packages/papo/src/{types/config.ts,config.ts,agent.ts}`, `README.md`, `chat.test.ts` (an agent with `files` on reads a file in a temp workspace; `shell_exec` asks under `destructive` and runs under `auto`).
- **Validation:** `pnpm check`; a manual turn against LM Studio: "read package.json and tell me the name", "run git status".

## Risks and tradeoffs

- A 2B model with ten tools will call them badly; the descriptions carry the discipline (when to use `edit_file` over `write_file`, `search_files` before `read_file`).
- `duckduckgo()` scrapes HTML and will break; it is the no-key path, and it says so in its description.
- No sandbox: `shell_exec` is the user's shell with the user's rights, gated by the mode. Same as every terminal agent.

## Resume state

- **Done so far:** plan written 2026-09-16.
- **Next action:** Task 1.
- **Open questions:** none.
- **Watch out for:** Node 22's `fs.glob` is stable from 22.17; the package's `engines` says `>=22`, so the glob is written against `fs/promises` `glob` with a fallback walk if the runtime lacks it.

## Final verification checklist

- [ ] `pnpm check` green with the new package.
- [ ] papo turn against a real model reads a file and runs a command, asking under `destructive`.
- [ ] `index.md` updated.
