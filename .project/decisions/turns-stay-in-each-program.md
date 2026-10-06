---
title: 124 - Turns stay in each program
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/papo/src/turns.ts](../../packages/papo/src/turns.ts) - `projectTurns`: papo folds a stored session into textui blocks, one turn per run"
  - "[code://packages/papo/src/chat.ts#L142-L167](../../packages/papo/src/chat.ts#L142-L167) - `attach`, where papo accumulates a live turn's draft from `model.delta`"
  - file:///github/ahpd/packages/agent-cofold/src/transcript.ts - ahpd's `turnsOf`, AHP turns, one turn per user message
  - file:///github/ahpd/packages/agent-cofold/src/mapping.ts - `mapTurn`, ahpd's accumulator for a live turn's events
---

## Context

papo and ahpd both fold a stored session into turns and both accumulate a live turn's steps.
The two outputs are different: ahpd writes AHP turns and papo writes textui blocks.
The grouping differs too: ahpd makes one turn per user message, papo one per run.
`model.completed` already carries the finished message, which is the part both read.

## Decision

`turnsOf`, `projectTurns` and the step accumulator stay in each program; cofold does not ship a turn grouping core.
A shared turn separation is a future item in the ROADMAP.

Source: Softov, 2026-10-06, asked "Folding a stored session into turns (turnsOf / projectTurns) and the step accumulator: move them into cofold?": "keep them in each.. but turn separation would be usefull in a future".

## Consequences

Each program keeps the projection it draws, and cofold's surface does not grow by a shape only two programs use in two different ways.
A fix to how a turn is cut, such as hiding the messages a compaction summary covers, is made in each program.

## Options

Moving the turn grouping core into cofold was rejected for now: neither program's grouping is generic, and the shared part is the boundary between turns, which is the future ROADMAP item.
