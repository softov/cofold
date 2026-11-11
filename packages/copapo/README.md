# @cofold/copapo

[![CI](https://github.com/softov/cofold/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/cofold/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)

Talk to an agent that runs in this process.
`copapo` is a screen (the transcript, a composer, the block that asks before a destructive tool runs) and a shell (`copapo say`, `copapo approve`, `copapo session list`) over the same conversations, kept on disk under `~/.cofold` per workspace.
The agent reads and edits files, runs commands, fetches the web and keeps notes across sessions (`@cofold/tools`), and asks before anything destructive.
It is the first program on `@cofold/agents`, and the way a person checks what the harness does.
`copapo acp` serves the same conversations to an ACP client, such as ahpd or Zed.

## Try it

```sh
export COPAPO_BASE_URL=http://localhost:1234/v1     # LM Studio, Ollama, OpenRouter, any Chat Completions server
export COPAPO_API_KEY=...                          # when the server wants one
copapo models                                      # what it offers; the first is used unless you choose
copapo                                             # the screen
copapo say "What does this repository build?"      # one turn, printed; the session id is on the last line
copapo say -s <id> "And how is it tested?"         # the next turn of it
copapo say -m default/qwen3 -t high "Plan it"      # on that model, thinking hard; both stay on the session
```

Without a terminal (`copapo | cat`, a CI log) the screen prints one frame and exits.

## Configuration

`~/.config/copapo/config.json`, then the nearest `.copapo.json` up from the workspace (in a trusted folder only; see *Context files, skills and trust*), then `$COPAPO_CONFIG`, then `--config FILE`; later files win key by key.
`COPAPO_BASE_URL` and `COPAPO_API_KEY` add or replace a provider called `default`; `COPAPO_MODEL` chooses the default model (a bare model id means one of `default`).
While one provider is configured, the screen shows a model by its id alone (`openai/gpt-4o` for `default/openai/gpt-4o`); the configuration and `/status` keep the full reference.
The family's `COFOLD_BASE_URL`, `COFOLD_API_KEY` and `COFOLD_MODEL`, which the examples read, work too; `COPAPO_*` wins where both are set.
Every model request says `User-Agent: copapo/<version>`; to OpenRouter it also sends `HTTP-Referer: https://github.com/softov/cofold` and `X-OpenRouter-Title: copapo`, so the usage is attributed to copapo. A provider's own `headers` replace any of them.

```json
{
  "providers": [
    { "id": "lm", "baseUrl": "http://localhost:1234/v1" },
    { "id": "or", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-or-..." }
  ],
  "model": "or/qwen/qwen3-8b",
  "permissions": "default",
  "rules": { "deny": [{ "tool": "shell_exec", "match": "rm *" }], "allow": [{ "tool": "web_fetch" }] },
  "reasoning": "off",
  "instructions": "You are a careful assistant.",
  "limits": { "maxSteps": 20 },
  "params": { "temperature": 0.2 },
  "tools": { "files": true, "shell": true, "web": { "search": { "brave": { "apiKey": "BSA..." }, "duckduckgo": true } }, "memory": true },
  "context": { "maxTokens": 32000, "autoCompact": true },
  "theme": "paper",
  "shell": "workbench"
}
```

| Key | Meaning |
| --- | --- |
| `backend` | `cofold` (the harness in this process, the default) or `claude` (Claude Code's runtime through its SDK; see below). `--backend` and `COPAPO_BACKEND` override it. |
| `providers[].id` | How a model is named: `<id>/<model>`; `copapo providers` lists them, `copapo models <id>` what one offers. |
| `model` | `<provider>/<model>`; the first the first provider lists when absent. |
| `permissions` | Claude Code's modes: `default` (reads run; a tool that writes, destroys or reaches the network asks), `acceptEdits` (as `default`, and `write_file` / `edit_file` inside the workspace run unasked), `bypassPermissions` (everything runs; a deny or ask rule still wins), `dontAsk` (what would ask is denied instead). See below. |
| `rules` | `deny`, `ask` and `allow` lists of `{ "tool", "match"? }`, applied to every session before the mode decides; `match` is a glob (`*`, `?`) over what the tool touches: the command for `shell_exec`, the path for the file tools (relative to the workspace when inside it, absolute outside), the pattern for `list_files` / `search_files`. |
| `reasoning` | `off`, `low`, `medium`, `high`: the thinking level, sent as `params.reasoning.effort` to a model that has it. |
| `instructions` | The system prompt; the context files follow it (see *Context files, skills and trust*). |
| `limits`, `params` | `@cofold/agents` `Limits` and `ModelParams` (without `reasoning`, which is the setting above). |
| `tools` | The `@cofold/tools` capabilities, all on by default: `files` (`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`), `shell` (`shell_exec`), `web` (`web_fetch`; an object with `search` adds `web_search` over `brave`, `tavily`, `duckduckgo`, asked in that order), `memory` (`memory_read`, `memory_write` under `<home>/memory/<workspace slug>/`). `false` turns one off. |
| `context` | `maxTokens`: what a request may carry, instructions and history, as the harness estimates it (32 000 by default; set it to what the model has). `autoCompact`: fold the conversation into a summary before a turn once it passes 80% of that (on by default; each session may switch it). |
| `theme`, `shell` | What the screen opens with. |
| `mcpServers` | MCP servers whose tools the agent gets, by name, in Claude Code's shape; see *MCP servers*. |
| `trusted` | The trust answers, folder to `true` or `false`; `copapo trust` and the question write it. Read from the user file only. |
| `projectTrust` | What a run that cannot ask does in a folder not asked yet: `ask` (the default) and `never` load none of its own files, `always` loads them. Read from the user file only. |

A wrong key is named: `config.permissions must be one of default, acceptEdits, bypassPermissions, dontAsk (read: ~/.config/copapo/config.json)`.

## Context files, skills and trust

The system prompt is `instructions`, then the context files in this order:

| Order | File |
| --- | --- |
| 1 | `~/.agents/AGENTS.md`, the folder other agents share |
| 2 | `~/.cofold/AGENTS.md` (copapo's home, `COFOLD_HOME`) |
| 3 | One file per folder, from the filesystem root down to the workspace: its `AGENTS.md`, or its `CLAUDE.md` when it has none |

A word `@path` in a context file, outside code, adds that file after it: relative to the file, `~/` from home, `\ ` for a space, four levels deep, each file once.
Context files load whether or not the folder is trusted, as in pi and Claude Code, so a cloned repository's `AGENTS.md` reaches the model.

Skills, in the order a name clash is settled:

| Order | Folder |
| --- | --- |
| 1 | `.agents/skills` in the workspace and each folder above it, up to the repository root (the folder that holds `.git`); nearest first. Trusted folders only. |
| 2 | `~/.cofold/skills` |
| 3 | `~/.agents/skills` |
| 4 | The skills copapo ships, `/init` and `/review` |

The home folder's `.agents/skills` is the shared one, never a project's, even when home is a repository.

Trust decides whether a folder's own files load: `.copapo.json` up the tree, `.agents/skills` up to the repository root, the workspace's `.mcp.json`, and with `--backend claude` the CLI's `.claude/settings.json` and `.claude/settings.local.json`.
A folder that holds none of them is not asked about.
One that holds any asks once: on the screen before the catalogue, or over ACP as a form when the client takes forms.
The answer, yes or no, goes to `~/.config/copapo/config.json` under `trusted`, and covers the folders under it; the closest answer wins.
Escape, or a cancelled form, saves nothing and loads nothing for that run.
A run that cannot ask (`say`, `acp` with a client that takes no forms) follows `projectTrust`.
`copapo trust` and `copapo trust --no` save the workspace's answer; `/trust` asks again, for the next start.
With `--backend claude`, a folder copapo does not trust starts the CLI with `settingSources: ["user"]`, so the project's Claude settings, hooks and `.mcp.json` stay out.

## MCP servers

The agent gets the tools of the MCP servers in `mcpServers`, then, in a trusted folder, those in the workspace's `.mcp.json`; an entry there replaces a configured one of the same name.

```json
{
  "mcpServers": {
    "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "docs": { "type": "http", "url": "https://docs.example.com/mcp", "headers": { "authorization": "Bearer ${DOCS_TOKEN}" } }
  }
}
```

- A server starts at the first turn that needs it and stays until copapo ends; one that fails shows on the warning line and is tried again at the next turn.
- Its tools are named `mcp__<server>__<tool>` and are deferred: the agent loads one with `load_tools` before it calls it.
- The permission mode reads each tool's hints, as pi does: a tool that says `readOnlyHint` runs without asking in `default`; any other asks, as a tool that writes.
- `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url` and `headers`.
- `copapo acp` takes the servers its client sends with a session, stdio and http, beside the configured ones; ahpd's host tools arrive this way.
- With `--backend claude`, the configured servers and a session's go to the CLI; the CLI reads a trusted workspace's `.mcp.json` itself.

`@cofold/mcp-client` holds the rest: the keys, the timeouts, and what a result becomes.

## Tools, the permission mode and the rules

The modes are Claude Code's, read off what each tool declares (`effects`):
`default` runs a tool that only reads or declares no effect (`read_file`, `search_files`, `memory_read`, `ask_user`) and asks before one that writes, destroys or reaches the network (`write_file`, `edit_file`, `shell_exec`, `memory_write`, `web_fetch`, `web_search`);
`acceptEdits` is `default` with `write_file` and `edit_file` running unasked when the path resolves inside the workspace (an edit outside it, and every command, still asks);
`bypassPermissions` runs everything;
`dontAsk` denies, with the reason in the tool's result, what `default` would have asked about, so a turn never waits.
Claude's `plan` mode is not offered yet (it is a prompt-level mode there) and `auto` (a classifier) is not offered.

Rules run before the mode decides, `deny`, then `ask`, then `allow` (`rules()` in `@cofold/agents`): a deny rule refuses the call under every mode, `bypassPermissions` included, with `Denied by rule: shell_exec(rm *)` as the tool's result; an ask rule asks under every mode; an allow rule runs the call under every mode but where a deny or ask rule matched first.
They live in the configuration (`rules`, every session) and per session (`copapo session set <id> --deny 'shell_exec(rm *)' --ask web_fetch --allow 'edit_file(src/*)'`, each flag repeatable; `Tool` or `Tool(match)`), the session's before the configuration's; `copapo session rules <id>` lists the mode and every rule with its origin.
`approve --always` (or the `Always, this session` option on the screen) adds `{ "tool": <name> }` to the session's allow list, where `session rules` shows it, and that tool runs without asking for the rest of the session.

## Settings

`model`, `permissions`, `reasoning` and `autoCompact` are the configuration's defaults for a new session and each session's own afterwards: `copapo say -m -p -t -a` on the first message, `copapo session set <id> -m -p -t -a` later, or the three chips under the composer on the screen (`tab` reaches them, `enter` opens the picker) and `/autocompact`; the session's `rules` are set with `session set --deny --ask --allow` and by `always`.
They are kept beside the session in the store, and the agent is rebuilt from them for every turn, so a change between two messages takes effect on the next one.
Every model, permission mode or thinking level a person chooses (a chip, `session set -m/-p/-t`, `say -m/-p/-t` on a new session) is also written back into the configuration as `model`, `permissions`, `reasoning`, so the next new conversation starts from it: into the file that currently sets the field, else `~/.config/copapo/config.json` (`$XDG_CONFIG_HOME` honoured), created if absent; the file's indentation and other fields are kept.
The shell says `remembered in <file>`; a `COPAPO_MODEL` in the environment still wins over the file while it is set.

## The shell

```
say <text> [-s ID] [-m -p -t -a]   one turn; stops where the agent stops; said to a session still answering, it steers that turn
queue <session> <text> [-i ID] [-m -p -t -a]   hold a message as the session's next turn (in this process; starts when the turn ends or at once while nothing runs, never after a cancel)
unqueue <session> <id>          drop a queued message
approve <session> [--always]    let the waiting tool call run
deny <session> [-r TEXT]        refuse it
answer <session> id=value...    answer the agent's questions; repeat an id for a multi-select
cancel <session>                stop the turn: a running one is aborted; one waiting on a decision has it denied and ends cancelled
usage <session>                 what it used: tokens by kind, steps, tool calls and refusals, per turn and in total; no prices
session list | show [--all] | delete   show prints what the model sees; --all every turn, the compacted ones included
session export <session> [-o FILE]   the conversation as Markdown
skills                          the skills the agent may read; `say "/name ..."` invokes one
commands                        the runtime's commands and the skills; `say -s ID /compact` runs one
session set <session> [-m -p -t -a] [--deny RULE]... [--ask RULE]... [--allow RULE]...   the model, the permission mode, the thinking level, auto-compaction; add rules
session rules <session>         the mode and every rule the session runs under, with its origin (session or config)
providers                       the configured providers; which one a new conversation starts on
models [provider]               every model the providers offer, or one provider's; one that cannot be reached is reported on stderr and skipped
skills                          the skills the agent may read; `say "/name ..."` invokes one
config                          what is in force, keys redacted
chat [-s ID]                    the screen (what a bare `copapo` does)
acp                             an Agent Client Protocol agent on stdin and stdout (see below)
```

`--json` on any of them gives the record; `session show --json` is the whole projection the screen draws.
Every command is a `@cofold/commands` action, so the same declarations are an MCP tool set and an HTTP surface when a program wants them.

Global options: `--workspace DIR` (`COPAPO_WORKSPACE`, default the current directory), `--home DIR` (`COFOLD_HOME`, default `~/.cofold`), `--config FILE`.

## The screen

Two screens.
The catalogue: `enter` opens, `n` starts a conversation, `d` deletes after asking, `r` refreshes.
The conversation: type and `enter`; `tab` walks the three chips under the field (model, permissions, thinking) and `enter` opens one; the model chip asks the provider first when more than one lists models, then that provider's models; `ctrl+c` stops a running turn (a turn waiting on a confirmation has it denied with `The turn was stopped` and ends cancelled, the transcript showing `Request interrupted by user`; when nothing runs, a second `ctrl+c` within a moment quits); `a` and `d` answer a confirmation; a question is answered in its form; `esc` goes back, and so does `left` at the start of the field; `ctrl+p` is the palette; `alt+m` toggles markdown.
While the agent answers, `enter` steers: the message lands in the running turn before its next model step, and the transcript shows it where it landed.
A `Queue` chip leads the row then (`tab`, `enter`): the draft becomes the next turn instead, listed as a queued row at the end of the transcript, and starts when the turn ends, never after `ctrl+c`; `enter` on a queued row drops it.
Queued while nothing runs (`/queue`, `copapo queue`), a message is the next turn at once, as in Claude Code.

`/` opens a menu: the runtime's commands first, then the skills, then the screen's own commands.
A command that takes an argument becomes `/name ` in the field; the others are sent as they are picked.

The runtime's commands are the same list `copapo commands` prints. They run in the harness, not in the model, and their answer is a notice in the transcript. A line typed while a turn runs is queued and runs after it.

| | |
| --- | --- |
| `/compact` | Fold the conversation so far into a summary the model continues from. Afterwards the transcript is the model's view: the `/compact` turn first, with the summary and `Context compacted: N tokens to M.`, then the turns the compaction kept verbatim, then what follows; the folded turns are in the store and `copapo session show --all` prints them. |
| `/autocompact on\|off` | Switch the automatic version for this session: the same fold, done before a turn once the conversation passes 80% of `context.maxTokens`. |
| `/model`, `/permissions`, `/reasoning` | Without an argument, the setting and its choices; with one, the new value (`/model fake/other`). The chips under the field change the same settings. |
| `/status`, `/usage`, `/context` | The session, model, mode, rules, folders and token totals; what each turn used (tokens by kind, steps, tool calls, refusals), never a price; how much of the context the conversation fills. |
| `/config`, `/skills` | The configuration with keys redacted; the skills. |

A skill is a `/name` too: sending the line tells the agent to read that skill, and the transcript shows `Skill: name`. `/init` writes or refreshes `AGENTS.md`; `/review` reviews the working tree; both ship with copapo, and a skill of the same name in any folder *Context files, skills and trust* lists replaces it.

The screen's own commands never reach the runtime; `ctrl+p` lists them too:

| | |
| --- | --- |
| `/memory` | What the agent remembers about this workspace (`~/.cofold/memory/<workspace>/MEMORY.md`), with a button that opens it in `$VISUAL`, `$EDITOR`, or the platform's editor. |
| `/export` | The conversation as Markdown, to `<workspace>/copapo-<session>.md`. |
| `/retry` | The last message again, as a new turn. |
| `/clear`, `/new` | A new conversation; the current one stays in the catalogue. |
| `/stop`, `/approve`, `/deny` | What `ctrl+c`, `a` and `d` do. |
| `/queue`, `/unqueue` | Hold what is in the field as the next turn; drop a queued message. |
| `/theme`, `/markdown` | The colors and shapes, worn while the highlight moves; markdown rendering on or off. |
| `/help`, `/quit` | The runtime's commands, then these, with their keys; out. |


The components are `@textui/chat`; what this package adds is the projection from the store to their props and the wiring from a key to the harness.

## The claude backend

`copapo --backend claude` (or `"backend": "claude"`, or `COPAPO_BACKEND=claude`) runs the same screen and shell over Claude Code's own runtime: its tools, its permission rules, its sessions under `~/.claude/projects/`, its compaction.
It needs `@anthropic-ai/claude-agent-sdk` installed next to copapo (an optional peer, under Anthropic's licence, with the CLI binary inside) and a Claude login or `ANTHROPIC_API_KEY`; without the package, `copapo --backend claude` says `install @anthropic-ai/claude-agent-sdk to use the claude backend`.

```sh
npm install @anthropic-ai/claude-agent-sdk
copapo --backend claude models                     # what the CLI offers: claude/default, claude/opus, claude/sonnet, ...
copapo --backend claude                            # the screen, over Claude Code
copapo --backend claude say -p auto "Run the tests and fix what fails"
```

What is the same: the transcript, the confirmation block (the CLI's `canUseTool` becomes it, under the CLI's own sentence when it sends one; `Always, this session` sends the CLI's suggested rules back with every destination rewritten to `session`, so the rule holds for the rest of the session and nothing is written into a settings file; the option is withheld when the CLI says the rule would grant more than the ask), the question form (`AskUserQuestion`), `copapo usage`, the session list, `session show` and `session export`.
Settings (`model`, `permissions`, `reasoning`) are kept per session in the file store under `--home`, at the same key the cofold backend uses, so they survive a restart and `session set` reads the same thing on both backends.
What differs, because it is the CLI's:

- Models are `claude/<name>` as `supportedModels()` lists them; a `model` of another provider in the configuration is ignored with a warning, and the CLI's default is used.
- `permissions`: the four names are the CLI's own and are passed through as its `permissionMode` (`bypassPermissions` with the flag the SDK asks for); changing the mode on a session with a live process restarts that process on the same session, as a thinking change does. copapo's `rules` are kept and listed for the session but not applied: the CLI reads its own settings files (`settingSources`), and `Always, this session` sends the CLI's suggested rules back to it rather than adding a copapo rule.
- `reasoning` is the CLI's `effort` (`off` sends none); changing it on a session with a live process restarts that process on the same session.
- The `/` menu and `copapo commands` list the CLI's own commands, its skills among them, and a line that starts with `/` goes to the CLI unchanged; `copapo skills` lists none. A slash line said while a turn runs is queued, as on the cofold backend.
- `autoCompact` is kept for the session but the CLI compacts on its own; `/autocompact` is the CLI's. `/compact` sends the CLI its own command; afterwards the transcript is what the CLI keeps, the summary first (shown as a `(context compacted)` turn) and the turns after it.
- A decision waits in the process that asked, not on disk: `copapo say` that stops at a tool denies it (and every further one the turn stops at) and says so; approvals and answers happen on the screen (`copapo chat`), where the process lives.
- A message said while a turn runs is pushed to the CLI, which takes it into the running turn as its own client does; the CLI records it as a user message, so the transcript shows it as a turn boundary after the tool result. The queue is copapo's, the same as on the cofold backend.
- `session delete` removes the CLI's session file; `session list` is the workspace's sessions in `~/.claude/projects/`.
- Failed turns are the CLI's result (`error_*`, or a `success` carrying `is_error` when the API refused) and are kept only in the process that saw them; the CLI's transcript has no record of them.
- `copapo usage` counts a reply once however many entries the CLI stored it as (it writes one per content block, so thinking, text and a tool call of one reply share an id).

The harness's own tools, skills and memory are not involved; the CLI brings its own.

## ACP

`copapo acp` is an [Agent Client Protocol](https://agentclientprotocol.com) agent, protocol version 1, on stdin and stdout.
An ACP client spawns it as it spawns Gemini or OpenCode, and both backends run behind it: `copapo acp` and `copapo --backend claude acp`.
Stdout carries the protocol and nothing else; warnings go to stderr.
It has no dependency: the JSON-RPC loop is copapo's own.

```json
{ "command": "copapo", "args": ["acp"] }
```

| ACP | copapo |
| --- | --- |
| `session/new`, `load`, `resume`, `fork`, `list`, `close`, `delete` | A session in the folder the client names as `cwd`, with its own configuration from there. `load` replays the transcript first; `resume` does not; `fork` copies the whole conversation and its settings. |
| `session/prompt` | One turn. Its text blocks and the URI of a `resource_link` are the message. Sent while a turn runs, it steers that turn, and both prompts are answered when it ends. A line that starts with `/` runs the command, and waits for the running turn first. |
| `session/update` | The reply and the reasoning as chunks, each tool call and its result, the title, the context fill (`usage_update`, cofold backend only), the commands and skills (`available_commands_update`), and a mode or option changed by another front. |
| `session/request_permission` | The confirmation block: allow, `Always, this session` where the block offers it, reject. |
| `elicitation/create` | The question form, to a client that declares `elicitation.form`; another client has the question declined. |
| `session/cancel` | `ctrl+c`: the turn stops, and a waiting decision is denied. |
| modes | The permission mode: `default`, `acceptEdits`, `bypassPermissions`, `dontAsk`. |
| config options | `model` (category `model`) and `thought_level` (category `thought_level`): the model and the thinking level. |

A turn ends `end_turn` when it completes or a hook stops it, `cancelled` when it is cancelled, and `max_turn_requests` at `limits.maxSteps`; a failed turn is a JSON-RPC error with its message.
The tools are copapo's own: the client's `fs/*` and `terminal/*` are never called.
There is no sign-in: the keys are in copapo's configuration.
Not served: `additionalDirectories`, which is ignored; an SSE MCP server, which is left out with a warning; images, audio and embedded resources in a prompt.

## What is kept, and where

Sessions, runs, events, steps and requests are the file store's (`@cofold/store-file`), under `<home>/workspaces/<slug>/sessions/<id>/`.
Nothing is cached in the process but the handle of a run it started and the queue of next turns: every screen and every command reads the store and projects it, so `copapo session show` in another terminal shows the same thing the screen does, and a session left waiting by a process that died is resumed by whichever process next answers it.
The queue is the one thing that is not in the store: it lives in the process that holds it (as Claude Code's does) and is gone with it; the screen lists what waits so nothing is lost unseen.

How a turn ended is read from the run's last event: a `failed` run shows its error; a `stopped` run ended by a hook (`notify_done` and the like) reads as complete, and one stopped by a limit reads as failed with `stopped: max_tool_calls`, `stopped: max_cost`, `stopped: max_steps` or `stopped: timeout`; a cancelled run shows the calls it cut as failed and the marker `Request interrupted by user`.

Streaming: the process that runs a turn folds the harness's `model.delta` events into a draft held next to the run's handle, and the screen draws it as the reply being written (the reasoning, then the text, with a caret); at `model.completed` the draft goes and the stored message takes its place.
Another process reading the same session (`copapo session show`, a second screen) sees the reply whole when the step completes: the draft is the one screen state that is not in the store.

## Layout

```
src/
  types/{config,settings,turn,chat}.ts   the contracts
  config.ts                     loadConfig, rememberConfig (its schema composes the two libraries')
  agent.ts                      buildAgent, policyOf (the mode as what decides when no rule matches), mergedRules
  rules.ts                      parseRule / formatRule (Tool or Tool(match)), checkRules
  turns.ts  blocks.ts           store -> Turn[] -> Block[]
  questions.ts                  AskQuestion <-> ChatQuestion / ChatAnswer, id=value words
  chat.ts                       createChat: the service both fronts use
  queue.ts                      createQueues: the next turns, in memory, for both backends
  acp/                          copapo acp: rpc.ts (JSON-RPC over lines), server.ts (the methods over Chat), project.ts (Snapshot -> session/update),
                                pending.ts (the block as a permission or a form), settings.ts (modes and options), tools.ts (the tool kinds)
  claude/                       the claude backend: sdk.ts (the optional peer), project.ts (the CLI's transcript as Turn[]),
                                permissions.ts (canUseTool as the block), chat.ts (createClaudeChat), testing.ts (the fake SDK)
  chat-contract.test.ts         the scenarios both backends must agree on
  commands.ts  program.ts       the actions and the @cofold/terminal program
  main.ts                       the binary: screen or shell
  screen/{state,app,sessions,chat,tui}                  the textui application
  testing.ts                    a scripted provider and a destructive tool, for tests
```
