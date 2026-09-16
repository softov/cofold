---
title: 111 - p5 delivers deltas to the handle; papo shows partial text in a cli plan
status: accepted
date: 2026-09-16
refs:
  - code://packages/papo/src/chat.ts#L108-L121 - papo iterates `handle.events` only to re-project the store
  - code://packages/papo/src/blocks.ts#L28-L35 - the projection's `streaming` flag, unused so far
---

## Context

papo re-projects the whole transcript on every event and reads no event payload; partial text needs a draft per run in papo's state. That is `cli` work, and p5 is an `agent` plan.

## Decision

p5 ends at `model.delta` on the handle plus the SSE adapter. papo adopting deltas (with steering and `contextOf`, both already owed) is a `cli` plan.

Source: user, 2026-09-16, asked "Harness only / Include papo".

## Consequences

Streaming is not visible in papo until that plan ships; the harness is testable without it.
