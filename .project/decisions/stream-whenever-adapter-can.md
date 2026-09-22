---
title: 104 - Streaming is the adapter's feature, on by default; the loop streams whenever it can, the summary step never
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/turn.ts#L204-L214 - the loop's one `complete()` call
  - code://packages/agents/src/run/compact.ts#L62-L68 - the summary step's `complete()` call
  - code://packages/model-openai-compat/src/index.ts#L9 - `DEFAULT_FEATURES.streaming`, `false` before this decision
---

## Context

Once an adapter has `stream()`, something has to say when it is used and what the default is.
An agent option would be one more knob; the summary step has no watcher.

## Decision

`callModel` streams when `agent.model.stream` exists and `agent.model.features.streaming` is true, otherwise calls `complete()`.
There is no agent option; a host turns streaming off per model with `features: { streaming: false }`.
`@cofold/model-openai-compat` ships `DEFAULT_FEATURES.streaming: true`.
The compaction summary step always calls `complete()`.

Source: user, 2026-09-16, asked "Whenever the adapter can / Agent option" and "Flip the default to true / Stay false".

## Consequences

papo streams by default once it reads `model.delta` (cli/04 task 02).

## Options

An agent option (`streaming: boolean` on `createAgent`) would let two agents on one model differ, which nothing needs.
