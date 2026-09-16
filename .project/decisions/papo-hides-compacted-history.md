---
title: CLI-04.3 - After a compaction papo shows what the model sees; the rest is on disk and behind a flag
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/turns.ts#L47 - the summary message becomes a `summary` part today, the older turns stay
  - code://packages/papo/src/blocks.ts#L33-L34 - the notice on the summary
  - code://packages/papo/src/claude/project.ts#L20-L21 - the Claude backend already projects "summary first, retained tail, then the echo"
  - code://.project/decisions/compaction-keeps-tail.md - decision 113: `contextOf` is the model's view
  - code://.project/plans/cli/03-papo-claude/plan.md#L100 - finding F1
---

## Context

Claude's transcript after `/compact` is the summary, the retained tail and the command's echo; what came before is gone from the view and still on disk. papo over the harness kept showing the whole history, so the two backends looked different for the same act.

## Decision

`projectTurns` projects `contextOf(messages)` (the model's view: summary, tail, the rest in order); turns the model no longer sees are not on the screen. The summary turn carries the notice "Context compacted: N tokens to M" from `context.compacted`. The shell's `session show --all` prints the full transcript from the store.

Source: user, 2026-09-16, asked "Hide what the model no longer sees (Claude) / Keep everything, dim it".

## Consequences

Both backends project alike after a compaction. The runs before the summary still exist in the store and in `session show --all`.
