---
title: ahpd drops its pause workarounds
status: todo
depends: [task-04-papo-answers-the-handle-it-holds.md, task-05-the-examples-and-the-readme.md]
layer: "ahpd, after a cofold release"
refs:
  - file:///github/ahpd/packages/agent-cofold/src/pauses.ts - lines 55-125: `owePause`, `payPause`, `rejoin`, `route`, and the paused branch of `stopNow`
  - file:///github/ahpd/packages/agent-cofold/src/runs.ts - lines 186-190 record `ctx.paused` from `run.finished { awaiting }`; lines 215-226 synthesize a missing `run.finished`
---

## Objective

Once `@cofold/agents` with this plan is released, ahpd sends a command to the handle it holds and stops synthesizing `run.finished`; this work is done in an ahpd plan, not in cofold.

## Files

- `UPDATE: ahpd packages/agent-cofold/src/pauses.ts:55-125` - `route` submits to `ctx.handle`; `owePause`, `payPause` and `rejoin` go, and `stopNow` cancels the held handle; `rejoin` stays only if ahpd still needs it for a run another process left.
- `UPDATE: ahpd packages/agent-cofold/src/runs.ts:186-190,215-226` - the pause is read from the live stream; the fallback `run.finished` goes.

## Steps

1. After the cofold release, open an ahpd plan that takes the new `@cofold/agents` and lists these removals; cofold changes nothing here.
2. Mark this task `done` when that ahpd plan exists, with its path in *Resume*.

## Validation

- The ahpd plan names this task and the cofold version it needs.

## Resume

