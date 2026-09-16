---
title: 113 - A compaction keeps a verbatim tail, and contextOf is the model's view of a session
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/compact.ts#L36-L90 - `writeSummary`: `covered` is everything no summary stands for, minus the turn's input
  - code://packages/agents/src/run/context.ts#L45-L50 - `contextOf`: summary first, then what no summary covers
  - code://packages/agents/src/types/agent.ts#L8-L24 - `ContextOptions`, where `compactKeepTokens` goes
  - code://ahpd/packages/agent-claude/src/session.ts#L1735-L1750 - Claude's `compact_boundary` shown as a notice in the running turn, the transcript kept
  - code://.project/plans/cli/03-papo-claude/plan.md#L100 - finding F1
---

## Context

Claude's compaction leaves a summary plus the most recent turns verbatim; ours summarized everything but the current input, so the model lost the wording of what had just happened. papo could not show what the model sees after `/compact`.

## Decision

`context.compactKeepTokens` (default 20% of `maxTokens`; `0` keeps nothing): the newest whole units that fit are left out of the summary and out of `summarizes`. `contextOf` (summary, tail, rest, in transcript order) is exported from `@facio/agents` as "what the model sees of a session" for the projection.

Source: user, 2026-09-16, asked "Summary + retained tail (Claude) / Summary only, export the view".

## Consequences

The tail is estimated, not measured; a unit is never split. papo renders the model's view from `contextOf` in a `cli` plan.
