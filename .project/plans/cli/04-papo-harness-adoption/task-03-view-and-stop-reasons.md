---
title: The screen shows what the model sees, and says how a turn ended
status: todo
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

Decisions [CLI-04.3](../../../decisions/papo-hides-compacted-history.md) and [CLI-04.4](../../../decisions/papo-stopped-reason-states.md): after a compaction the screen shows the model's view with "N tokens to M"; a hook stop is complete, a limit stop is failed with its reason; papo's own deny-on-cancel goes ([120](../../../decisions/cancel-denies-pending-request.md)).

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

