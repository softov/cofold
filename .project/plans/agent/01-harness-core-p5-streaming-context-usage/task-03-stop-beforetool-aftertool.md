---
title: Stop from `beforeTool` / `afterTool`
status: todo
depends: [task-02-steering-loop.md]
layer: agents
---

## Objective

Stop from `beforeTool` / `afterTool`.

## Files

- `UPDATE: packages/agents/src/run/tools.ts`, `run/turn.ts`, `CREATE: packages/agents/src/run/hook-stop.test.ts`.

## Steps

- `tools.ts`: `ToolCallResult` gains `| { kind: 'stop'; part: ToolResultPart; executed: boolean; stoppedBy: 'beforeTool' | 'afterTool'; reason: string }`.
  - `beforeTool` branch (after `deny`, before `modify`): `if (decision.decision === 'stop') { await emit({ type: 'tool.denied', callId, name, reason: decision.reason }); return { kind: 'stop', executed: false, stoppedBy: 'beforeTool', reason: decision.reason, part: { type: 'toolResult', callId, name, content: \`Not executed: ${decision.reason}\`, isError: true } }; }` (no step record: nothing executed, same as a deny).
  - `afterTool` branch (line 109-115): capture `after.stop`; the step patch gains `detail: { stoppedBy: 'afterTool', reason }` when set; `tool.completed` is emitted as today; return `{ kind: 'stop', executed: true, stoppedBy: 'afterTool', reason, part }` instead of `{ kind: 'result' }`.
- `turn.ts` `processCalls`, after the `aborted` check:
  ```ts
  if (result.kind === 'stop') {
    await appendResult(ctx, result.part);
    for (const rest of calls.slice(i + 1)) await appendResult(ctx, { type: 'toolResult', callId: rest.callId, name: rest.name, content: 'Not executed: the run was stopped', isError: true });
    await finishRun(ctx, { status: 'stopped', reason: 'hook', usage: counters.usage, steps: counters.steps });
    return 'done';
  }
  ```
  The counter rule stays: `executed: true` counts, `false` does not (decision 56).
- `applyResolved` (an approved call re-entering `execute`) goes through `afterTool` inside `execute`, so an `afterTool` stop on a resumed call takes the same path; no change needed there beyond the union.
- `hook-stop.test.ts`: (1) `beforeTool` stop on the first of two calls → both calls have `Not executed` results, `tool.denied` for the first only, outcome `stopped { reason: 'hook' }`, `toolCalls` counter 0. (2) `afterTool` stop on a `notify_done` tool → its own result recorded, step `completed` with `detail.stoppedBy: 'afterTool'`, outcome `stopped { reason: 'hook' }`, counter 1. (3) The next `run()` on the session assembles a model-valid history (every `toolCall` has a `toolResult`). (4) `afterTool` stop with `isError: true` still stops.

## Validation

- `pnpm check`.

## Resume


