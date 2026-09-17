---
title: 120 - A cancel on an awaiting run denies its pending request and finishes the run cancelled
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/handle.ts#L45-L60 - `submit(cancel)` aborts; `resume()`'s `waitForCommand` turns that into a detach (decision 86, p3, no file)
  - code://packages/agents/src/run/resume.ts#L125-L133 - `onAbort`: `finishDetached(abortOutcome)`, the request stays open
  - code://packages/papo/src/chat.ts#L281-L292 - papo denies the pending request itself because the harness would not
  - code://ahpd/packages/agent-claude/src/session.ts#L2420-L2445 - ahpd's cancel: every pending confirmation settled `deny 'The turn was stopped'`, `interrupt()`, turn `cancelled`
  - code://.project/plans/cli/01-papo/plan.md#L29 - cli/01 decision 6, the workaround this replaces
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-08-second-adapter.md - built there (cli/03 F6)
---

## Context

Decision 86 (p3) made a `cancel` on an `awaiting` run detach the handle and leave the request open for a later `resume()`.
ahpd, and Claude's runtime behind it, do the opposite: stopping a turn answers what it was blocked on with a deny and ends the turn (cli/03 F6).
papo had to implement the deny itself (cli/01 decision 6); a host without that code leaves sessions stuck.
This is a file because it supersedes a numbered decision.

## Decision

`handle.cancel()` / `submit({ type: 'cancel' })` on a resumed `awaiting` run resolves the pending request as `deny { reason: 'The turn was stopped' }` through the same path a host's deny takes (`requests.resolve`, `approval.resolved` / `input.declined`, the error tool result for the call, the rest of the batch answered), then finishes the run `cancelled` with the interrupt marker (cli/03 F4).
Decision 86 is superseded; a request is never left open by a cancel.

Source: user, 2026-09-16, asked "Harness denies the pending request (Claude) / Keep detach; papo denies".

## Consequences

papo's `cancel` drops its own deny (cli/04 task 03).
A host that wanted the old detach can simply not cancel.
`resume.test.ts`'s detach cases become deny cases.
