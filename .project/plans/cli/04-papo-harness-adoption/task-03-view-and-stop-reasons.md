---
title: The screen shows what the model sees, and says how a turn ended
status: done
depends: [task-02-draft.md]
layer: papo
refs:
  - code://packages/papo/src/turns.ts#L27-L47 - `projectTurns` slices messages per run; `summary` messages become a part
  - code://packages/papo/src/turns.ts#L64,L86-L89 - the error part; `stateOf`
  - code://packages/papo/src/blocks.ts#L33-L34 - the summary notice text
  - code://packages/papo/src/chat.ts#L281-L292 - `cancel`'s own deny, removed with decision 120
  - code://packages/papo/src/commands.ts#L249,L394 - `session.show`; the `stopped` line
  - code://packages/papo/src/claude/project.ts#L20-L21 - the Claude backend already projects the compacted view
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-08-second-adapter.md - `contextOf` export, `context.compacted.afterTokens`, decision 120
---

## Objective

cli/03 F1 and decision 97 in papo: after a compaction the screen shows the model's view with "N tokens to M"; a hook stop is complete, a limit stop is failed with its reason; papo's own deny-on-cancel goes ([120](../../../decisions/cancel-denies-pending-request.md)).

## Files

- `UPDATE: packages/papo/src/chat.ts` - `snapshot` projects `contextOf(messages)`; `session.show --all` reads the store's full list; `cancel` drops the deny branch.
- `UPDATE: packages/papo/src/turns.ts:27-47,64,86-89` - runs whose input message is not in the view are skipped; the summary part carries `before` / `after` tokens from the run's `context.compacted` event (read from `input.compactions?: Record<runId, { before, after }>` that `snapshot` fills from `listEvents` of the compacting run once, when it settles); `stateOf(run, reason)`.
- `UPDATE: packages/papo/src/blocks.ts:33-34` - notice "Context compacted: N tokens to M."
- `UPDATE: packages/papo/src/commands.ts:249,394` - `--all` on `session show`; the `stopped: <reason>` line.
- `UPDATE: packages/papo/src/turns.test.ts`, `chat.test.ts`, `commands.test.ts`.

## Steps

1. `snapshot`: `const messages = contextOf(await store.sessions.listMessages({ sessionId }))` for the screen; `projectTurns` skips a run whose `inputMessageId` is absent from `messages`. `session show --all` passes the full list.
2. The compaction numbers: `snapshot` keeps `compactions` per session (in memory, filled when a `context.compacted` event is seen in `attach`, and on first read from the compacting run's events); the summary part gets `{ before: estimatedTokens, after: afterTokens }`; `toBlocks` prints the notice with them.
3. `stateOf`: `stopped` with `reason === 'hook'` → `complete`; other `stopped` → `failed` and `errors[runId] = 'stopped: <reason>'` (the run's last `run.finished` event carries the outcome; `snapshot` already reads errors from it).
4. `cancel`: the branch `if (run?.status !== 'awaiting') return; await chat.deny(...)` becomes `held.handle.cancel(...)` on the attached (or lazily resumed) handle; the harness denies (decision 120).
5. Tests: after `compact()`, the snapshot lists the summary turn with the notice and the tail, not the older turns; `--all` lists them; a `beforeTool` stop hook → `complete`; `maxToolCalls: 0` → `failed` with `stopped: max_tool_calls`; cancel on an awaiting session → the request is resolved `deny` by the harness and the turn is `cancelled`.

## Validation

- `pnpm check`; `chat-contract.test.ts` scenarios on both backends read alike after `/compact` and after an interrupt.

## Resume

- **Done (2026-09-16):** `snapshot(sessionId, { all? })` projects `contextOf(all)` for the screen and the whole list on `--all`; `session show --all` passes it.
  `projectTurns` places a run where its input message is and slices up to the next *placed* run (the old slice ran to the next run's input whether or not the view held it); a run whose input a summary covers is not shown; what precedes the first placed run (the summary `contextOf` moves to the front) becomes the compaction turn: input `COMPACTED_INPUT` (`(context compacted)`, the constant moved from `claude/project.ts` to `turns.ts` so both backends say the same), one `summary` part with `before` / `after`, and the compacting run's id, state, usage and steps when that run has no place of its own (a `compact()` run, whose ask is covered); an auto-compaction's run keeps its place and the summary turn stands on the message's id.
  Compaction numbers: `Compaction { runId, before, after }` in `types/turn.ts`, cached in `chat.ts` by the summary message's id (messages carry no run id; the `context.compacted` event names both) from `attach`, or on first read by scanning the runs' events newest-first (`compactionsOf`); a summary whose event is not there yet is asked about again.
  `toBlocks`: `compactedNotice(part)` prints `Context compacted: N tokens to M.` (the old sentence when the numbers are unknown, the Claude backend's case); the shell's `renderTurn` prints summaries and notices; `toMarkdown` adds the numbers.
  Stop reasons: `snapshot` reads the last `run.finished` event of `failed` and `stopped` runs into `errors` and `stopped: Record<runId, StopReason>`; `stateOf(run, stopped)` maps `stopped` + `hook` to `complete` and any other `stopped` to `failed` with the error part `stopped: <reason>` (`stopped` alone when the event is missing); the shell's `Stopped:` line is skipped for `hook`.
  The interrupt marker (cli/03 F4): a later `source: 'system'` user message in a turn is a `notice` part, `INTERRUPTED` without its brackets, as the Claude backend shows the CLI's.
  `cancel` on an awaiting run: `handleFor` (which resumes the run when another process left it) and `handle.cancel()`; the harness denies the request `The turn was stopped` and ends the turn `cancelled` (decision 120); papo's own deny is gone.
  `renderOutcome(snapshot, outcome, { runId, note })` prints the turn of the run the command started, falling back to the last (the compaction turn leads the view, so `compact` would otherwise have printed the tail).
- **Evidence:** `turns.test.ts` (+3: stop reasons, the view with a `compact()` run, an auto-compaction and `--all`, the marker), `chat.test.ts` (cancel on an awaiting run, from the process that ran it and from a second one; the compaction view, `--all`, the numbers read by a second process from the events; `maxToolCalls: 1` → `failed` with `stopped: max_tool_calls`), `commands.test.ts` (`compact` prints the notice with numbers, `session show` and `--all`), `screen.test.ts` (`/compact` shows `(context compacted)`, `Context compacted:`, the tail), `chat-contract.test.ts` cancel on both backends (`cancelled`, the tool failed `The turn was stopped`, the notice `Request interrupted by user`), `claude/chat.test.ts` cancel.
  `pnpm vitest run --project @cofold/papo`: 8 files, 111 tests green; `@cofold/papo` build and typecheck green.
- **Deviations:** `compactions` is keyed by the summary message's id and carries `runId`, not `Record<runId, { before, after }>`: the projection needs to know which run wrote the summary, and the message does not say.
  The compaction turn's input is `(context compacted)` rather than the covered ask: the plan named the turn and not its words, and the contract (cli/03 decision 10) wants both backends to read alike.
  The Claude backend's `cancel` on a pending decision now denies it `The turn was stopped` *and* interrupts the CLI (ahpd's cancel does both; the backend only denied, so a cancel there let the turn go on to its reply): a gap against the reference in cli/03's backend, fixed here so the contract's cancel scenario reads alike; the fake SDK ends a turn `aborted_tools` when a decision is denied under an `interrupt()`.
  A hook stop (`stopped { reason: 'hook' }` → complete) is tested at the projection only: papo's configuration has no hook slot to install a `beforeTool` stop from a test.
  A run whose input message never landed and is not covered by a summary is still shown with an empty input (the plan's "skipped" applies to covered runs), so a run that failed before writing its input keeps its error visible.
- **Found, not acted on:** the Claude backend's projection has no `cancelled` turn state (an interrupted turn reads `complete` with the notice), while the harness's reads `cancelled`; the contract asserts the parts and the outcome, not the turn state.
  `Turn` carries no `cost`; the plan's goal names `cost` among what papo adopts but no task step does, so `/cost` still shows tokens only.
- **Not run:** the terminal check of *Validation* (LM Studio).

