---
title: 105 - ModelAdapter.stream yields text, reasoning and tool-call fragments, then done with the whole reply
status: accepted
date: 2026-09-16
refs:
  - code://packages/agents/src/types/model.ts#L55-L63 - `ModelAdapter`, where `stream?` is added
  - code://.project/plans/agent/01-harness-core-p5-streaming-context-usage/task-05-streaming.md - the outline that named the four kinds
---

## Context

The task outline named `text.delta`, `reasoning.delta`, `toolCall.delta` and `done { reply }`. While writing, the union was reduced to three kinds without asking; the user restored the outline.

## Decision

`ModelAdapter.stream?(request): AsyncIterable<ModelStreamEvent>` with `ModelStreamEvent = text.delta | reasoning.delta | toolCall.delta { index, callId?, name?, arguments } | done { reply }`.
The adapter assembles tool calls; `done.reply` carries them whole; the loop ignores `toolCall.delta` (it exists for a host reading the adapter directly) and validates or executes nothing before `done`.

Source: task outline (the four kinds); user, 2026-09-16, asked "Keep toolCall.delta (outline) / Drop it".

## Consequences

Nothing partial can be executed. A host that wants "calling X..." early reads the adapter's stream itself.
