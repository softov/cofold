---
title: The answer appears as it is written
status: todo
depends: [task-01-steer-and-queue.md]
layer: papo
refs:
  - code://packages/papo/src/chat.ts#L108-L121 - `attach`, the only reader of `handle.events`
  - code://packages/papo/src/turns.ts#L7-L16 - `ProjectionInput`; gains `draft`
  - code://packages/papo/src/turns.ts#L44-L60 - the parts of the running turn
  - code://packages/papo/src/blocks.ts#L28-L29 - `streaming: last` on prose and reasoning blocks
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-05-streaming.md - `model.delta { step, kind, text }` (decisions 102, 103)
---

## Objective

Decision [CLI-04.2](../../../decisions/papo-draft-from-handle.md): the running turn shows the text and reasoning being written, folded from `model.delta` in memory.

## Files

- `UPDATE: packages/papo/src/chat.ts:15-43,108-121` - `Attached.draft?: Draft`; `attach` folds deltas, clears at `model.completed`; `snapshot` passes the draft.
- `UPDATE: packages/papo/src/types/turn.ts` - `Draft { runId, step, text, reasoning }`.
- `UPDATE: packages/papo/src/turns.ts:7-16,44-60` - `ProjectionInput.draft?`; the running turn gets a `reasoning` part then a `text` part from the draft after its stored parts.
- `UPDATE: packages/papo/src/blocks.ts:28-29` - those parts are the `streaming: true` blocks.
- `UPDATE: packages/papo/src/turns.test.ts`, `chat.test.ts` (with `createFakeModel({ stream: true })`).

## Steps

1. In `attach`: `if (event.type === 'model.delta') { const d = entry.draft ??= { runId, step: event.step, text: '', reasoning: '' }; if (d.step !== event.step) { d.step = event.step; d.text = ''; d.reasoning = ''; } d[event.kind] += event.text; } else if (event.type === 'model.completed') entry.draft = undefined;` then `notify(sessionId)` as today.
2. `snapshot` reads `attached.get(sessionId)?.draft` into `ProjectionInput.draft`; `projectTurns` appends, to the turn whose `runId` matches, a `reasoning` part (when non-empty) and a `text` part from the draft, ids `${runId}:draft:reasoning` / `${runId}:draft:text`; `toBlocks` marks them `streaming: true`.
3. Tests: a streaming fake model's turn shows the growing text between `model.started` and `model.completed`; after completion the draft is gone and the stored text is shown once; a session opened by a second `createChat` on the same store shows nothing until completion.

## Validation

- `pnpm check`; `papo` against LM Studio: the answer streams.

## Resume

