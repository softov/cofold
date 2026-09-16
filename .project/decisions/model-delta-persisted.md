---
title: 102 - Every model.delta is persisted like every other event
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/run/events.ts#L20-L30 - `emit` persists then publishes, contiguous seq
  - code://packages/store-file/src/store.ts#L172-L190 - one JSONL line per event, `seq === last + 1`
---

## Context

A streamed answer produces many small deltas. Decision 61 says every event takes the next seq, is stored and replayed by `resume()`; deltas could have been an exception.

## Decision

`model.delta` events are persisted and replayed like every other event. No separate live-only channel, no coalescing.

Source: user, 2026-09-16, asked "Persist every delta / Live only, no seq / Coalesce per step".

## Consequences

One contract; a reconnecting observer sees partial text. `events.jsonl` grows by one line per chunk; a later store may index by seq without changing the contract.

## Options

Live-only through `handle.deltas` kept the log small but split the event contract in two. Coalescing per step needed a seq-gap rule in the store.
