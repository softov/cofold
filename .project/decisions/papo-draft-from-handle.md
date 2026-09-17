---
title: CLI-04.2 - The text being written is a draft folded from the handle's deltas, in memory
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/chat.ts#L108-L121 - `attach`: the handle's events only wake listeners
  - code://packages/papo/src/turns.ts#L27-L60 - `projectTurns(input)`, which reads the store only
  - code://packages/papo/src/blocks.ts#L28-L29 - prose and reasoning blocks carry `streaming`
  - code://ahpd/packages/agent-claude/src/session.ts#L1782 - `streamed(event)` appends stream events to the active turn held in memory
  - code://.project/decisions/model-delta-persisted.md - decision 102: deltas are persisted for reconnection
---

## Context

Deltas are persisted (decision 102) so `resume()` can replay them.
A screen re-reading the event log on every delta would cost one growing read per token.
ahpd keeps the active turn's parts in memory and appends each stream event to them; the transcript on disk is the durable record, not what the screen reads per token.

## Decision

`attach` folds every `model.delta` into a per-session draft `{ runId, step, text, reasoning }` held next to the handle and cleared at `model.completed`.
`projectTurns` takes `draft?` as input and renders it as the running turn's `streaming` prose and reasoning blocks.
A process that did not run the turn sees the text whole at `model.completed`, as today.
cli/01 decision 3 ("every read projects the store; the handle only wakes") stays for everything durable.

Source: `(defaulted: the in-memory draft)`.
The user asked "what is the correct?"; the writer answered with the reasons above and chose; erase if wrong.

## Consequences

No event read per notify; the draft is the one screen state that is not in the store, and it exists only while the step runs.

## Options

Re-projecting the store on every delta kept one source of truth and read the whole event log per token.
Reading the delta payload straight into the block list skipped the projection and gave two code paths for one turn.
