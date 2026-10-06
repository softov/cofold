---
title: Every handle ends with run.finished
status: todo
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

