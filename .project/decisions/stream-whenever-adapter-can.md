---
title: 104 - The loop streams whenever the adapter can; the summary step never does
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/turn.ts#L204-L214 - the loop's one `complete()` call
  - code://packages/agents/src/run/compact.ts#L62-L68 - the summary step's `complete()` call
---

## Context

Once an adapter has `stream()`, something has to say when it is used. An agent option would be one more knob; the summary step has no watcher.

## Decision

`callModel` streams when `agent.model.stream` exists and `agent.model.features.streaming` is true, otherwise calls `complete()`. There is no agent option. The compaction summary step always calls `complete()`.

Source: user, 2026-09-16, asked "Whenever the adapter can / Agent option".

## Consequences

A host turns streaming off per model through `features: { streaming: false }`, not per agent.
