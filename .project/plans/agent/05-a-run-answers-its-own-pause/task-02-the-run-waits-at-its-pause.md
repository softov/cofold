---
title: The run waits at its pause on its own handle
status: done
depends: [task-01-the-wait-for-a-command-is-shared.md]
layer: "agents"
refs:
  - "[code://packages/agents/src/run/turn.ts#L335-L344](../../../../packages/agents/src/run/turn.ts#L335-L344) - the two `pause()` calls in `processCalls`"
  - "[code://packages/agents/src/run/turn.ts#L388-L401](../../../../packages/agents/src/run/turn.ts#L388-L401) - `pause()`"
  - "[code://packages/agents/src/run/turn.ts#L302-L349](../../../../packages/agents/src/run/turn.ts#L302-L349) - `processCalls`, whose `resolved` already applies a command to the first call of a batch"
  - "[code://packages/agents/src/run/run.ts#L34-L46](../../../../packages/agents/src/run/run.ts#L34-L46) - `start()` builds the handle with no `onCommand`"
  - "[code://packages/agents/src/run/handle.ts#L12-L61](../../../../packages/agents/src/run/handle.ts#L12-L61) - `createRunHandle`; `steer` throws once `closed`"
  - "[code://packages/agents/src/run/resume.ts#L61-L68](../../../../packages/agents/src/run/resume.ts#L61-L68) - a steer on a resumed handle waits while the request is open"
  - "[code://packages/agents/src/run/resume.ts#L122-L127](../../../../packages/agents/src/run/resume.ts#L122-L127) - after the command: heartbeat, the rest of the batch"
  - "[code://packages/agents/src/run/abort.ts#L16-L17](../../../../packages/agents/src/run/abort.ts#L16-L17) - the timeout timer"
  - "[code://packages/agents/src/types/run.ts#L38-L47](../../../../packages/agents/src/types/run.ts#L38-L47) - `RunHandle` doc comments"
---

## Objective

A run that pauses records the request and `awaiting`, announces it, and waits on its own handle; `approve`, `deny` or `answer` on that handle continues the batch and the run on the same handle, and the same holds for a `resume()` handle that pauses again.

## Files

- `UPDATE: packages/agents/src/run/turn.ts:335-344,388-401` - `pause()` returns the persisted command or `undefined`; `processCalls` applies it to the paused call and goes on with the rest of the same `calls`.
- `UPDATE: packages/agents/src/run/run.ts:34-46` - the handle's `onCommand` calls `ctx.accept`, or throws `not_found` "run <id> has no open request" when unset; the run joins `liveRuns` while it waits.
- `UPDATE: packages/agents/src/run/handle.ts`, `packages/agents/src/types/turn.ts` (`InternalRunHandle`) - an internal `setStatus(status)` for the pause and the continue; `steer` while `status()` is `awaiting` enqueues; `finish` is called once, at the run's end.
- `UPDATE: packages/agents/src/run/abort.ts:17` - `timer.unref?.()`.
- `UPDATE: packages/agents/src/types/run.ts:38-47` - `status()` may read `awaiting` and then `running` again; `events` ends after the `run.finished` that is not `awaiting`; `outcome` resolves when the run ends.
- `UPDATE: packages/agents/src/run/run.test.ts`, `resume.test.ts`, `interrupt.test.ts`, `steering.test.ts` - the cases below; tests that read `awaiting` from a `run()` outcome read it from the events instead.

## Steps

1. Tests first.
2. `pause()`: `requests.create`; `runs.update(awaiting)` with the tally; clear the heartbeat; start `waitForCommand(ctx, pending)` so `ctx.accept` is set; then emit `approval.requested` or `input.requested`, `run.paused` and `run.finished { awaiting }`; set the handle's status to `awaiting` without closing it and without resolving `outcome` (decision 122: it resolves once, at the run's end); await the command.
3. On a command: restart the heartbeat (`startHeartbeat`), set the status back to `running`, and return `{ pending, command }`; `processCalls` calls `applyResolved` for that call and continues the loop at `i + 1`.
4. On `undefined` (the write of the command failed and the run was finished): `processCalls` returns `done`.
5. A cancel while waiting goes through `waitForCommand`'s deny (decision 120), so the batch continues with the deny and the loop's abort check finishes the run `cancelled`.
6. `resume()` reaches the same code: a resumed run that pauses again waits on its handle rather than settling.
7. Update the `RunHandle` doc comments.

## Validation

- `run()` paused on an approval: `submit({ type: 'approve' })` on that handle runs the tool once and `outcome` is `completed`; fails first with `not_found`.
- `run()` paused on `ask_user`: `answer` and `deny` on that handle each continue to `completed`.
- Order: the events are `approval.requested`, `run.paused`, `run.finished { awaiting }`, `approval.resolved`, `run.resumed`, ..., `run.finished { completed }`; the run record is `awaiting` when `approval.requested` is published (checked from an `onEvent` observer reading `store.runs.get`).
- An `approve` submitted from inside an `onEvent` observer of `approval.requested` is taken.
- A batch of two calls where the first pauses: after `approve`, the second call runs in order.
- `cancel` while waiting: the request is denied with "The turn was stopped" and the run ends `cancelled` with the interrupt marker.
- A steer while waiting lands after the command, before the next model step.
- A second pause in the same run waits again on the same handle.
- `resume()` in the same process of a run whose `run()` handle is waiting is refused `writer_busy`.
- `pnpm --filter @cofold/agents test` and `pnpm typecheck` are clean.

## Resume

Built. `pause()` in `run/turn.ts` now returns the persisted decision: `requests.create`, `runs.update(awaiting)`, the heartbeat cleared, the status moved to `awaiting` and `waitForCommand` installed all come before the announcement; `processCalls` loops the call through `pause` and `applyResolved` until it has a result, so the rest of the batch keeps its order. `pause` joins `liveRuns` for the wait (unless a `resume()` already holds it) and leaves it when the command arrives. `run.ts`'s `start()` passes an `onCommand` that reaches `ctx.accept`, `handle.ts` requires it and gained `setStatus`, `abort.ts` unrefs the timeout timer, and the `RunHandle` doc comments describe the pause.

Found while building, the plan did not know: a command submitted from inside an `onEvent` observer of `approval.requested` is taken, but its `approval.resolved` can be published before the pause's own `run.paused` and `run.finished { awaiting }`, because the observer's `submit` gets a microtask's head start. The strict order holds on the ordinary path and the test asserts it there; the observer case asserts the ends plus the presence of the three events.

Two new test cases in `run.test.ts` under "a run answers its own pause (decision 122)"; the pause-reading tests in `run.test.ts`, `resume.test.ts`, `steering.test.ts`, `denials.test.ts`, `cost.test.ts` and `deferred.test.ts` read the `awaiting` outcome from the events and drop the live entry with `liveRuns.delete(runId)`, standing in for the process that paused the run having exited. `interrupt.test.ts` needed no change (it never pauses).

`pnpm --filter @cofold/agents test`: 206 passed (21 files). `pnpm --filter @cofold/agents typecheck`: clean.

