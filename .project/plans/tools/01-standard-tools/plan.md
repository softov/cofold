---
title: TOOLS-01 - `@cofold/tools`: the tools every agent gets
domain: tools
status: built
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/agent/01-harness-core/plan.md
  - plans/cli/01-papo/plan.md
---

# TOOLS-01 - `@cofold/tools`: the tools every agent gets

## Goal

An agent on `@cofold/agents` can read and change files, run a command, fetch and search the web, and keep notes across sessions, out of the box.
papo turns all of it on; the permission mode already decides what stops to ask.
Nothing here is a second registry or a second tool contract: every tool is `createTool`, every group is a `Capability`, and a search backend is a provider handed to the web capability.

## Reconnaissance

### Files read

- `packages/agents/src/types/tool.ts`, `capability.ts` - `createTool({ name, description, input, effects, execute(input, ctx) })`, `ToolContext { workspace? via kv, signal, resources }`, `Capability { id, tools?(args), instructions?(args) }` with `CapabilityArgs { workspace?, kv: { agent, shared, workspace? }, signal }`.
- `packages/agents/src/capabilities/skills.ts` - the shape to copy: an index in the instructions plus one tool; `read_skill` is the precedent for names (snake_case).
- `packages/papo/src/agent.ts` - `buildAgent` adds `createAskUserTool()` and the `skills` capability; the new capabilities go beside them, from `config.tools`.
- `F:\github\opendoop\plugins\windows-shell\windows-shell-connector.ts:86-128` - the one-shot runner to copy: `spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true })`, a timeout that kills, stdout/stderr appended under a byte cap with a `[output truncated]` marker, `{ stdout, stderr, exitCode, timedOut, truncated }`.
- `F:\github\opendoop\plugins\web-search\providers\{brave,tavily,duckduckgo}.ts` - three pure `fetch` functions returning `{ title, url, snippet }[]`; copied as the shipped search providers (cofold takes no dependency on opendoop).
- `F:\github\opendoop\packages\sdk\src\provider\web-search.ts` - `WebSearchProvider { name, search(query, { maxResults }) }`: the same contract, renamed to cofold's words.
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
- `Not found: a search provider contract in cofold` - written here.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Package `@cofold/tools` in `packages/tools/`, zero runtime dependencies, depends on `@cofold/agents` (and `@cofold/sdk` for `JsonSchema`). Four capabilities: `files()`, `shell()`, `web()`, `memory()`; each contributes its tools and one instruction section | Capabilities are the harness's unit of "a group of tools plus what to tell the model about them" |
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

- **Import rules.** `@cofold/tools` imports `@cofold/agents` only; papo imports `@cofold/tools`.
- **Effects.** `read_file`, `list_files`, `search_files`, `memory_read`: `{ reads }`; `write_file`, `edit_file`, `shell_exec`: `{ writes, destructive }`; `memory_write`: `{ writes }`; `web_*`: `{ network }`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - paths, files](task-01-paths-files.md) | done | - |
| [02 - shell](task-02-shell.md) | done | 01 |
| [03 - web](task-03-web.md) | done | 02 |
| [04 - memory](task-04-memory.md) | done | 03 |
| [05 - papo](task-05-papo.md) | done | 04 |

## Risks and tradeoffs

- A 2B model with ten tools will call them badly; the descriptions carry the discipline (when to use `edit_file` over `write_file`, `search_files` before `read_file`).
- `duckduckgo()` scrapes HTML and will break; it is the no-key path, and it says so in its description.
- No sandbox: `shell_exec` is the user's shell with the user's rights, gated by the mode. Same as every terminal agent.

## Resume state

- **Done so far:** plan written 2026-09-16; Task 1 built 2026-09-16 (`packages/tools`: `files()`, `resolveWithin`, `displayPath`; 7 tests). `search_files` also takes `ignoreCase`; `read_file` cuts lines at 2000 characters. Task 2 built 2026-09-16 (`shell()`, `execShell`, `DEFAULT_SHELL`; the kill reaches the process tree: a process group on POSIX, `taskkill /t` on Windows; `shell.shell` option chooses another shell; 5 tests).
Task 3 built 2026-09-16 (`web()`, `htmlToText`, `brave`, `tavily`, `duckduckgo`; failover on any provider error, not only network ones; providers and `web` take an injectable `fetch`; 7 tests).
Task 4 built 2026-09-16 (`memory({ dir, indexLines? })`: the folder is the program's to choose, since the workspace slug is `@cofold/store-file`'s and `@cofold/tools` imports `@cofold/agents` only; 3 tests).
Task 5 built 2026-09-16 (`config.tools`, `capabilitiesOf` in `agent.ts`, papo README; 2 tests). Decision 3's extra `Policy` was not written: `write_file` and `edit_file` declare `effects.destructive`, so under `destructive` they ask everywhere already, and a workspace-boundary rule would have caught `memory_write`, whose folder is outside the workspace by design. `resolveWithin` stays exported for a program that wants the rule. A timed-out model listing now reads `cannot reach <url>: no answer in time` (`network`), not `request aborted`.
- **Next action:** AGENT-02 Task 1. The manual turn against LM Studio is still owed: the server at 10.255.10.10:1235 did not answer on 2026-09-16.
- **Open questions:** none.
- **Watch out for:** Node 22's `fs.glob` is stable from 22.17; the package's `engines` says `>=22`, so the glob is written against `fs/promises` `glob` with a fallback walk if the runtime lacks it.

## Final verification checklist

- [x] `pnpm check` green with the new package (555 tests).
- [ ] papo turn against a real model reads a file and runs a command, asking under `destructive`.
- [x] `index.md` updated.
