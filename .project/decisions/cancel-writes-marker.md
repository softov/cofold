---
title: 115 - A cancelled run answers the calls it cut and writes the interrupt marker
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/turn.ts#L119-L125 - `abortOutcome`: `cancelled` or `stopped { reason: 'timeout' }`, nothing written
  - code://packages/agents/src/run/turn.ts#L256 - abort seen before a call; the batch is left unanswered
  - code://packages/agents/src/run/turn.ts#L271 - `result.kind === 'aborted'`; the batch is left unanswered
  - code://packages/agents/src/run/resume.ts#L161-L178 - `recover()`, the pattern that answers a cut batch
  - code://packages/papo/src/claude/project.ts#L12-L13 - Claude Code's `[Request interrupted by user]` and `... for tool use`, which papo already renders as a notice
  - code://.project/plans/cli/03-papo-claude/plan.md#L103 - finding F4
---

## Context

Claude writes `[Request interrupted by user]` into the transcript and marks the tool results it cut. Ours left the run record `cancelled` and no message; worse, the cut batch's tool calls stayed unanswered, so the next run's history was invalid for Chat Completions.

## Decision

At every abort exit of the loop: each unanswered call of the cut batch gets `toolResult { content: '[Request interrupted by user for tool use]', isError: true }`, then a `role: 'user', source: 'system'` message `[Request interrupted by user]` is appended. A timeout writes the same texts. The outcome stays `cancelled` / `stopped { reason: 'timeout' }`. The texts are exported constants `INTERRUPTED` and `INTERRUPTED_TOOL` in `types/message.ts`.

Source: user, 2026-09-16, asked "Marker message + cut results (Claude) / Cut results only".

## Consequences

One projection (papo's) reads both backends' markers. The transcript is model-valid after a cancel; the model sees that it was interrupted, as Claude's does.
