# @facio/papo

Talk to an agent that runs in this process.
`papo` is a screen (the transcript, a composer, the block that asks before a destructive tool runs) and a shell (`papo say`, `papo approve`, `papo session list`) over the same conversations, kept on disk under `~/.facio` per workspace.
It is the first program on `@facio/agents`, and the way a person checks what the harness does.

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
  "permissions": "destructive",
  "reasoning": "off",
  "instructions": "You are a careful assistant.",
  "limits": { "maxSteps": 20 },
  "params": { "temperature": 0.2 },
  "theme": "paper",
  "shell": "workbench"
}
```

| Key | Meaning |
| --- | --- |
| `providers[].id` | How a model is named: `<id>/<model>`. |
| `model` | `<provider>/<model>`; the first the first provider lists when absent. |
| `permissions` | `destructive` (the harness default: tools declaring `effects.destructive` stop to ask), `ask` (every tool asks), `auto` (nothing asks). |
| `reasoning` | `off`, `low`, `medium`, `high`: the thinking level, sent as `params.reasoning.effort` to a model that has it. |
| `instructions` | The system prompt; `<workspace>/AGENTS.md` is appended when present. |
| `limits`, `params` | `@facio/agents` `Limits` and `ModelParams` (without `reasoning`, which is the setting above). |
| `theme`, `shell` | What the screen opens with. |

A wrong key is named: `config.permissions must be one of ask, destructive, auto (read: ~/.config/papo/config.json)`.

## Settings

`model`, `permissions` and `reasoning` are the configuration's defaults for a new session and each session's own afterwards: `papo say -m -p -t` on the first message, `papo session set <id> -m -p -t` later, or the three chips under the composer on the screen (`tab` reaches them, `enter` opens the picker).
They are kept beside the session in the store, and the agent is rebuilt from them for every turn, so a change between two messages takes effect on the next one.

## The shell

```
say <text> [-s ID] [-m -p -t]   one turn; stops where the agent stops
approve <session> [--always]    let the waiting tool call run
deny <session> [-r TEXT]        refuse it
answer <session> id=value...    answer the agent's questions; repeat an id for a multi-select
cancel <session>                abort a running turn, or deny a waiting approval
session list | show | delete
session set <session> [-m -p -t]   the model, the permission mode, the thinking level
models                          every model the providers offer
config                          what is in force, keys redacted
chat [-s ID]                    the screen (what a bare `papo` does)
```

`--json` on any of them gives the record; `session show --json` is the whole projection the screen draws.
Every command is a `@facio/commands` action, so the same declarations are an MCP tool set and an HTTP surface when a program wants them.

Global options: `--workspace DIR` (`PAPO_WORKSPACE`, default the current directory), `--home DIR` (`FACIO_HOME`, default `~/.facio`), `--config FILE`.

## The screen

Two screens.
The catalogue: `enter` opens, `n` starts a conversation, `d` deletes, `r` refreshes.
The conversation: type and `enter`; `tab` walks the three chips under the field (model, permissions, thinking) and `enter` opens one; `ctrl+c` stops a running turn (and quits when nothing runs); `a` and `d` answer a confirmation; a question is answered in its form; `esc` goes back; `ctrl+p` is the palette; `alt+m` toggles markdown.

The components are `@textui/chat`; what this package adds is the projection from the store to their props and the wiring from a key to the harness.

## What is kept, and where

Sessions, runs, events, steps and requests are the file store's (`@facio/store-file`), under `<home>/workspaces/<slug>/sessions/<id>/`.
Nothing is cached in the process but the handle of a run it started: every screen and every command reads the store and projects it, so `papo session show` in another terminal shows the same thing the screen does, and a session left waiting by a process that died is resumed by whichever process next answers it.

Streaming: until the harness emits `model.delta` (its p5), a reply lands whole when the model step completes.

## Layout

```
src/
  types/{config,settings,turn,chat}.ts   the contracts
  config.ts                     loadConfig, providersOf, providerFor
  agent.ts                      buildAgent, policyOf
  turns.ts  blocks.ts           store -> Turn[] -> Block[]
  questions.ts                  AskQuestion <-> ChatQuestion / ChatAnswer, id=value words
  chat.ts                       createChat: the service both fronts use
  commands.ts  program.ts       the actions and the @facio/terminal program
  main.ts                       the binary: screen or shell
  screen/{state,app,sessions,chat,tui}                  the textui application
  testing.ts                    a scripted provider and a destructive tool, for tests
```
