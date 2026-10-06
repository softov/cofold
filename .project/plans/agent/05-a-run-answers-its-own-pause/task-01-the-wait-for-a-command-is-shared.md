---
title: The wait for a command is shared
status: done
depends: []
layer: "agents"
refs:
  - "[code://packages/agents/src/run/resume.ts#L32-L33](../../../../packages/agents/src/run/resume.ts#L32-L33) - `liveResumes`"
  - "[code://packages/agents/src/run/resume.ts#L139-L179](../../../../packages/agents/src/run/resume.ts#L139-L179) - `waitForCommand`, a closure over `resume()`'s `accept`, `abort`, `store`, `sessionId`, `runId`"
  - "[code://packages/agents/src/run/resume.ts#L254-L276](../../../../packages/agents/src/run/resume.ts#L254-L276) - `validateCommand`"
  - "[code://packages/agents/src/types/turn.ts](../../../../packages/agents/src/types/turn.ts) - `TurnContext`, which gains the acceptor slot"
---

## Objective

`waitForCommand`, `validateCommand` and the set of runs attached in this process live in `run/answer.ts`, take what they need from the `TurnContext`, and `resume()` uses them with no change in behaviour.

## Files

- `CREATE: packages/agents/src/run/answer.ts` - `liveRuns`, `waitForCommand(ctx, pending)`, `validateCommand(ctx, pending, command)`, and the `STOPPED` reason, moved from `resume.ts`.
- `UPDATE: packages/agents/src/types/turn.ts` - `TurnContext.accept?: (command) => Promise<void>`: the acceptor while a request is open, cleared once a command is taken.
- `UPDATE: packages/agents/src/run/resume.ts:32-38,139-179,254-276` - the moved code goes; `resume()`'s `onCommand` waits for `ready` and then calls `ctx.accept`, or throws `not_found` "run <id> is not awaiting a command" when it is unset.

## Steps

1. Move the three pieces; `waitForCommand` reads `ctx.store`, `ctx.sessionId`, `ctx.runId`, `ctx.abort` and sets `ctx.accept` where it set the closure's `accept`.
2. `resume()` keeps its `ready` gate and its `liveRuns` check where `liveResumes` was.
3. No other change: this task is a move.

## Validation

- `packages/agents/src/run/resume.test.ts`, `interrupt.test.ts`, `steering.test.ts` pass unchanged.
- `pnpm --filter @cofold/agents test` and `pnpm typecheck` are clean.

## Resume

