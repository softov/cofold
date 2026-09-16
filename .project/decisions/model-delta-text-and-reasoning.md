---
title: 103 - model.delta carries text and reasoning; tool-call fragments are never published
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/event.ts#L17 - `model.delta { step, text }` before this decision
  - code://packages/papo/src/blocks.ts#L28-L29 - papo already renders prose and reasoning blocks with a `streaming` flag
  - code://.project/specs/agent-harness-spec.md#L78 - "publish safe text deltas immediately but must assemble each complete tool call"
---

## Context

The spec allows publishing text as it arrives and forbids acting on a partial tool call. Reasoning is streamed by providers as well, and papo shows it as its own block.

## Decision

`model.delta` is `{ type: 'model.delta'; step; kind: 'text' | 'reasoning'; text }`. Tool-call fragments are never published as run events.

Source: user, 2026-09-16, asked "Text and reasoning / Text only".

## Consequences

A host can show thinking as it happens. The adapter contract may still carry tool-call fragments ([model-stream-event-shape](model-stream-event-shape.md)); the loop does not publish them.
