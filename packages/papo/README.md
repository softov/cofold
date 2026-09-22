# @doopx/papo

Talk to an agent that runs in this process.
`papo` is a screen (the transcript, a composer, the block that asks before a destructive tool runs) and a shell (`papo say`, `papo approve`, `papo session list`) over the same conversations, kept on disk under `~/.doopx` per workspace.
The agent reads and edits files, runs commands, fetches the web and keeps notes across sessions (`@doopx/tools`), and asks before anything destructive.
It is the first program on `@doopx/agents`, and the way a person checks what the harness does.

## Try it

```sh
export PAPO_BASE_URL=http://localhost:1234/v1     # LM Studio, Ollama, OpenRouter, any Chat Completions server
export PAPO_API_KEY=...                          # when the server wants one
papo models                                      # what it offers; the first is used unless you choose
papo                                             # the screen
papo say "What does this repository build?"      # one turn, printed; the session id is on the last line
papo say -s <id> "And how is it tested?"         # the next turn of it
papo say -m default/qwen3 -t high "Plan it"      # on that model, thinking hard; both stay on the session
```

Without a terminal (`papo | cat`, a CI log) the screen prints one frame and exits.

## Configuration

`~/.config/papo/config.json`, then the nearest `.papo.json` up from the workspace, then `$PAPO_CONFIG`, then `--config FILE`; later files win key by key.
`PAPO_BASE_URL` and `PAPO_API_KEY` add or replace a provider called `default`; `PAPO_MODEL` chooses the default model (a bare model id means one of `default`).
The family's `FACIO_BASE_URL`, `FACIO_API_KEY` and `FACIO_MODEL`, which the examples read, work too; `PAPO_*` wins where both are set.

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
| `backend` | `doopx` (the harness in this process, the default) or `claude` (Claude Code's runtime through its SDK; see below). `--backend` and `PAPO_BACKEND` override it. |
| `providers[].id` | How a model is named: `<id>/<model>`; `papo providers` lists them, `papo models <id>` what one offers. |
| `model` | `<provider>/<model>`; the first the first provider lists when absent. |
| `permissions` | Claude Code's modes: `default` (reads run; a tool that writes, destroys or reaches the network asks), `acceptEdits` (as `default`, and `write_file` / `edit_file` inside the workspace run unasked), `bypassPermissions` (everything runs; a deny or ask rule still wins), `dontAsk` (what would ask is denied instead). See below. |
| `rules` | `deny`, `ask` and `allow` lists of `{ "tool", "match"? }`, applied to every session before the mode decides; `match` is a glob (`*`, `?`) over what the tool touches: the command for `shell_exec`, the path for the file tools (relative to the workspace when inside it, absolute outside), the pattern for `list_files` / `search_files`. |
| `reasoning` | `off`, `low`, `medium`, `high`: the thinking level, sent as `params.reasoning.effort` to a model that has it. |
| `instructions` | The system prompt; `<workspace>/AGENTS.md` is appended when present. |
| `limits`, `params` | `@doopx/agents` `Limits` and `ModelParams` (without `reasoning`, which is the setting above). |
| `tools` | The `@doopx/tools` capabilities, all on by default: `files` (`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`), `shell` (`shell_exec`), `web` (`web_fetch`; an object with `search` adds `web_search` over `brave`, `tavily`, `duckduckgo`, asked in that order), `memory` (`memory_read`, `memory_write` under `<home>/memory/<workspace slug>/`). `false` turns one off. |
| `context` | `maxTokens`: what a request may carry, instructions and history, as the harness estimates it (32 000 by default; set it to what the model has). `autoCompact`: fold the conversation into a summary before a turn once it passes 80% of that (on by default; each session may switch it). |
| `theme`, `shell` | What the screen opens with. |

A wrong key is named: `config.permissions must be one of default, acceptEdits, bypassPermissions, dontAsk (read: ~/.config/papo/config.json)`.

## Tools, the permission mode and the rules

The modes are Claude Code's, read off what each tool declares (`effects`):
`default` runs a tool that only reads or declares no effect (`read_file`, `search_files`, `memory_read`, `ask_user`) and asks before one that writes, destroys or reaches the network (`write_file`, `edit_file`, `shell_exec`, `memory_write`, `web_fetch`, `web_search`);
`acceptEdits` is `default` with `write_file` and `edit_file` running unasked when the path resolves inside the workspace (an edit outside it, and every command, still asks);
`bypassPermissions` runs everything;
`dontAsk` denies, with the reason in the tool's result, what `default` would have asked about, so a turn never waits.
Claude's `plan` mode is not offered yet (it is a prompt-level mode there) and `auto` (a classifier) is not offered.

Rules run before the mode decides, `deny`, then `ask`, then `allow` (`rules()` in `@doopx/agents`): a deny rule refuses the call under every mode, `bypassPermissions` included, with `Denied by rule: shell_exec(rm *)` as the tool's result; an ask rule asks under every mode; an allow rule runs the call under every mode but where a deny or ask rule matched first.
They live in the configuration (`rules`, every session) and per session (`papo session set <id> --deny 'shell_exec(rm *)' --ask web_fetch --allow 'edit_file(src/*)'`, each flag repeatable; `Tool` or `Tool(match)`), the session's before the configuration's; `papo session rules <id>` lists the mode and every rule with its origin.
`approve --always` (or the `Always, this session` option on the screen) adds `{ "tool": <name> }` to the session's allow list, where `session rules` shows it, and that tool runs without asking for the rest of the session.

## Settings

`model`, `permissions`, `reasoning` and `autoCompact` are the configuration's defaults for a new session and each session's own afterwards: `papo say -m -p -t -a` on the first message, `papo session set <id> -m -p -t -a` later, or the three chips under the composer on the screen (`tab` reaches them, `enter` opens the picker) and `/autocompact`; the session's `rules` are set with `session set --deny --ask --allow` and by `always`.
They are kept beside the session in the store, and the agent is rebuilt from them for every turn, so a change between two messages takes effect on the next one.
Every model, permission mode or thinking level a person chooses (a chip, `session set -m/-p/-t`, `say -m/-p/-t` on a new session) is also written back into the configuration as `model`, `permissions`, `reasoning`, so the next new conversation starts from it: into the file that currently sets the field, else `~/.config/papo/config.json` (`$XDG_CONFIG_HOME` honoured), created if absent; the file's indentation and other fields are kept.
The shell says `remembered in <file>`; a `PAPO_MODEL` in the environment still wins over the file while it is set.

## The shell

```
say <text> [-s ID] [-m -p -t -a]   one turn; stops where the agent stops; said to a session still answering, it steers that turn
queue <session> <text> [-i ID] [-m -p -t -a]   hold a message as the session's next turn (in this process; starts when the turn ends or at once while nothing runs, never after a cancel)
unqueue <session> <id>          drop a queued message
approve <session> [--always]    let the waiting tool call run
deny <session> [-r TEXT]        refuse it
answer <session> id=value...    answer the agent's questions; repeat an id for a multi-select
cancel <session>                stop the turn: a running one is aborted; one waiting on a decision has it denied and ends cancelled
compact <session>               fold the conversation so far into a summary
usage <session>                 what it used: tokens by kind, steps, tool calls and refusals, per turn and in total; no prices
session list | show [--all] | delete   show prints what the model sees; --all every turn, the compacted ones included
session export <session> [-o FILE]   the conversation as Markdown
skills                          the skills the agent may read; `say "/name ..."` invokes one
session set <session> [-m -p -t -a] [--deny RULE]... [--ask RULE]... [--allow RULE]...   the model, the permission mode, the thinking level, auto-compaction; add rules
session rules <session>         the mode and every rule the session runs under, with its origin (session or config)
providers                       the configured providers; which one a new conversation starts on
models [provider]               every model the providers offer, or one provider's; one that cannot be reached is reported on stderr and skipped
skills                          the skills the agent may read; `say "/name ..."` invokes one
config                          what is in force, keys redacted
chat [-s ID]                    the screen (what a bare `papo` does)
```

`--json` on any of them gives the record; `session show --json` is the whole projection the screen draws.
Every command is a `@doopx/commands` action, so the same declarations are an MCP tool set and an HTTP surface when a program wants them.

Global options: `--workspace DIR` (`PAPO_WORKSPACE`, default the current directory), `--home DIR` (`FACIO_HOME`, default `~/.doopx`), `--config FILE`.

## The screen

Two screens.
The catalogue: `enter` opens, `n` starts a conversation, `d` deletes, `r` refreshes.
The conversation: type and `enter`; `tab` walks the three chips under the field (model, permissions, thinking) and `enter` opens one; the model chip asks the provider first when more than one lists models, then that provider's models; `ctrl+c` stops a running turn (a turn waiting on a confirmation has it denied with `The turn was stopped` and ends cancelled, the transcript showing `Request interrupted by user`; when nothing runs it quits); `a` and `d` answer a confirmation; a question is answered in its form; `esc` goes back; `ctrl+p` is the palette; `alt+m` toggles markdown.
While the agent answers, `enter` steers: the message lands in the running turn before its next model step, and the transcript shows it where it landed.
A `Queue` chip leads the row then (`tab`, `enter`): the draft becomes the next turn instead, listed as a queued row at the end of the transcript, and starts when the turn ends, never after `ctrl+c`; `enter` on a queued row drops it.
Queued while nothing runs (`/queue`, `papo queue`), a message is the next turn at once, as in Claude Code.

`/` opens a menu: the skills first (chosen, one becomes `/name ` in the field, and sending the line tells the agent to read that skill), then the commands, which are the palette's:

| | |
| --- | --- |
| `/model`, `/permissions`, `/thinking` | The three settings, as pickers. |
| `/compact` | Fold the conversation so far into a summary the model continues from. Afterwards the transcript is the model's view: the compaction turn first (`(context compacted)`, with `Context compacted: N tokens to M.`), then the turns the compaction kept verbatim, then what follows; the folded turns are in the store and `papo session show --all` prints them. |
| `/autocompact` | Switch the automatic version for this session: the same fold, done before a turn once the conversation passes 80% of `context.maxTokens`. |
| `/status`, `/usage` | The session, model, mode, folders and token totals; what each turn used (tokens by kind, steps, tool calls, refusals), never a price. |
| `/skill` | Pick a skill from the list. `/init` writes or refreshes `AGENTS.md`; `/review` reviews the working tree; both ship with papo, and a skill of the same name under `~/.doopx/skills` or `<workspace>/.agents/skills` replaces it. |
| `/memory` | What the agent remembers about this workspace (`~/.doopx/memory/<workspace>/MEMORY.md`), with a button that opens it in `$VISUAL`, `$EDITOR`, or the platform's editor. |
| `/export` | The conversation as Markdown, to `<workspace>/papo-<session>.md`. |
| `/retry` | The last message again, as a new turn. |
| `/clear`, `/new` | A new conversation; the current one stays in the catalogue. |
| `/stop`, `/approve`, `/deny` | What `ctrl+c`, `a` and `d` do. |
| `/queue`, `/unqueue` | Hold what is in the field as the next turn; drop a queued message. |
| `/theme` | The colors and shapes; the choice is worn while the highlight moves. |
| `/config`, `/help`, `/quit` | The configuration with keys redacted; every command and key; out. |


The components are `@textui/chat`; what this package adds is the projection from the store to their props and the wiring from a key to the harness.

## The claude backend

`papo --backend claude` (or `"backend": "claude"`, or `PAPO_BACKEND=claude`) runs the same screen and shell over Claude Code's own runtime: its tools, its permission rules, its sessions under `~/.claude/projects/`, its compaction.
It needs `@anthropic-ai/claude-agent-sdk` installed next to papo (an optional peer, under Anthropic's licence, with the CLI binary inside) and a Claude login or `ANTHROPIC_API_KEY`; without the package, `papo --backend claude` says `install @anthropic-ai/claude-agent-sdk to use the claude backend`.

```sh
npm install @anthropic-ai/claude-agent-sdk
papo --backend claude models                     # what the CLI offers: claude/default, claude/opus, claude/sonnet, ...
papo --backend claude                            # the screen, over Claude Code
papo --backend claude say -p auto "Run the tests and fix what fails"
```

What is the same: the transcript, the confirmation block (the CLI's `canUseTool` becomes it, under the CLI's own sentence when it sends one; `Always, this session` sends the CLI's suggested rules back with every destination rewritten to `session`, so the rule holds for the rest of the session and nothing is written into a settings file; the option is withheld when the CLI says the rule would grant more than the ask), the question form (`AskUserQuestion`), `/compact`, `/usage`, `/status`, the session list, `session show` and `session export`.
Settings (`model`, `permissions`, `reasoning`) are kept per session in the file store under `--home`, at the same key the doopx backend uses, so they survive a restart and `session set` reads the same thing on both backends.
What differs, because it is the CLI's:

- Models are `claude/<name>` as `supportedModels()` lists them; a `model` of another provider in the configuration is ignored with a warning, and the CLI's default is used.
- `permissions`: the four names are the CLI's own and are passed through as its `permissionMode` (`bypassPermissions` with the flag the SDK asks for); changing the mode on a session with a live process restarts that process on the same session, as a thinking change does. papo's `rules` are kept and listed for the session but not applied: the CLI reads its own settings files (`settingSources`), and `Always, this session` sends the CLI's suggested rules back to it rather than adding a papo rule.
- `reasoning` is the CLI's `effort` (`off` sends none); changing it on a session with a live process restarts that process on the same session.
- `autoCompact` stays on: the CLI compacts on its own; `/autocompact` off is refused with that sentence. `/compact` sends the CLI its own command; afterwards the transcript is what the CLI keeps, the summary first (shown as a `(context compacted)` turn) and the turns after it.
- A decision waits in the process that asked, not on disk: `papo say` that stops at a tool denies it (and every further one the turn stops at) and says so; approvals and answers happen on the screen (`papo chat`), where the process lives.
- A message said while a turn runs is pushed to the CLI, which takes it into the running turn as its own client does; the CLI records it as a user message, so the transcript shows it as a turn boundary after the tool result. The queue is papo's, the same as on the doopx backend.
- `session delete` removes the CLI's session file; `session list` is the workspace's sessions in `~/.claude/projects/`.
- Failed turns are the CLI's result (`error_*`, or a `success` carrying `is_error` when the API refused) and are kept only in the process that saw them; the CLI's transcript has no record of them.
- `/usage` counts a reply once however many entries the CLI stored it as (it writes one per content block, so thinking, text and a tool call of one reply share an id).

The harness's own tools, skills and memory are not involved; the CLI brings its own.

## What is kept, and where

Sessions, runs, events, steps and requests are the file store's (`@doopx/store-file`), under `<home>/workspaces/<slug>/sessions/<id>/`.
Nothing is cached in the process but the handle of a run it started and the queue of next turns: every screen and every command reads the store and projects it, so `papo session show` in another terminal shows the same thing the screen does, and a session left waiting by a process that died is resumed by whichever process next answers it.
The queue is the one thing that is not in the store: it lives in the process that holds it (as Claude Code's does) and is gone with it; the screen lists what waits so nothing is lost unseen.

How a turn ended is read from the run's last event: a `failed` run shows its error; a `stopped` run ended by a hook (`notify_done` and the like) reads as complete, and one stopped by a limit reads as failed with `stopped: max_tool_calls`, `stopped: max_cost`, `stopped: max_steps` or `stopped: timeout`; a cancelled run shows the calls it cut as failed and the marker `Request interrupted by user`.

Streaming: the process that runs a turn folds the harness's `model.delta` events into a draft held next to the run's handle, and the screen draws it as the reply being written (the reasoning, then the text, with a caret); at `model.completed` the draft goes and the stored message takes its place.
Another process reading the same session (`papo session show`, a second screen) sees the reply whole when the step completes: the draft is the one screen state that is not in the store.

## Layout

```
src/
  types/{config,settings,turn,chat}.ts   the contracts
  config.ts                     loadConfig, rememberConfig, providersOf, providerFor
  agent.ts                      buildAgent, policyOf (the mode as what decides when no rule matches), mergedRules
  rules.ts                      parseRule / formatRule (Tool or Tool(match)), checkRules
  turns.ts  blocks.ts           store -> Turn[] -> Block[]
  questions.ts                  AskQuestion <-> ChatQuestion / ChatAnswer, id=value words
  chat.ts                       createChat: the service both fronts use
  queue.ts                      createQueues: the next turns, in memory, for both backends
  claude/                       the claude backend: sdk.ts (the optional peer), project.ts (the CLI's transcript as Turn[]),
                                permissions.ts (canUseTool as the block), chat.ts (createClaudeChat), testing.ts (the fake SDK)
  chat-contract.test.ts         the scenarios both backends must agree on
  commands.ts  program.ts       the actions and the @doopx/terminal program
  main.ts                       the binary: screen or shell
  screen/{state,app,sessions,chat,tui}                  the textui application
  testing.ts                    a scripted provider and a destructive tool, for tests
```
