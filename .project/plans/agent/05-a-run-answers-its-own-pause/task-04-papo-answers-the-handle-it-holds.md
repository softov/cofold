---
title: papo answers the handle it holds
status: todo
depends: [task-02-the-run-waits-at-its-pause.md, task-03-every-handle-ends-with-run-finished.md]
layer: "papo"
refs:
  - "[code://packages/papo/src/chat.ts#L142-L167](../../../../packages/papo/src/chat.ts#L142-L167) - `attach`: detaches and settles the queue when `outcome` resolves"
  - "[code://packages/papo/src/chat.ts#L215-L228](../../../../packages/papo/src/chat.ts#L215-L228) - `handleFor`: the held handle, else `resume()`"
  - "[code://packages/papo/src/chat.ts#L235-L247](../../../../packages/papo/src/chat.ts#L235-L247) - `steerHeld`, called after a resume"
  - "[code://packages/papo/src/chat.ts#L249-L256](../../../../packages/papo/src/chat.ts#L249-L256) - `submitTo`, the approve, deny and answer path"
  - "[code://packages/papo/src/chat.ts#L451-L458](../../../../packages/papo/src/chat.ts#L451-L458) - `wait`, which returns the handle's `outcome`"
  - "[code://packages/papo/src/chat.ts#L486-L495](../../../../packages/papo/src/chat.ts#L486-L495) - `cancel` on a paused turn"
  - "[code://packages/papo/src/commands.ts#L203-L210](../../../../packages/papo/src/commands.ts#L203-L210) - `papo say` stops at `awaiting`"
  - "[code://packages/papo/src/queue.ts#L5](../../../../packages/papo/src/queue.ts#L5) - `awaiting` holds the queue"
---

## Objective

papo keeps a turn's handle attached across its pause and sends approve, deny, answer and cancel to it; `resume()` is called only for a run this process does not hold, which is a run another process left `awaiting` or `running`.

## Files

- `UPDATE: packages/papo/src/chat.ts:142-167` - `attach` detaches when the handle's `outcome` resolves, which is now the run's end; the entry also keeps the newest `run.finished` outcome it read.
- `UPDATE: packages/papo/src/chat.ts:211-256` - `handleFor` becomes `recover(sessionId)`: the attached handle when its run id is the newest run's, else `resume()` and `attach` (the restart case), with `steerHeld` kept for that case only.
- `UPDATE: packages/papo/src/chat.ts:451-458` - `wait` reads the attached handle's `events` and resolves with the next `run.finished` outcome, `awaiting` included, so `papo say` and the other three callers still stop at a pause; the handle's `outcome` no longer resolves there (decision 122).
- `UPDATE: packages/papo/src/chat.ts:486-495` - `cancel` cancels the attached handle whatever its status; `recover` only when nothing is attached.
- `UPDATE: packages/papo/src/chat.test.ts`, `packages/papo/src/commands.test.ts` - the cases below.

## Steps

1. Tests first, on the fake model and the memory store.
2. Rename and narrow `handleFor` as above; `submitTo` and `cancel` use the attached handle.
3. A steer while the attached turn waits is taken by the handle (task 02) rather than refused `not_running`, so `say` submits it there; the `held` path stays for a run paused by another process.
4. `queues.settled` keeps reading the final status from `outcome`; `awaiting` no longer arrives there from a live handle, and the queue's head still waits because the session is `awaiting` in `newest`.

## Validation

- `say`, then `approve` in the same `createChat`: the same `RunHandle` (by identity) carries the run to `completed`, and `resume` is not called (spy on the import or count handles).
- `deny` and `answer` the same way.
- A run left `awaiting` by one `createChat` and approved through a second `createChat` on the same store still completes (the restart case).
- `cancel` on a paused turn ends it `cancelled` with the interrupt marker.
- `papo say` on a turn that pauses prints the pending request and exits.
- `pnpm --filter @cofold/papo test` and `pnpm typecheck` are clean.

## Resume

