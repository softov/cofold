---
title: Every handle ends with run.finished
status: done
depends: [task-02-the-run-waits-at-its-pause.md]
layer: "agents"
refs:
  - "[code://packages/agents/src/run/handle.ts#L59-L60](../../../../packages/agents/src/run/handle.ts#L59-L60) - `publish` and `finish`"
  - "[code://packages/agents/src/run/run.ts#L91-L99](../../../../packages/agents/src/run/run.ts#L91-L99) - setup failure with and without a context"
  - "[code://packages/agents/src/run/turn.ts#L270-L280](../../../../packages/agents/src/run/turn.ts#L270-L280) - `superseded`, and a `finishRun` that throws"
  - "[code://packages/agents/src/run/resume.ts#L74-L79](../../../../packages/agents/src/run/resume.ts#L74-L79) - `finishDetached`, the handle-only finishes of `resume()`"
  - "[code://packages/agents/src/run/resume.ts#L278-L285](../../../../packages/agents/src/run/resume.ts#L278-L285) - `storedOutcome`, which already reads a missing `run.finished` as `interrupted`"
  - file:///github/ahpd/packages/agent-cofold/src/runs.ts - lines 215-226, the event ahpd synthesizes today
---

## Objective

When a handle finishes and the last event it published is not a `run.finished` with that outcome, the handle publishes one itself, with the next seq, not stored; so a host never sees a stream end without one.

## Files

- `UPDATE: packages/agents/src/run/handle.ts` - `createRunHandle` takes `agentId` and an optional `startSeq`; `finish(outcome)` publishes the missing `run.finished` before it closes.
- `UPDATE: packages/agents/src/run/run.ts:38` - passes `agentId: args.agent.definition.id`.
- `UPDATE: packages/agents/src/run/resume.ts:54` - passes `agentId: agent.definition.id` and `startSeq: args.afterSeq ?? 0`.
- `UPDATE: packages/agents/src/run/run.test.ts`, `resume.test.ts` - the cases below.

## Steps

1. Tests first.
2. In `finish`: the next seq is one past the highest seq the handle published, or `startSeq + 1` when it published none; `at` is now; the event goes through `buffer` only, never the store and never `onEvent`.
3. The check is "the last buffered event is `run.finished` and its `outcome.status` is the finishing outcome's status", so a `run.finished { awaiting }` mid-stream does not count as the end.

## Validation

- A store whose `sessions.get` throws: the `run()` stream holds one `run.finished { failed }`; fails first with none.
- A duplicate `messageId`: the stream ends with `run.finished { failed, code: already_exists }`.
- A store whose `runs.update` throws in `finishRun`: the stream ends with `run.finished` carrying the outcome.
- `superseded`: the stream ends with `run.finished { failed, code: superseded }`, and the store holds no event for it.
- A completed run publishes exactly one `run.finished`.
- `resume()` of a terminal run with `afterSeq` past its last event still ends its stream with a `run.finished`.
- `pnpm --filter @cofold/agents test` is clean.

## Resume

Built. `createRunHandle` takes `agentId` and an optional `startSeq` and tracks the last seq it published; `finish(outcome)` pushes a `run.finished` into the buffer when the last buffered event is not one carrying that status, with the next seq and the current time. It goes through `buffer` only: not stored, not handed to `onEvent`. `run.ts` passes `agentId` and takes the default `startSeq` of 0; `resume.ts` passes `agentId` and `startSeq: args.afterSeq ?? 0`, so a handle reattached past the last event numbers its synthesized event from where it started reading.

Tests: a new `describe('run: every handle ends with run.finished (decision 122)')` in `run.test.ts` covers a `sessions.get` that throws, a `runs.update` that throws in `finishRun`, `superseded` from a `seq_gap`, and a completed run publishing exactly one `run.finished` with the store holding it too. `resume.test.ts` gained a terminal run resumed with `afterSeq: 99`, whose stream is one synthesized `run.finished` at seq 100. Two existing tests that asserted an empty stream now assert the one synthesized event: the duplicate `messageId` in `run.test.ts` and the unknown run in `resume.test.ts`.

`pnpm --filter @cofold/agents test`: 211 passed (21 files). `pnpm --filter @cofold/agents typecheck` and the root `pnpm typecheck`: clean.

Found that the plan did not know: `packages/store-file/src/store.test.ts`'s "a session folder copied to another root resumes there" pauses a run with `run()` and reads the `awaiting` outcome, which decision 122 moved to `events`; with the run's handle now holding the run in `liveRuns`, the same-process `resume()` of root B is refused `writer_busy`. The plan names no work for store-file, and the file's own tests are the ones task 04 changes. Reported rather than chosen: see the plan's *Resume state*.

The root `pnpm test` is red until task 04 lands: 22 failures, all in hosts that still answer a pause through `resume()` (`packages/papo`'s three test files) plus this one store-file case.
