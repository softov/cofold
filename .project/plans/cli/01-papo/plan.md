---
title: CLI-01 - papo: the harness in a terminal
domain: cli
status: built
priority: high
created: 2026-09-16
revalidated: 2026-09-16
requires:
  - plans/agent/01-harness-core/plan.md
---

# CLI-01 - papo: the harness in a terminal

## Goal

A person runs `papo` in a project folder and talks to an agent that runs **in this process** on `@cofold/agents`: sessions persist under `~/.cofold` per workspace, a destructive tool stops and asks, `ask_user` shows its questions, closing the terminal mid-approval loses nothing.
The same conversations are reachable from a shell (`papo say`, `papo approve`, `papo session list --json`), and those commands are `@cofold/commands` actions, so they are the daemon's MCP and HTTP surface the day it wants them, and what a future ahpc can drive instead of its hand-written flag tables.
This is the first end-to-end use of the harness by a human, the validation the spec asks for.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | Package `@cofold/papo` in `packages/papo/`, binary `papo`; depends on `@cofold/{agents,commands,config,model-openai-compat,sdk,store-file,terminal}` (`workspace:^`) and `@textui/{chat,core,terminal,widgets}` as `link:../../../textui/packages/<name>` until textui 0.6.0 is on npm | User (2026-09-16): papo lives in cofold packages; textui is published, cofold depends on it, never the reverse |
| 2 | No host seam. `createChat()` (`src/chat.ts`) is papo's own service: `say`, `approve`, `deny`, `answer`, `cancel`, `remove`, `sessions`, `snapshot`, `models`, `wait`, `subscribe`. Both fronts call it; it calls `run` / `resume` | textui keeps components only; one definition, no adapter |
| 3 | Every read projects the store (`projectTurns`: messages + runs + pending request → `Turn[]` + `ChatPendingInput`); an attached `RunHandle` only wakes listeners. A session left `awaiting`/`running` by a dead process is resumed lazily by the first command that needs its handle | Screen and shell agree by construction; crash recovery is the harness's `resume()` |
| 4 | Turn = one run: `{ id: runId, input, parts: text / reasoning / tool / error, state, startedAt, endedAt? }`. Tool status from its result; without one, from the run: `pending-confirmation` (awaiting on that call), `running`, else `cancelled`. `toBlocks` flattens to `@textui/chat` `Block[]` | The store already holds everything the screen draws |
| 5 | Pending: approval → `ChatToolConfirmation` with the transcript's own `ChatToolCall` (same object) and one option `always` (harness `alwaysApprove`); input → `ChatInputRequest { message: '<tool> is asking', questions }` via `toChatQuestion` | CHAT-01 prop types |
| 6 | `cancel`: aborts a running turn; denies a waiting approval (a `cancel` command on a paused run only detaches, harness decision 86); refuses a waiting question (`invalid_options`: answer it or delete the session) | The harness has no other way to end a paused run |
| 7 | `Store.sessions.delete` added to the contract, both stores and the conformance suite; refuses only while the claim holder is a run with status `running` (a paused run keeps its claim but writes nothing) | Needed to delete a session stuck on a question |
| 8 | `ApprovalPayload` and `InputPayload` moved to `@cofold/agents` `types/store.ts` and exported | papo reads `PendingRequest.payload`; one definition |
| 9 | Config through `@cofold/config` (`name: 'papo'`): `~/.config/papo/config.json`, nearest `.papo.json`, `$PAPO_CONFIG`, `--config`; `PAPO_BASE_URL`/`PAPO_API_KEY` add or replace provider `default`; `PAPO_MODEL` chooses the default model. Validated with the sdk validator through `check` (`config.permissions must be one of ...`) | Same layering as every cofold program |
| 10 | Store root `resolveHome({ name: 'cofold' })` → `~/.cofold` / `FACIO_HOME`; global skills under `<home>/skills`, workspace skills under `<workspace>/.agents/skills`; agent id `papo`; `<workspace>/AGENTS.md` appended to the instructions | The future daemon shares the store |
| 11 | Model ref `<providerId>/<modelId>`, split at the first slash; absent → the first model the first provider lists, asked once | Provider ids are the config's, model ids may hold slashes |
| 12 | The agent is rebuilt from config per turn (`buildAgent`); policy by mode: `ask` → always, `destructive` → default, `auto` → never; tools: `ask_user` plus whatever the caller adds | Model or permission changes between turns are honest |
| 13 | Shell: actions `say`, `approve`, `deny`, `answer <session> <answers...>` (id=value words, repeated id → list), `cancel`, `session list/show/delete`, `models`, `config`, `chat`; all `mcp: true` but `config` and `chat`. A bare `papo` (words empty, not `--help`/`--version`) becomes `papo chat`, decided by the program's own tokenizer | Declared once; the screen is a command that lazily imports the renderer |
| 14 | `commandFor` fix: a variadic slot on an array field coerces each word against `items`, and a variadic slot on a non-array field is refused at registration | Found by `answer`; pinned in `command.test.ts` |
| 15 | Screen: `screen/{state,app,sessions,chat,tui}`; store paths under `$/papo/*`; controller on a service key; keys: `n d r` on the catalogue, `ctrl+c` stop-or-quit, `ctrl+n`, `esc`, `ctrl+p`, `alt+m`; header names the conversation only on the chat screen; no transcript caption once something was said | ahpc's shape, without the host |
| 16 | No stills (`--static`, `--svg`) in this cut: without a TTY the screen prints one frame and exits | Enough for a log; ahpc's still flags are a later addition |
| 17 | Streaming: whole text at `model.completed` until harness p5 | Decision 17 of the earlier plan, kept |
| 18 | `Settings { model, permissions, reasoning }` per session: the configuration's defaults (`model`, `permissions`, new `reasoning`: off, low, medium, high), each session's own in the workspace kv under `papo/session/<id>/settings`; `chat.settings(id?)`, `chat.configure(id, patch)`, `say({ settings })` for the first message; the agent is rebuilt from them per turn (`reasoning` becomes `params.reasoning.effort`, `off` sends none; `params.reasoning` left out of the config schema so there is one place) | User (2026-09-16): model selection, mode, thinking level were missing |
| 19 | Shell: `say -m -p -t` and `session set <id> -m -p -t`; `session show` prints the settings line. The global `--model` is gone (`PAPO_MODEL` and the config are the default; the session's own choice is the setting) | Two `--model` spellings would collide |
| 20 | Screen: three chips under the composer (`ComposerBar` through `ChatComposer.options`), each opening `openPicker` on a command with one argument (`compose.model` from `chat.models()`, `compose.permissions`, `compose.reasoning`); `$/papo/settings` holds the open session's settings or the draft a new conversation will start with; `tab` reaches the chips | ahpc's shape, with papo's own three questions |

## What was built

- `packages/papo/` as decision 1; `pnpm check` green: 34 papo tests (service, shell, projection, config, screen through `@textui/testing`), 4 new store-conformance and command cases.
- Settings (decisions 18-20): service, shell flags, chips and pickers, tested at all three layers.
- Harness: `Store.sessions.delete` (decision 7), payload types public (decision 8), variadic slot coercion (decision 14).
- `.project/plans/index.md`, `cli/00-cli.md`, `CLAUDE.md`, root `README.md` updated.

## Resume state

- **Done so far:** everything above, 2026-09-16.
- **Next action:** the screen against the real server (the shell is verified); a destructive demo tool; then textui 0.6.0 on npm → `link:` becomes `^0.6.0`.
- **Open questions:** whether ahpc adopts `@cofold/commands` + `@cofold/terminal` for its shell (user's call, separate plan in ahpc).
- **Watch out for:** p5 steering changes decision 6's `say` while running (`writer_busy` today) into a steer; `@textui/chat`'s `Block`/`ChatToolCall` shapes are 0.5.0's.

## Final verification checklist

- [x] `pnpm check` green with the new workspace.
- [x] Destructive tool → confirmation → approve runs once (service, shell and screen tests).
- [x] Cross-process approve: a second `createChat` on the same store approves what the first left waiting.
- [x] Manual run against a real model server: 2026-09-16, LM Studio at 10.255.10.10:1235 (`papo models` lists seven; `papo say` answers; the adapter smoke passes).
- [x] `index.md` updated.
