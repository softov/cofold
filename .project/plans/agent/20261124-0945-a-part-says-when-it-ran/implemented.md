---
title: A part says when it ran - implemented
date: 2026-11-24
refs:
  - "[code://packages/agents/src/types/message.ts](../../../../packages/agents/src/types/message.ts) - `PartTimes`"
  - "[code://packages/agents/src/run/turn.ts](../../../../packages/agents/src/run/turn.ts) - `stamped` and `timed`"
  - "[code://packages/agents/src/run/context.ts](../../../../packages/agents/src/run/context.ts) - `forModel`"
---

Each content part has optional `startedAt` and `endedAt`. A run stamps each part of a model reply from its delta runs, or with the model call's span when the reply did not stream. It stamps each tool result with the time its tool ran.

## What was built

- `PartTimes` on the five part types, in `types/message.ts`.
- `stamped` in `callModel`, and `timed` where a tool result is appended.
- `forModel` keeps reasoning parts and the times out of a model request.

## Verified

- `run/part-times.test.ts`: four cases.
- `pnpm test`: 94 files, 1207 cases, no type errors. `pnpm typecheck` passes.

## Departures from the plan

- The plan did not say the times leave a model request. A case showed they reached the request object, so `forModel` strips them.
- No case for a transcript with no times: both fields are optional, and nothing reads them back.
