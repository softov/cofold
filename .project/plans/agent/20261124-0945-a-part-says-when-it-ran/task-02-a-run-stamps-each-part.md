---
title: A run stamps each part
status: done
depends: [01]
layer: "agents"
refs:
  - "[code://packages/agents/src/run/turn.ts#L316-L330](../../../../packages/agents/src/run/turn.ts#L316-L330) - `callModel`"
  - "[code://packages/agents/src/run/turn.ts#L333-L370](../../../../packages/agents/src/run/turn.ts#L333-L370) - `processCalls`"
---

## Objective

A run writes each part of a model reply and each tool result with its `startedAt` and `endedAt`.

## Files

- `UPDATE: packages/agents/src/run/turn.ts:316-330` - note each part's first and last delta, and stamp the reply's parts.
- `UPDATE: packages/agents/src/run/turn.ts:333-370` - stamp a tool result with the time its call ran.
- `UPDATE: packages/agents/src/run/stream.test.ts` - the streamed and the whole-reply cases.
- `UPDATE: packages/agents/src/run/tools.test.ts` - the tool result case.

## Steps

1. In `callModel`, keep the time of the first and last delta of each run of one kind.
2. Stamp each reply part with the times of the delta run in the same place among parts of its kind.
3. Stamp a part with no delta run with the call's start and end.
4. Stamp each part of a reply that did not stream with the call's start and end.
5. Leave a tool call part with the times of its reply.
6. Stamp a tool result with the time its call began to run and the time it had a result.
7. Add cases: a streamed reasoning part and text part, a reply that did not stream, and a tool result.
8. Add a case: a transcript with no times loads and resumes.

## Validation

- `stream.test.ts` and `tools.test.ts`: the new cases.
- `pnpm test` passes in the repository.

## Resume

Done on 2026-11-24. `stamped` in `run/turn.ts` stamps a reply, and `timed` a tool result. Five older cases compared parts exactly and now use `toMatchObject`. The cases are in `run/part-times.test.ts`. A transcript with no times needs no case: both fields are optional, and no code reads them back.
