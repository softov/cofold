---
title: papo answers the handle it holds
status: done
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

- **Built:** `handleFor` became `recover(sessionId)`: the attached handle when it holds the newest run, else `resume()` (with `steerHeld`) and `attach`, which is the restart case. `submitTo` and `cancel` go through `recover`, so approve, deny and answer land on the handle the pause left open. `attach` folds the newest `run.finished` outcome into a fresh `Stop` deferred at each pause, and `wait` returns that deferred: the pause's `awaiting` first, the final status after the answer, so `papo say` and the three other `wait` callers still stop at a pause while the handle's own `outcome` resolves once, at the end. `close()` cancels only the handles that are working and leaves an `awaiting` one alone, which is what makes `papo say` then `papo approve` across two invocations work.
- **`say` was left as it is.** Its `writer_busy` while the session already waits on a decision is decision CLI-05.4's own rule, and its `not_running` catch still hands the text to `Queued.steer` for a run this process has let go of. Step 3's "`say` submits it there" is met by the harness: a steer sent while a live handle waits goes into that turn (task 02), so no papo change was needed for it.
- **Deviation from the Files list:** `recover` passes `afterSeq` (the last event the store holds) to `resume()`, so a resumed handle reads from where the store's events end rather than replaying the pause it is about to answer. Without it a `wait` issued right after `approve` could take the replayed `run.finished { awaiting }` and report a pause the run had already left.
- **Tests:** `chat.test.ts` answers the pause on the handle it already holds and counts the `resume` calls through a mocked `@cofold/agents` - the count moving by exactly one for a same-process second chat, which is refused, is what shows the spy is live rather than vacuous. A second process is modelled by `otherProcess`: `vi.doUnmock` plus `vi.resetModules` plus a fresh `import('./testing.js')`, so the second registry really is a second `@cofold/agents` with its own live runs. The two steer tests were rewritten: a steer submitted while a turn runs now survives the pause it meets instead of being refused.
- **Validation:** every item passes except the last, which is clean for the two gates it names. `packages/papo` is 139/139 (`chat.test.ts` 29/29), and the root `pnpm typecheck` is clean.
- **Not clean:** the root `pnpm test` fails one test outside this task - see the plan's *Open, needs a decision* about `packages/store-file/src/store.test.ts`, which still needs an answer from Softov. `packages/papo`'s `screen.test.ts` is timing-flaky under the root run's parallel load (a different 4-5s test times out each run; 15/15 when the file runs alone) and is unrelated to this change.
