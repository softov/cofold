---
title: 120 - A cancel on an awaiting run denies its pending request and finishes the run cancelled
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/handle.ts#L45-L60 - `submit(cancel)` aborts; `resume()`'s `waitForCommand` turns that into a detach (decision 86, p3, no file)
  - code://packages/agents/src/run/resume.ts#L125-L133 - `onAbort`: `finishDetached(abortOutcome)`, the request stays open
  - code://packages/papo/src/chat.ts#L281-L292 - papo denies the pending request itself because the harness would not
  - code://ahpd/packages/agent-claude/src/session.ts#L2420-L2445 - ahpd's cancel: every pending confirmation settled `deny 'The turn was stopped'`, client calls released, `interrupt()`, turn `cancelled`
  - code://.project/plans/cli/01-papo/plan.md#L29 - cli/01 decision 6, the workaround this replaces
---

## Context

Decision 86 (p3) made a `cancel` on an `awaiting` run detach the handle and leave the request open for a later `resume()`. ahpd, and Claude's runtime behind it, do the opposite: stopping a turn answers what it was blocked on with a deny and ends the turn. papo had to implement the deny itself (cli/01 decision 6), and a host without that code leaves sessions stuck. Found while reading ahpd on 2026-09-16.

## Decision

`handle.cancel()` / `submit({ type: 'cancel' })` on a resumed `awaiting` run resolves the pending request as `deny { reason: 'The turn was stopped' }` through the same path a host's deny takes (`requests.resolve`, `approval.resolved` / `input.declined`, the error tool result for the call, the rest of the batch answered), then finishes the run `cancelled` with the interrupt marker of [cancel-writes-marker](cancel-writes-marker.md). Decision 86 is superseded; a request is never left open by a cancel.

Source: user, 2026-09-16, asked "Harness denies the pending request (Claude) / Keep detach; papo denies".

## Consequences

papo's `cancel` drops its own deny (cli/04). A host that wanted the old detach can simply not cancel. `resume.test.ts`'s detach cases become deny cases.
