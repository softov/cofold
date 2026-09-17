---
title: CLI-04 - papo adopts the harness's p5 and agent/04 - implemented
date: 2026-09-16
refs:
  - git://1705e4ff6d3f2bd0bdf9ffa886560537d1d637d8 - the last commit before this plan's work; everything below is uncommitted on top of it
  - code://packages/papo/src/chat.ts - `say` steers, `attach` folds the draft and the compaction numbers, `snapshot` over `contextOf`, `cancel` on the handle, `allowAlways`
  - code://packages/papo/src/queue.ts - the next turns, in memory, for both backends
  - code://packages/papo/src/turns.ts - the projection over the model's view; `stateOf(run, stopped)`; the marker as a notice
  - code://packages/papo/src/agent.ts - `policyOf(mode, workspace)`, `mergedRules`, `rules()` handed to `createAgent`
  - code://packages/papo/src/rules.ts - `parseRule`, `formatRule`, `checkRules`
  - code://packages/papo/src/commands.ts - `queue`, `unqueue`, `session show --all`, `session set --deny/--ask/--allow`, `session rules`
  - code://packages/tools/src/files.ts - the path tools' normalized `subject` (decision CLI-04.6)
---

papo over `@facio/agents` now does what Claude Code does for the same acts: a message typed while the model answers steers it or waits its turn (and a message queued while nothing runs starts at once); the answer appears as it is written; after a compaction the screen shows what the model sees, with the tokens before and after; a turn a hook ended reads as finished and one a limit ended says which; a cancel on a waiting decision ends the turn with the harness's marker; the permission modes are Claude's four, over the tools' declared effects, and rules live in the configuration and per session, `always` being a session allow rule.

## What was built

- `code://packages/papo/src/chat.ts`, `queue.ts`, `types/chat.ts` - `say` steers a running turn (`submit({ type: 'steer' })`, `not_running` falls through to a new run); `queue` / `unqueue` / `queued` and `Snapshot.queued` over `createQueues()` (one list per session, in memory, both backends); the head starts on `completed | stopped | failed`, or at once while the session is idle, never after a cancel until the person speaks (CLI-04.1; task 01, amended with task 02).
- `code://packages/papo/src/chat.ts`, `turns.ts`, `blocks.ts`, `types/turn.ts` - `Draft { runId, step, text, reasoning }` folded from `model.delta` in `attach`, cleared at `model.completed`, projected as `streaming` reasoning and text parts of the running turn (CLI-04.2; task 02).
- `code://packages/papo/src/chat.ts`, `turns.ts`, `blocks.ts`, `export.ts`, `commands.ts` - `snapshot(sessionId, { all? })` projects `contextOf(all)`; a run is placed at its input and sliced to the next placed run; a run a summary covers is hidden; the summary the view starts with is the compaction turn `(context compacted)` with `Context compacted: N tokens to M.` (`Compaction` from `context.compacted`, cached by summary id, read from the events when another process compacted); `session show --all` shows everything; `stateOf(run, stopped)` reads `stopped { reason }`: `hook` → complete, the rest → failed `stopped: <reason>`; the interrupt marker is a `notice` (cli/03 F1, F4; decision 97; task 03).
- `code://packages/papo/src/chat.ts`, `claude/chat.ts`, `claude/testing.ts` - `cancel` on an awaiting run cancels the handle (resumed when another process left it) and the harness denies `The turn was stopped` and ends the turn `cancelled` (decision 120); the Claude backend's cancel denies the decision with the same words and interrupts the CLI, as ahpd does (task 03).
- `code://packages/tools/src/files.ts` - `read_file`, `write_file`, `edit_file` declare their subject as the resolved path, relative with forward slashes inside the workspace and absolute outside (CLI-04.6; task 04).
- `code://packages/papo/src/types/config.ts`, `types/settings.ts`, `config.ts`, `agent.ts`, `rules.ts` - `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk'`; `RuleLists`; `PapoConfig.rules` and `Settings.rules`; `policyOf(mode, workspace)` over `ToolEffects` (`acceptEdits` checks `resolveWithin(...).inside`); `mergedRules` (session first); `rules({ ...merged, otherwise })` handed to `createAgent`; `parseRule` / `formatRule` / `checkRules` (cli/03 F8; CLI-04.5, CLI-04.6; task 04).
- `code://packages/papo/src/chat.ts` - `approve({ always })` appends `{ tool }` to the session's `rules.allow`; `alwaysApprove` is no longer written (CLI-04.5; task 04).
- `code://packages/papo/src/claude/chat.ts` - `permissionMode: chosen.permissions` (with `allowDangerouslySkipPermissions` under `bypassPermissions`); a mode change restarts the process; the `auto` shortcut and the `ask` warning are gone (task 04).
- `code://packages/papo/src/commands.ts`, `screen/app.tsx`, `screen/chat.tsx`, `blocks.ts` - shell: `queue`, `unqueue`, `session show --all`, `session set --deny/--ask/--allow`, `session rules`, `-p` with the four names, `Stopped:` skipped for `hook`, summaries and notices printed; screen: the Queue chip and queued rows, the four modes on the chip and in the picker, the compaction notice.
- `code://packages/papo/src/testing.ts` - `testChat({ stream, afterDelta })` over `createFakeModel({ stream: true })`; `deleteFileTool` names its path as subject; `gateTool`.

## Verified

- `@facio/papo`: 8 test files, 117 tests (`chat.test.ts` 22, `chat-contract.test.ts` 24 on both backends, `commands.test.ts` 11, `turns.test.ts` 13, `screen.test.ts` 10, `claude/chat.test.ts` 20, `claude/project.test.ts` 7, `config.test.ts` 10); build and typecheck green.
- `@facio/tools`: 4 files, 24 tests (the subject assertions).
- Full `pnpm check` on 2026-09-16: 67 test files, 761 tests, no type errors; run twice more after the `wait` fix below, green both times.
- A flake seen once under the full workspace's load (`claude/chat.test.ts`, the queue scenario: `wait` right after a settle found no turn because the head's `say` was still awaiting the settings): `Queues.starting(sessionId)` now exposes the head's start in flight and both backends' `wait` take the attached turn synchronously, then await a starting head before looking again; the tests' bridging sleeps are gone.
- Not run: papo in a terminal against LM Studio (typing during an answer, the stream, `/compact`, `session set --deny` on a real shell); the real Claude CLI for the cancel and the mode pass-through.

## Departures from the plan

- CLI-04.1 - a message queued while the session is idle starts at once (user, 2026-09-16), where task 01 had it wait for the next settle; `Queues.add` is async over `QueueDeps.idle`.
- CLI-04.2 - `TurnPart` text and reasoning carry `streaming?: true` for the draft parts; the plan named the effect, not the carrier.
- Task 03 - `compactions` is keyed by the summary message's id and carries `runId` (messages have no run id); the compaction turn's input is `(context compacted)`, the Claude backend's words, so both backends read alike; the Claude backend's cancel on a pending decision now denies and interrupts (a gap against ahpd in cli/03's backend, fixed here).
- CLI-04.6 - `acceptEdits` is the mode's own check, not an allow rule, so `policyOf` returns the `decide` alone; the path tools' subject changed in `@facio/tools`.
- Task 04 - `byEffects` allows a tool that declares no effect at all (`ask_user`, `load_tools`), where the plan's block required `reads === true`; the config key is `rules` next to `permissions` where CLI-04.5 wrote `permissions.rules` (`permissions` is the mode string in the file and in `Settings`); the Claude backend restarts the process on a mode change instead of `setPermissionMode`, since `bypassPermissions` needs an option the SDK takes only at start.
- `alt+enter` does not queue (textui's `TextArea` takes it as a newline); the Queue chip and `/queue` do.
- `Queues` gained `starting(sessionId)` and `Chat.wait` covers a queued head that is starting (the flake above); not in the plan.

## Left for later

- See [deferred.md](deferred.md): `plan` mode, `alt+enter`, `Turn.cost`, the manual runs, a default allow for `memory_write`, the `steer` part name, the Claude backend's `cancelled` turn state.
